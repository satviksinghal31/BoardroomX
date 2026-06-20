// ─────────────────────────────────────────────────────────────────────────────
//  NSE Universe Refresh
//
//  Sources:
//    1. EQUITY_L.csv  — symbol, company name, ISIN, face_value, date_of_listing
//       Filtered to SERIES = EQ only.
//    2. bhavcopy ZIP  — mcap{DDMMYYYY}.csv inside PR{DDMMYY}.zip
//       URL: https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/
//       Tries today → walks back up to 5 trading days to find latest available.
//
//  Called nightly at midnight IST by server.js scheduler.
//  Can also be run manually:
//    node scripts/refresh-universe.mjs
//    node scripts/refresh-universe.mjs --dry-run
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { execSync }      from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join }          from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }

/** DD-MM-YY format used in bhavcopy ZIP filename */
function bhavZipDate(d) {
  return pad2(d.getDate()) + pad2(d.getMonth() + 1) + String(d.getFullYear()).slice(2);
}
/** DDMMYYYY format used inside the ZIP for file names */
function bhavFileDate(d) {
  return pad2(d.getDate()) + pad2(d.getMonth() + 1) + d.getFullYear();
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

// ── EQUITY_L.csv ──────────────────────────────────────────────────────────────
// Columns: SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE

async function fetchEquityList() {
  console.log('  Fetching EQUITY_L.csv…');
  const txt = await fetchText('https://archives.nseindia.com/content/equities/EQUITY_L.csv');
  const lines = txt.trim().split('\n');
  const rows  = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 8) continue;
    const symbol     = cols[0].trim();
    const name       = cols[1].trim();
    const series     = cols[2].trim();
    const listing    = cols[3].trim();  // DD-MON-YYYY
    const isin       = cols[6].trim();
    const faceValue  = parseFloat(cols[7]) || null;

    if (series !== 'EQ') continue;  // EQ only
    if (!symbol) continue;

    rows.push({ symbol, company_name: name, isin, face_value: faceValue, date_of_listing: listing });
  }

  console.log(`  EQUITY_L: ${rows.length} EQ stocks`);
  return rows;
}

// ── bhavcopy mcap CSV ─────────────────────────────────────────────────────────
// ZIP URL:  https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR{DDMMYY}.zip
// File inside: mcap{DDMMYYYY}.csv
// Columns: Trade Date,Symbol,Series,Security Name,Category,Last Trade Date,
//          Face Value(Rs.),Issue Size,Close Price/Paid up value(Rs.),Market Cap(Rs.)

async function fetchMcapMap() {
  console.log('  Fetching bhavcopy mcap…');
  const BHAVCOPY_BASE = 'https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/';

  // Walk back up to 7 days: handles weekends, holidays, and extraction failures.
  // Each iteration gets its own unique temp path (no concurrent-instance collisions).
  for (let back = 0; back <= 7; back++) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    const zd  = bhavZipDate(d);
    const fd  = bhavFileDate(d);
    const url = BHAVCOPY_BASE + 'PR' + zd + '.zip';
    const TMP_ZIP = `/tmp/bhavcopy_${Date.now()}_${process.pid}_${back}.zip`;

    // ── Download ZIP ──────────────────────────────────────────────────────
    try {
      execSync(`curl -sf -A "${UA}" -o "${TMP_ZIP}" "${url}"`, { stdio: 'pipe' });
    } catch {
      continue;  // HTTP 404 / network error — try previous trading day
    }

    // ── Extract mcap CSV ──────────────────────────────────────────────────
    const csvName = `mcap${fd}.csv`;
    let csvTxt;
    try {
      csvTxt = execSync(`unzip -p "${TMP_ZIP}" "${csvName}"`, { encoding: 'utf8' });
    } catch {
      // ZIP downloaded but CSV not found inside — NSE occasionally changes
      // the filename format or the ZIP is incomplete. Try the previous day.
      console.warn(`  bhavcopy PR${zd}.zip: extraction failed (${csvName} missing) — trying previous day`);
      if (existsSync(TMP_ZIP)) unlinkSync(TMP_ZIP);
      continue;  // ← key fix: was "return null" before, which gave up immediately
    }
    if (existsSync(TMP_ZIP)) unlinkSync(TMP_ZIP);

    // ── Parse mcap CSV → Map<symbol, mcap> ───────────────────────────────
    const lines   = csvTxt.trim().split('\n');
    const mcapMap = new Map();
    for (let i = 1; i < lines.length; i++) {
      const cols   = lines[i].split(',');
      if (cols.length < 10) continue;
      const symbol = cols[1].trim();
      const series = cols[2].trim();
      const mcap   = parseFloat(cols[9].trim().replace(/\s/g, '')) || null;
      if (!symbol || series !== 'EQ') continue;
      if (mcap && mcap > 0) mcapMap.set(symbol, mcap);
    }

    if (mcapMap.size === 0) {
      console.warn(`  bhavcopy PR${zd}.zip: parsed 0 EQ rows — trying previous day`);
      continue;  // bad file; try older date
    }

    const label = back === 0 ? 'today' : `${back}d ago`;
    console.log(`  bhavcopy: PR${zd}.zip (${label}) — ${mcapMap.size} EQ entries`);
    return mcapMap;
  }

  console.warn('  WARNING: no valid bhavcopy found in last 7 days — market_cap unchanged');
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function refreshUniverse() {
  console.log(`\n[universe] refresh start  dry=${DRY_RUN}`);
  const t0 = Date.now();

  // Fetch both sources in parallel
  const [equityRows, mcapMap] = await Promise.all([
    fetchEquityList(),
    fetchMcapMap(),
  ]);

  // Merge mcap into equity rows
  const rows = equityRows.map(r => ({
    ...r,
    market_cap: mcapMap?.get(r.symbol) ?? null,
    updated_at: new Date().toISOString(),
  }));

  if (DRY_RUN) {
    console.log(`[universe] DRY RUN — would upsert ${rows.length} rows`);
    console.log('  Sample:', JSON.stringify(rows[0]));
    return { upserted: 0, total: rows.length };
  }

  // Batch upsert (200 at a time)
  const BATCH = 200;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('nse_universe')
      .upsert(batch, { onConflict: 'symbol' });
    if (error) {
      console.error(`  Batch ${i} error: ${error.message}`);
    } else {
      upserted += batch.length;
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[universe] done — ${upserted}/${rows.length} upserted in ${elapsed}s`);
  return { upserted, total: rows.length };
}

// ── Mcap-only nightly refresh ─────────────────────────────────────────────────
// Used by the midnight scheduler — only updates market_cap column.
// Does NOT re-fetch EQUITY_L (symbol list changes rarely; do that manually).

export async function refreshMcapOnly() {
  console.log('\n[universe-mcap] refresh start');
  const t0     = Date.now();
  const mcapMap = await fetchMcapMap();

  if (!mcapMap || mcapMap.size === 0) {
    console.warn('[universe-mcap] no mcap data — skipping DB update');
    return { updated: 0, total: 0, reason: 'no_bhavcopy' };
  }

  // Build update rows — only symbol + market_cap + updated_at
  const rows = [];
  for (const [symbol, market_cap] of mcapMap) {
    rows.push({ symbol, market_cap, updated_at: new Date().toISOString() });
  }

  if (DRY_RUN) {
    console.log(`[universe-mcap] DRY RUN — would update ${rows.length} mcap rows`);
    return { updated: 0, total: rows.length };
  }

  const BATCH = 200;
  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('nse_universe')
      .upsert(batch, { onConflict: 'symbol', ignoreDuplicates: false });
    if (error) console.error(`  mcap batch ${i} error: ${error.message}`);
    else updated += batch.length;
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[universe-mcap] done — ${updated} mcap rows updated in ${elapsed}s`);
  return { updated, total: rows.length };
}

// Run directly if called as script
if (process.argv[1].endsWith('refresh-universe.mjs')) {
  const mode = process.argv.includes('--mcap-only') ? 'mcap' : 'full';
  const fn   = mode === 'mcap' ? refreshMcapOnly : refreshUniverse;
  fn()
    .then(r => { console.log('Result:', r); process.exit(0); })
    .catch(e => { console.error('Fatal:', e); process.exit(1); });
}
