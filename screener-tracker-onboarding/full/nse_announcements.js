// ─────────────────────────────────────────────────────────────────────────────
//  BoardroomX — NSE board-meeting fetcher (Node port of fetch_ann.py)
//
//  Calls NSE India's public `corporate-board-meetings` API to get the actual
//  past `reported_at` and upcoming `expected_at` dates per stock per quarter.
//  Writes them into the Supabase `results` table.
//
//  Why this exists: Screener.in gives us the financial NUMBERS per quarter,
//  but not the DATE each quarter was reported. The chart's earnings markers
//  need real reported dates — no estimation.
//
//  NSE's API needs a real browser-like cookie/UA flow:
//    1. GET https://www.nseindia.com/  (warm-up to set cookies)
//    2. GET the API with those cookies + a realistic User-Agent.
// ─────────────────────────────────────────────────────────────────────────────

const NSE_HOME = "https://www.nseindia.com/";
const NSE_BM   = (sym) =>
  `https://www.nseindia.com/api/corporate-board-meetings?index=equities&symbol=${encodeURIComponent(sym)}`;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Parse "26-May-2026" → "2026-05-26"
const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
function parseBmDate(s) {
  if (!s) return null;
  const [d, mon, y] = s.split("-");
  if (!d || !mon || !y || MONTHS[mon] == null) return null;
  const dt = new Date(parseInt(y, 10), MONTHS[mon], parseInt(d, 10));
  if (isNaN(dt)) return null;
  return dt.toISOString().split("T")[0];
}

// Apr–Jun → Mar Y, Jul–Sep → Jun Y, Oct–Dec → Sep Y, Jan–Mar → Dec (Y-1)
function boardDateToQuarter(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  const m = d.getMonth() + 1, y = d.getFullYear();
  if (m >= 4 && m <= 6)   return `Mar ${y}`;
  if (m >= 7 && m <= 9)   return `Jun ${y}`;
  if (m >= 10 && m <= 12) return `Sep ${y}`;
  return `Dec ${y - 1}`;
}

function isFinancialResult(s) {
  const v = (s || "").toLowerCase();
  return v.includes("financial result");
}

/**
 * Categorize a board meeting purpose string into a clean type label.
 * Returns one of: EARNINGS | DIVIDEND | AGM | EGM | RIGHTS | BONUS |
 *                 BUYBACK | SPLIT | MERGER | INTERIM_DIVIDEND | BOARD_MEETING
 */
export function categorizePurpose(purpose) {
  const p = (purpose || "").toLowerCase();
  if (p.includes("financial result") || p.includes("quarterly result") || p.includes("half year") || p.includes("annual result")) return "EARNINGS";
  if (p.includes("interim dividend"))  return "INTERIM_DIVIDEND";
  if (p.includes("dividend"))          return "DIVIDEND";
  if (p.includes("annual general"))    return "AGM";
  if (p.includes("extra ordinary") || p.includes("extraordinary") || p.includes("egm")) return "EGM";
  if (p.includes("rights"))            return "RIGHTS";
  if (p.includes("bonus"))             return "BONUS";
  if (p.includes("buyback") || p.includes("buy back")) return "BUYBACK";
  if (p.includes("split") || p.includes("sub-division") || p.includes("subdivision")) return "SPLIT";
  if (p.includes("merger") || p.includes("amalgam") || p.includes("scheme")) return "MERGER";
  return "BOARD_MEETING";
}

// ── Cookie helper ──────────────────────────────────────────────────────────
// Extract the Set-Cookie values from a Response and join into a Cookie header.
function readCookieJar(res) {
  const setCookie = res.headers.getSetCookie?.() ?? res.headers.raw?.()['set-cookie'] ?? [];
  if (!setCookie.length) return "";
  return setCookie.map(c => c.split(";")[0]).join("; ");
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch ALL board meetings for a single NSE symbol (not just earnings).
 * Returns array of:
 *   { date, quarter, isUpcoming, purpose, category, isEarnings }
 * Returns [] on any error so callers can degrade gracefully.
 */
export async function fetchBoardMeetings(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return [];

  try {
    // Step 1: warm-up to get cookies
    const home = await fetch(NSE_HOME, {
      headers: { "User-Agent": UA, "Accept": "text/html,*/*" },
      redirect: "follow",
    });
    const cookie = readCookieJar(home);

    // Step 2: the actual API call
    const apiRes = await fetch(NSE_BM(sym), {
      headers: {
        "User-Agent":      UA,
        "Accept":          "application/json,*/*",
        "Referer":         NSE_HOME,
        "X-Requested-With":"XMLHttpRequest",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });

    if (!apiRes.ok) {
      console.warn(`[NSE] ${sym} HTTP ${apiRes.status}`);
      return [];
    }
    const arr = await apiRes.json();
    if (!Array.isArray(arr)) {
      console.warn(`[NSE] ${sym} unexpected response shape`);
      return [];
    }

    const today = new Date().toISOString().split("T")[0];
    // Deduplicate by (quarter + category) — same company can have dividend + earnings in same quarter
    const seen = new Set();
    const out = [];

    for (const b of arr) {
      const purpose    = (b.bm_purpose || b.bm_desc || "").trim();
      const category   = categorizePurpose(purpose);
      const isEarnings = category === "EARNINGS";

      const isoDate = parseBmDate(b.bm_date);
      if (!isoDate) continue;

      // For earnings: dedup by quarter. For others: dedup by quarter+category.
      const quarter  = boardDateToQuarter(isoDate);
      const dedupKey = isEarnings ? quarter : `${quarter}|${category}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      out.push({
        date:       isoDate,
        quarter,
        isUpcoming: isoDate >= today,
        purpose,
        category,
        isEarnings,
      });
    }
    return out;
  } catch (err) {
    console.warn(`[NSE] ${sym} fetch failed: ${err.message}`);
    return [];
  }
}

/**
 * Fetch board meetings for `symbol` and upsert reported_at / expected_at
 * into Supabase `results` table. Stamps stocks.nse_synced_at on every call.
 *
 * @param {string} symbol
 * @param {SupabaseClient} supabase  service-role client
 * @returns {Promise<{ok, written, upcoming, past, error?, errorCode?}>}
 *   ok        — false only if symbol was empty / DB error
 *   written   — count of rows upserted (0 is valid: NSE has no announcements)
 *   upcoming  — count of upcoming (expected_at) rows
 *   past      — count of past (reported_at) rows
 *   errorCode — "EMPTY_SYMBOL" | "DB_ERROR" (only on !ok)
 */
export async function syncBoardMeetings(symbol, supabase) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) {
    return { ok: false, written: 0, upcoming: 0, past: 0,
             error: "empty symbol", errorCode: "EMPTY_SYMBOL" };
  }

  const meetings = await fetchBoardMeetings(sym);

  // Always stamp nse_synced_at — even an empty response is a successful sync
  // (it just means NSE has no announcements for this symbol right now).
  await supabase.from("stocks")
    .update({ nse_synced_at: new Date().toISOString() })
    .eq("symbol", sym);

  if (!meetings.length) {
    return { ok: true, written: 0, upcoming: 0, past: 0 };
  }

  let written = 0, upcoming = 0, past = 0;
  for (const m of meetings) {
    // For non-earnings events there's no quarter/financials row — use a synthetic
    // key like "DIVIDEND|2026-04-15" so it doesn't collide with earnings rows.
    const rowQuarter = m.isEarnings ? m.quarter : `${m.category}|${m.date}`;

    const payload = {
      symbol:      sym,
      quarter:     rowQuarter,
      purpose:     m.purpose  || null,
      category:    m.category || null,
      modified_at: new Date().toISOString(),
    };
    if (m.isUpcoming) { payload.expected_at = m.date; upcoming++; }
    else              { payload.reported_at = m.date; past++; }

    const { error } = await supabase
      .from("results")
      .upsert(payload, { onConflict: "symbol,quarter" });
    if (error) {
      console.warn(`[NSE] ${sym} ${m.category} ${m.date} upsert error: ${error.message}`);
    } else {
      written++;
    }
  }
  return { ok: true, written, upcoming, past };
}
