// ─────────────────────────────────────────────────────────────────────────────
//  NSE Event Calendar — 12-month Backfill
//
//  Fetches last 12 months from NSE /api/event-calendar in 30-day windows
//  (bulk mode: index=equities) to avoid API truncation, then upserts into
//  the nse_events table.
//
//  Usage:
//    node scripts/backfill-events.mjs
//    node scripts/backfill-events.mjs --dry-run
//    node scripts/backfill-events.mjs --months=6
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ── CLI flags ─────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const MONTHS    = parseInt(args.find(a => a.startsWith('--months='))?.split('=')[1] ?? '12');
const DRY_RUN   = args.includes('--dry-run');
const WIN_DAYS  = 30;

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ── NSE fetch helpers ─────────────────────────────────────────────────────────
const NSE_HOME = 'https://www.nseindia.com/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

async function fetchWindow(fromStr, toStr) {
  // Fresh cookie warm-up per window
  const home   = await fetch(NSE_HOME, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
    redirect: 'follow',
  });
  const cookie = (home.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');

  const url = `https://www.nseindia.com/api/event-calendar?index=equities&from_date=${fromStr}&to_date=${toStr}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':       UA,
      'Accept':           'application/json,*/*',
      'Referer':          NSE_HOME,
      'X-Requested-With': 'XMLHttpRequest',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  if (!res.ok) throw new Error(`NSE HTTP ${res.status} for ${fromStr}→${toStr}`);
  const json = await res.json();
  return Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
}

// ── Row builder ───────────────────────────────────────────────────────────────
function buildRow(raw) {
  const symbol  = (raw.symbol  || '').trim();
  const purpose = (raw.purpose || '').trim();
  const bm_desc = (raw.bm_desc || '').trim();
  const date    = (raw.date    || '').trim();

  const unique_key = `${symbol}|${purpose}|${bm_desc}|${date}`;

  return {
    unique_key,
    symbol,
    company:  (raw.company || '').trim() || null,
    purpose:  purpose || null,
    bm_desc:  bm_desc || null,
    date:     date    || null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  NSE Event Calendar — Backfill                       ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`  Look-back : ${MONTHS} months (${WIN_DAYS}-day windows)`);
  console.log(`  Dry run   : ${DRY_RUN ? 'YES — no DB writes' : 'NO — will upsert to nse_events'}\n`);

  // Build windows: walk backwards from today
  const today   = new Date();
  const cutoff  = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - MONTHS);

  const windows = [];
  let winEnd = new Date(today);
  while (winEnd > cutoff) {
    const winStart = new Date(winEnd);
    winStart.setDate(winStart.getDate() - WIN_DAYS + 1);
    if (winStart < cutoff) winStart.setTime(cutoff.getTime());
    windows.push({ from: fmtDate(winStart), to: fmtDate(winEnd) });
    winEnd = new Date(winStart);
    winEnd.setDate(winEnd.getDate() - 1);
  }

  console.log(`  Windows   : ${windows.length}  (${windows[windows.length - 1].from} → ${windows[0].to})\n`);

  // Fetch all windows, dedup globally
  const globalByKey = new Map();
  let totalFetched  = 0;
  let windowErrors  = 0;

  for (let i = 0; i < windows.length; i++) {
    const { from, to } = windows[i];
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${windows.length}] ${from} → ${to}  `);

    try {
      if (i > 0) await new Promise(r => setTimeout(r, 800));

      const raw = await fetchWindow(from, to);
      for (const r of raw) {
        const row = buildRow(r);
        if (!row.symbol) continue;
        if (!globalByKey.has(row.unique_key)) globalByKey.set(row.unique_key, row);
      }
      totalFetched += raw.length;
      console.log(`fetched=${raw.length}  unique_total=${globalByKey.size}`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      windowErrors++;
    }
  }

  console.log('\n  ─────────────────────────────────────────────────────');
  console.log(`  Total fetched  : ${totalFetched.toLocaleString()} raw rows`);
  console.log(`  After dedup    : ${globalByKey.size.toLocaleString()} unique rows`);
  console.log(`  Window errors  : ${windowErrors}`);

  if (DRY_RUN) {
    console.log('\n  DRY RUN — skipping DB write.\n');
    // Show sample
    const sample = [...globalByKey.values()].slice(0, 3);
    console.log('  Sample rows:');
    sample.forEach(r => console.log('  ', JSON.stringify(r)));
    return;
  }

  // Batch upsert
  console.log('\n  Upserting to nse_events…');
  const rows  = [...globalByKey.values()];
  const BATCH = 200;
  let inserted = 0, skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('nse_events')
      .upsert(batch, { onConflict: 'unique_key', ignoreDuplicates: true })
      .select('unique_key');

    if (error) {
      console.error(`  Batch ${i}–${i + BATCH} error: ${error.message}`);
    } else {
      inserted += data?.length ?? 0;
      skipped  += batch.length - (data?.length ?? 0);
    }

    if (i % (BATCH * 5) === 0) {
      process.stdout.write(`\r  Progress: ${Math.min(i + BATCH, rows.length)}/${rows.length}  (new=${inserted} dup=${skipped})   `);
    }
  }

  console.log(`\n\n  ═══════════════════════════════════════════════════════`);
  console.log(`  Backfill complete`);
  console.log(`  ───────────────────────────────────────────────────────`);
  console.log(`  Total unique rows : ${rows.length.toLocaleString()}`);
  console.log(`  Newly inserted    : ${inserted.toLocaleString()}`);
  console.log(`  Skipped (dups)    : ${skipped.toLocaleString()}`);
  console.log(`  Window errors     : ${windowErrors}`);
  console.log(`  ═══════════════════════════════════════════════════════\n`);
}

main().catch(err => { console.error('\nFatal:', err); process.exit(1); });
