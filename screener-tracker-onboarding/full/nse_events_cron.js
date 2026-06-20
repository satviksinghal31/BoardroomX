// ─────────────────────────────────────────────────────────────────────────────
//  NSE Events Cron
//
//  Runs twice daily (8am + 8pm IST).
//  Each run fetches two windows from /api/event-calendar:
//    • Last 7 days  — catches recently confirmed / updated events
//    • Next 90 days — upcoming board meetings
//
//  No classification, no clustering — raw upsert into nse_events.
//  Dedup is handled by the unique_key PK (normalized symbol|purpose|bm_desc|date).
// ─────────────────────────────────────────────────────────────────────────────

const NSE_HOME = 'https://www.nseindia.com/';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── Date helpers ──────────────────────────────────────────────────────────────

function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function daysOffset(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

const NSE_MONTHS = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;

  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) return null;

  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function canonicalEventDate(value) {
  const raw = cleanText(value);
  const m = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const [, day, mon, year] = m;
    const month = NSE_MONTHS[mon.slice(0, 1).toUpperCase() + mon.slice(1, 3).toLowerCase()];
    return month ? validIsoDate(year, month, day) ?? raw : raw;
  }

  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return validIsoDate(iso[1], iso[2], iso[3]) ?? raw;

  const numeric = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!numeric) return raw;

  const [, first, second, year] = numeric;
  const a = Number(first);
  const b = Number(second);
  if (a > 12 && b <= 12) return validIsoDate(year, second, first) ?? raw;
  if (b > 12 && a <= 12) return validIsoDate(year, first, second) ?? raw;

  // NSE India dates are date-first. If both sides are plausible, prefer DD-MM-YYYY.
  return validIsoDate(year, second, first) ?? raw;
}

// ── NSE fetch ─────────────────────────────────────────────────────────────────

async function _warmCookie() {
  const home = await fetch(NSE_HOME, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
    redirect: 'follow',
  });
  const cookies = home.headers.getSetCookie?.() ?? [];
  return cookies.map(c => c.split(';')[0]).join('; ');
}

async function fetchEventWindow(fromStr, toStr) {
  const cookie = await _warmCookie();
  const url    = `https://www.nseindia.com/api/event-calendar?index=equities&from_date=${fromStr}&to_date=${toStr}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':       UA,
      'Accept':           'application/json,*/*',
      'Referer':          NSE_HOME,
      'X-Requested-With': 'XMLHttpRequest',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  if (!res.ok) throw new Error(`NSE HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
}

// ── Row builder ───────────────────────────────────────────────────────────────

export function buildRow(raw) {
  const symbol  = cleanText(raw.symbol).toUpperCase();
  const company = cleanText(raw.company);
  const purpose = cleanText(raw.purpose);
  const bm_desc = cleanText(raw.bm_desc);
  const date    = cleanText(raw.date);
  const keyDate = canonicalEventDate(date);
  return {
    unique_key: `${symbol}|${purpose}|${bm_desc}|${keyDate}`,
    symbol,
    company:  company || null,
    purpose:  purpose || null,
    bm_desc:  bm_desc || null,
    date:     date    || null,
  };
}

// ── Core run logic ────────────────────────────────────────────────────────────

export async function runEventsCron(supabase) {
  const now          = new Date();
  // Capture start time BEFORE any work so the post-upsert count is accurate.
  // We use this to count genuinely new rows (ingested_at >= cronStart) because
  // Supabase's ignoreDuplicates:true upsert returns an empty .select() result
  // even for inserted rows (PostgREST ON CONFLICT DO NOTHING limitation), making
  // the data.length-based counter always show new=0.
  const cronStartIso = now.toISOString();
  const past7  = { from: fmtDate(daysOffset(now, -7)),  to: fmtDate(now) };
  const next90 = { from: fmtDate(now),                  to: fmtDate(daysOffset(now, 90)) };

  console.log(`[events-cron] run started — past7: ${past7.from}→${past7.to}  next90: ${next90.from}→${next90.to}`);

  const byKey = new Map();
  let totalFetched = 0;

  for (const win of [past7, next90]) {
    try {
      if (byKey.size > 0) await new Promise(r => setTimeout(r, 800)); // small gap between calls
      const raw = await fetchEventWindow(win.from, win.to);
      for (const r of raw) {
        const row = buildRow(r);
        if (row.symbol && !byKey.has(row.unique_key)) byKey.set(row.unique_key, row);
      }
      totalFetched += raw.length;
      console.log(`[events-cron]   ${win.from}→${win.to}  fetched=${raw.length}  running_total=${byKey.size}`);
    } catch (err) {
      console.error(`[events-cron]   window ${win.from}→${win.to} ERROR: ${err.message}`);
    }
  }

  const rows = [...byKey.values()];
  if (!rows.length) {
    console.warn('[events-cron] no rows to upsert');
    return { fetched: totalFetched, upserted: 0, new: 0 };
  }

  // Batch upsert — ignoreDuplicates skips existing unique_key rows entirely
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('nse_events')
      .upsert(batch, { onConflict: 'unique_key', ignoreDuplicates: true });
    if (error) console.error(`[events-cron]   batch ${i} error: ${error.message}`);
  }

  // Count genuinely new rows by querying ingested_at >= cronStart.
  // We cannot use upsert .select() return for this: PostgREST returns an empty
  // array for ON CONFLICT DO NOTHING even when rows ARE inserted, causing
  // the data.length counter to always show new=0 (confirmed: RPPL, TOLINS showed
  // as newly ingested at 08:00 but cron logged new=0).
  let inserted = 0;
  const { count: newCount, error: cntErr } = await supabase
    .from('nse_events')
    .select('*', { count: 'exact', head: true })
    .gte('ingested_at', cronStartIso);
  if (cntErr) {
    console.warn(`[events-cron] new-row count failed: ${cntErr.message} — reporting new=?`);
  } else {
    inserted = newCount ?? 0;
  }
  const skipped = rows.length - inserted;

  console.log(`[events-cron] done — fetched=${totalFetched} upserted=${rows.length} new=${inserted} dup=${skipped}`);
  return { fetched: totalFetched, upserted: rows.length, new: inserted, dup: skipped };
}
