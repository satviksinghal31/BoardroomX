// ─────────────────────────────────────────────────────────────────────────────
//  BoardroomX — NSE Bulk Agent
//
//  Fetches ALL 3 NSE bulk endpoints every 2 minutes (wired from server.js).
//  Covers the full ~2220-stock universe in 3 HTTP calls instead of per-stock.
//
//  Endpoints:
//    /api/corporate-board-meetings?index=equities&from_date=X&to_date=Y
//    /api/corporate-announcements?index=equities&from_date=X&to_date=Y
//    /api/corporates-corporateActions?index=equities
//
//  Guarantees:
//    ATOMIC    — all 3 calls succeed OR last_successful_run is NOT advanced
//    CATCH-UP  — from_date = last_success − 5 min (capped at 7 days back)
//    CIRCUIT   — 3 consecutive failures → pause 15 min
//    DIFF      — batch-reads existing rows before upsert; skips no-ops
// ─────────────────────────────────────────────────────────────────────────────

import { categorizePurpose } from "./nse_announcements.js";

const NSE_HOME  = "https://www.nseindia.com/";
const NSE_BM    = (f, t) =>
  `https://www.nseindia.com/api/corporate-board-meetings?index=equities&from_date=${f}&to_date=${t}`;
const NSE_ANN   = (f, t) =>
  `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${f}&to_date=${t}`;
const NSE_CORP  = "https://www.nseindia.com/api/corporates-corporateActions?index=equities";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CIRCUIT_THRESHOLD    = 3;
const CIRCUIT_PAUSE_MS     = 15 * 60 * 1000;   // 15 min
const MAX_CATCHUP_DAYS     = 7;
const CATCHUP_OVERLAP_MS   = 5 * 60 * 1000;    // 5-min overlap on window start

let _tickCount = 0;

// ── Date helpers ──────────────────────────────────────────────────────────────

const MON_NAMES  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MON_INDEX  = Object.fromEntries(MON_NAMES.map((m, i) => [m, i]));

/** "2026-05-23" → "23-May-2026"  (NSE query-param format) */
function toNseDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${MON_NAMES[parseInt(m, 10) - 1]}-${y}`;
}

/**
 * Parse NSE date strings to ISO.
 * Handles: "26-May-2026" · "26-05-2026" · "23-May-2026 09:30:35"
 */
function fromNseDate(s) {
  if (!s) return null;
  const clean = String(s).trim().split(" ")[0]; // strip time component
  const parts = clean.split("-");
  if (parts.length !== 3) return null;
  const [d, mon, y] = parts;
  let month;
  if (MON_INDEX[mon] != null) {
    month = MON_INDEX[mon];
  } else if (!isNaN(parseInt(mon, 10))) {
    month = parseInt(mon, 10) - 1;
  } else {
    return null;
  }
  const dt = new Date(parseInt(y, 10), month, parseInt(d, 10));
  return isNaN(dt) ? null : dt.toISOString().split("T")[0];
}

/**
 * Map board-meeting date → earnings quarter header.
 * Apr–Jun → Mar Y  |  Jul–Sep → Jun Y  |  Oct–Dec → Sep Y  |  Jan–Mar → Dec (Y−1)
 */
function boardDateToQuarter(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  const m = d.getMonth() + 1, y = d.getFullYear();
  if (m >= 4  && m <= 6)  return `Mar ${y}`;
  if (m >= 7  && m <= 9)  return `Jun ${y}`;
  if (m >= 10 && m <= 12) return `Sep ${y}`;
  return `Dec ${y - 1}`;
}

// ── Cookie session ─────────────────────────────────────────────────────────────

async function getCookieHeaders() {
  const home = await fetch(NSE_HOME, {
    headers: { "User-Agent": UA, "Accept": "text/html,*/*" },
    redirect: "follow",
  });
  const setCookie = home.headers.getSetCookie?.() ?? home.headers.raw?.()?.["set-cookie"] ?? [];
  const cookie = setCookie.length
    ? setCookie.map(c => c.split(";")[0]).join("; ")
    : "";
  return {
    "User-Agent":        UA,
    "Accept":            "application/json, */*",
    "Referer":           NSE_HOME,
    "X-Requested-With":  "XMLHttpRequest",
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

// ── Bulk fetchers ──────────────────────────────────────────────────────────────

async function fetchBMBulk(headers, fromIso, toIso) {
  const res = await fetch(NSE_BM(toNseDate(fromIso), toNseDate(toIso)), { headers });
  if (!res.ok) throw new Error(`BM bulk HTTP ${res.status}`);
  const json = await res.json();
  // NSE changed response shape: used to be a bare array, now wraps in {data:[],msg:"..."}
  const arr  = Array.isArray(json)       ? json
             : Array.isArray(json?.data) ? json.data
             : null;
  if (!arr) throw new Error(`BM bulk unexpected shape: ${typeof json}`);
  return arr;
}

async function fetchAnnBulk(headers, fromIso, toIso) {
  const res = await fetch(NSE_ANN(toNseDate(fromIso), toNseDate(toIso)), { headers });
  if (!res.ok) throw new Error(`ANN bulk HTTP ${res.status}`);
  const json = await res.json();
  const arr  = Array.isArray(json)         ? json
             : Array.isArray(json?.data)   ? json.data
             : Array.isArray(json?.announcements) ? json.announcements
             : null;
  if (!arr) throw new Error(`ANN bulk unexpected shape`);
  return arr;
}

async function fetchCorpBulk(headers) {
  const res = await fetch(NSE_CORP, { headers });
  if (!res.ok) throw new Error(`CORP bulk HTTP ${res.status}`);
  const json = await res.json();
  const arr  = Array.isArray(json)       ? json
             : Array.isArray(json?.data) ? json.data
             : null;
  if (!arr) throw new Error(`CORP bulk unexpected shape`);
  return arr;
}

// ── Processors ────────────────────────────────────────────────────────────────

/** Convert raw board-meeting array → normalised row objects */
function processBoardMeetings(bmArr) {
  const today = new Date().toISOString().split("T")[0];
  const seen  = new Set();
  const out   = [];

  for (const b of bmArr) {
    const sym      = (b.bm_symbol || b.symbol || "").trim().toUpperCase();
    const purpose  = (b.bm_purpose || b.bm_desc || "").trim();
    const isoDate  = fromNseDate(b.bm_date);
    if (!sym || !isoDate) continue;

    const category  = categorizePurpose(purpose);
    const isEarnings = category === "EARNINGS";
    const quarter   = boardDateToQuarter(isoDate);
    const rowQ      = isEarnings ? quarter : `${category}|${isoDate}`;
    const dedup     = `${sym}|${rowQ}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    out.push({ symbol: sym, quarter: rowQ, date: isoDate,
               isUpcoming: isoDate >= today, purpose: purpose || null,
               category, isEarnings });
  }
  return out;
}

/** Classify NSE announcement `desc` field → category or null (skip if null) */
function classifyAnnDesc(desc) {
  const d = (desc || "").toLowerCase();
  if (d.includes("financial result") || d.includes("quarterly result")) return "EARNINGS";
  // Specific keywords (dividend, AGM, etc.) must run BEFORE the generic
  // "board meeting" fallback — otherwise "outcome of board meeting: declared
  // interim dividend" gets miscategorised as a generic board meeting.
  if (d.includes("interim dividend"))  return "INTERIM_DIVIDEND";
  if (d.includes("dividend"))          return "DIVIDEND";
  if (d.includes("annual general"))    return "AGM";
  if (d.includes("extra ordinary") || d.includes("egm")) return "EGM";
  if (d.includes("rights"))            return "RIGHTS";
  if (d.includes("bonus"))             return "BONUS";
  if (d.includes("buyback") || d.includes("buy back")) return "BUYBACK";
  if (d.includes("split") || d.includes("sub-division") || d.includes("subdivision")) return "SPLIT";
  if (d.includes("merger") || d.includes("amalgam"))   return "MERGER";
  // Generic board-meeting fallback — only matches if no specific event above did
  if (d.includes("outcome of board meeting") || d.includes("board meeting")) return "BOARD_MEETING";
  return null; // not relevant → skip
}

/** Convert raw announcements array → normalised row objects */
function processAnnouncements(annArr) {
  const today = new Date().toISOString().split("T")[0];
  const seen  = new Set();
  const out   = [];

  for (const a of annArr) {
    const sym     = (a.symbol || "").trim().toUpperCase();
    const desc    = (a.desc || "").trim();
    const category = classifyAnnDesc(desc);
    if (!sym || !category) continue;

    const rawDate = (a.an_dt || a.sort_date || "").split(" ")[0];
    const isoDate = fromNseDate(rawDate);
    if (!isoDate) continue;

    const rowQ  = `${category}|${isoDate}`;
    const dedup = `${sym}|${rowQ}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    out.push({ symbol: sym, quarter: rowQ, date: isoDate,
               isUpcoming: isoDate >= today, purpose: desc || null,
               category, isEarnings: category === "EARNINGS" });
  }
  return out;
}

/** Classify corporate-action subject → category or null */
function classifyCorpSubject(subject) {
  const s = (subject || "").toLowerCase();
  if (s.includes("dividend") && s.includes("interim")) return "INTERIM_DIVIDEND";
  if (s.includes("dividend"))  return "DIVIDEND";
  if (s.includes("bonus"))     return "BONUS";
  if (s.includes("split") || s.includes("sub-division") || s.includes("subdivision")) return "SPLIT";
  if (s.includes("rights"))    return "RIGHTS";
  if (s.includes("buyback") || s.includes("buy back")) return "BUYBACK";
  return null;
}

/** Convert raw corp-actions array → normalised row objects */
function processCorpActions(corpArr) {
  const today = new Date().toISOString().split("T")[0];
  const seen  = new Set();
  const out   = [];

  for (const c of corpArr) {
    const sym      = (c.symbol || "").trim().toUpperCase();
    const subject  = (c.subject || c.purpose || "").trim();
    const category = classifyCorpSubject(subject);
    if (!sym || !category) continue;

    const isoDate = fromNseDate(c.exDate || c.recDate || "");
    if (!isoDate) continue;

    const rowQ  = `${category}|${isoDate}`;
    const dedup = `${sym}|${rowQ}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    out.push({ symbol: sym, quarter: rowQ, date: isoDate,
               isUpcoming: isoDate >= today, purpose: subject || null,
               category, isEarnings: false });
  }
  return out;
}

// ── Diff detection + batch upsert ─────────────────────────────────────────────

async function diffAndUpsert(allRows, supabase) {
  if (!allRows.length) return { upserted: 0, noops: 0 };

  const uniqueSymbols  = [...new Set(allRows.map(r => r.symbol))];
  const uniqueQuarters = [...new Set(allRows.map(r => r.quarter))];
  const existing       = new Map(); // "SYM|quarter" → existing DB row

  // Batch-read existing rows, filtering by BOTH symbol and quarter to stay targeted.
  // A 7-day window touches ~100-400 symbols and ~50-150 distinct quarters.
  const SYM_BATCH = 150;
  // Supabase URL limit: cap quarters at 200 in the IN filter
  const qFilter = uniqueQuarters.slice(0, 200);

  for (let i = 0; i < uniqueSymbols.length; i += SYM_BATCH) {
    const batch = uniqueSymbols.slice(i, i + SYM_BATCH);
    const { data, error } = await supabase
      .from("results")
      .select("symbol, quarter, reported_at, expected_at, category, purpose")
      .in("symbol",  batch)
      .in("quarter", qFilter);
    if (error) {
      console.warn(`[NSE-bulk] diff pre-read error: ${error.message}`);
    }
    for (const row of data ?? []) {
      existing.set(`${row.symbol}|${row.quarter}`, row);
    }
  }

  const now      = new Date().toISOString();
  const toUpsert = [];
  let noops      = 0;

  for (const r of allRows) {
    const key = `${r.symbol}|${r.quarter}`;
    const ex  = existing.get(key);

    const payload = {
      symbol:      r.symbol,
      quarter:     r.quarter,
      purpose:     r.purpose  ?? null,
      category:    r.category ?? null,
      modified_at: now,
    };
    if (r.isUpcoming) payload.expected_at = r.date;
    else              payload.reported_at = r.date;

    if (ex) {
      const sameDate = r.isUpcoming
        ? (ex.expected_at === payload.expected_at)
        : (ex.reported_at === payload.reported_at);
      const sameCat  = ex.category === payload.category;
      if (sameDate && sameCat) { noops++; continue; }
    }
    toUpsert.push(payload);
  }

  // Batch upsert — 100 rows per call to stay inside Supabase limits
  const UPSERT_BATCH = 100;
  let upserted = 0;
  for (let i = 0; i < toUpsert.length; i += UPSERT_BATCH) {
    const batch = toUpsert.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase
      .from("results")
      .upsert(batch, { onConflict: "symbol,quarter" });
    if (error) {
      console.warn(`[NSE-bulk] batch upsert error: ${error.message}`);
    } else {
      upserted += batch.length;
    }
  }

  return { upserted, noops };
}

// ── Agent state helpers ───────────────────────────────────────────────────────

async function readState(supabase) {
  try {
    const { data } = await supabase
      .from("agent_state")
      .select("*")
      .eq("agent", "NSE_BULK")
      .maybeSingle();
    return data ?? {};
  } catch { return {}; }
}

async function writeState(supabase, patch) {
  try {
    await supabase
      .from("agent_state")
      .upsert({ agent: "NSE_BULK", ...patch, updated_at: new Date().toISOString() },
               { onConflict: "agent" });
  } catch (err) {
    console.warn(`[NSE-bulk] agent_state write failed: ${err.message}`);
  }
}

// ── Main tick (exported) ──────────────────────────────────────────────────────

/**
 * Run one NSE bulk agent tick.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase  service-role client
 * @param {function} godLog  godLog(source, symbol, type, message, raw?)
 * @returns {Promise<object>}  { ok, skipped?, upserted?, noops?, bm?, ann?, corp?, ms?, error? }
 */
export async function runNseAgentTick(supabase, godLog) {
  _tickCount++;
  const tickNum = _tickCount;
  const t0      = Date.now();

  // ── 1. Read state ────────────────────────────────────────────────────────────
  const state              = await readState(supabase);
  const consecutiveFailures = state.consecutive_failures ?? 0;
  const lastAttempt         = state.last_attempt_at     ? new Date(state.last_attempt_at)     : null;
  const lastSuccess         = state.last_successful_run ? new Date(state.last_successful_run) : null;

  // ── 2. Circuit breaker ───────────────────────────────────────────────────────
  if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
    const msSince = lastAttempt ? Date.now() - lastAttempt.getTime() : Infinity;
    if (msSince < CIRCUIT_PAUSE_MS) {
      const waitMin = Math.ceil((CIRCUIT_PAUSE_MS - msSince) / 60000);
      godLog("NSE_TICK", null, "CIRCUIT_OPEN",
        `Tick #${tickNum} — circuit open (${consecutiveFailures} fails), resume in ${waitMin}min`);
      // Stamp the skip so dashboard "Last attempt" reflects reality and the
      // status field shows the circuit-open state (not stale "running" / "idle").
      await writeState(supabase, {
        last_attempt_at: new Date().toISOString(),
        status:          "circuit_open",
      });
      return { ok: false, skipped: true, reason: "circuit_open" };
    }
    // Pause expired — allow one retry attempt
  }

  // ── 3. Catch-up window ───────────────────────────────────────────────────────
  const todayIso  = new Date().toISOString().split("T")[0];
  const cutoffMs  = Date.now() - MAX_CATCHUP_DAYS * 86_400_000;
  let   fromIso;
  if (lastSuccess) {
    fromIso = new Date(Math.max(lastSuccess.getTime() - CATCHUP_OVERLAP_MS, cutoffMs))
                .toISOString().split("T")[0];
  } else {
    fromIso = new Date(cutoffMs).toISOString().split("T")[0];
  }

  // ── 4. Stamp attempt ─────────────────────────────────────────────────────────
  await writeState(supabase, {
    last_attempt_at: new Date().toISOString(),
    status:          "running",
  });

  try {
    // ── 5. Cookie session ──────────────────────────────────────────────────────
    const headers = await getCookieHeaders();

    // ── 6. ATOMIC fetch — all 3 must succeed ─────────────────────────────────
    const [bmRaw, annRaw, corpRaw] = await Promise.all([
      fetchBMBulk  (headers, fromIso, todayIso),
      fetchAnnBulk (headers, fromIso, todayIso),
      fetchCorpBulk(headers),
    ]);

    // ── 7. Process ────────────────────────────────────────────────────────────
    const bmRows   = processBoardMeetings(bmRaw);
    const annRows  = processAnnouncements(annRaw);
    const corpRows = processCorpActions(corpRaw);

    // Merge and dedup across sources (BM + ANN can reference same earnings event)
    const dedup = new Map();
    for (const r of [...bmRows, ...annRows, ...corpRows]) {
      const k = `${r.symbol}|${r.quarter}`;
      // BM takes priority over ANN for same key (BM is more structured)
      if (!dedup.has(k)) dedup.set(k, r);
    }
    const allRows = [...dedup.values()];

    // ── 8. Diff + upsert ──────────────────────────────────────────────────────
    const { upserted, noops } = await diffAndUpsert(allRows, supabase);
    const ms = Date.now() - t0;

    // ── 9. Advance last_successful_run — ONLY here, on full success ───────────
    await writeState(supabase, {
      last_successful_run:  new Date().toISOString(),
      consecutive_failures: 0,
      status:               "idle",
      last_error:           null,
      last_summary: {
        tick: tickNum, from: fromIso, to: todayIso,
        bm: bmRaw.length, ann: annRaw.length, corp: corpRaw.length,
        total: allRows.length, upserted, noops, ms,
      },
    });

    const summary =
      `Tick #${tickNum} — BM ${bmRaw.length} · ANN ${annRaw.length} · CORP ${corpRaw.length}` +
      ` → ${upserted}↑ ${noops}= · ${(ms / 1000).toFixed(1)}s`;
    console.log(`[NSE-bulk] ${summary}`);
    godLog("NSE_TICK", null, "TICK_OK", summary, {
      tick: tickNum, from: fromIso, to: todayIso,
      bm: bmRaw.length, ann: annRaw.length, corp: corpRaw.length,
      total: allRows.length, upserted, noops, ms,
    });

    return { ok: true, upserted, noops, bm: bmRaw.length, ann: annRaw.length, corp: corpRaw.length, ms };

  } catch (err) {
    const ms       = Date.now() - t0;
    const failures = consecutiveFailures + 1;
    console.error(`[NSE-bulk] tick #${tickNum} FAILED (${failures}/${CIRCUIT_THRESHOLD}): ${err.message}`);

    // Failure — increment failures, do NOT advance last_successful_run
    await writeState(supabase, {
      consecutive_failures: failures,
      status:               "error",
      last_error:           err.message,
    });

    if (failures >= CIRCUIT_THRESHOLD) {
      godLog("NSE_TICK", null, "CIRCUIT_OPEN",
        `Tick #${tickNum} — circuit opened after ${failures} failures: ${err.message}`,
        { tick: tickNum, failures, error: err.message, ms });
    } else {
      godLog("NSE_TICK", null, "TICK_FAIL",
        `Tick #${tickNum} — failed (${failures}/${CIRCUIT_THRESHOLD}): ${err.message}`,
        { tick: tickNum, failures, error: err.message, ms });
    }

    return { ok: false, error: err.message, failures };
  }
}
