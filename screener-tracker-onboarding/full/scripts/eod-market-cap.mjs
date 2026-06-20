import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const BHAVCOPY_BASE = 'https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/';

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function bhavZipDate(d) {
  return pad2(d.getDate()) + pad2(d.getMonth() + 1) + String(d.getFullYear()).slice(2);
}

export function bhavFileDate(d) {
  return pad2(d.getDate()) + pad2(d.getMonth() + 1) + d.getFullYear();
}

function parseNseDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const months = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };
  const match = text.match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/i);
  if (!match) return null;
  return `${match[3]}-${months[match[2].toUpperCase()]}-${pad2(match[1])}`;
}

function toNumber(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

export function parseMarketCapCsv(csv, sourceFile = null) {
  const [headerLine, ...lines] = String(csv ?? '').trim().split(/\r?\n/);
  if (!headerLine) return [];
  const headers = headerLine.split(',').map(h => h.trim());
  const index = name => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const fields = {
    tradeDate: index('Trade Date'),
    symbol: index('Symbol'),
    series: index('Series'),
    securityName: index('Security Name'),
    category: index('Category'),
    lastTradeDate: index('Last Trade Date'),
    faceValue: index('Face Value(Rs.)'),
    issueSize: index('Issue Size'),
    closePrice: index('Close Price/Paid up value(Rs.)'),
    marketCap: index('Market Cap(Rs.)'),
  };

  return lines.filter(Boolean).map(line => {
    const cols = line.split(',');
    return {
      trade_date: parseNseDate(cols[fields.tradeDate]),
      symbol: String(cols[fields.symbol] ?? '').trim().toUpperCase(),
      series: String(cols[fields.series] ?? '').trim(),
      security_name: String(cols[fields.securityName] ?? '').trim(),
      category: String(cols[fields.category] ?? '').trim(),
      last_trade_date: parseNseDate(cols[fields.lastTradeDate]),
      face_value: toNumber(cols[fields.faceValue]),
      issue_size: toNumber(cols[fields.issueSize]),
      close_price: toNumber(cols[fields.closePrice]),
      market_cap: toNumber(cols[fields.marketCap]),
      source_file: sourceFile,
    };
  }).filter(row => row.trade_date && row.symbol && row.series && row.market_cap != null);
}

export function buildBhavcopyCandidates(now = new Date(), lookbackDays = 7) {
  return Array.from({ length: lookbackDays + 1 }, (_, back) => {
    const d = new Date(now);
    d.setDate(d.getDate() - back);
    const zipDate = bhavZipDate(d);
    const fileDate = bhavFileDate(d);
    return {
      back,
      zipDate,
      fileDate,
      url: `${BHAVCOPY_BASE}PR${zipDate}.zip`,
      csvName: `mcap${fileDate}.csv`,
    };
  });
}

export function fetchLatestMarketCapCsv({ candidates = buildBhavcopyCandidates(), execFile = execSync } = {}) {
  for (const candidate of candidates) {
    const tmpZip = `/tmp/bhavcopy_${Date.now()}_${process.pid}_${candidate.back}.zip`;
    try {
      execFile(`curl -sf -A "${UA}" -o "${tmpZip}" "${candidate.url}"`, { stdio: 'pipe' });
      const csv = execFile(`unzip -p "${tmpZip}" "${candidate.csvName}"`, { encoding: 'utf8' });
      return { csv, sourceFile: candidate.csvName, url: candidate.url };
    } catch {
      // Try the previous trading day.
    } finally {
      if (existsSync(tmpZip)) unlinkSync(tmpZip);
    }
  }
  return null;
}

function createSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function runEodMarketCap({ supabase = createSupabase(), fetched = fetchLatestMarketCapCsv() } = {}) {
  if (!fetched?.csv) return { updated: 0, total: 0, reason: 'no_bhavcopy' };
  const rows = parseMarketCapCsv(fetched.csv, fetched.sourceFile);
  if (DRY_RUN) return { updated: 0, total: rows.length, dry_run: true };

  let updated = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase
      .from('nse_eod_market_caps')
      .upsert(batch, { onConflict: 'trade_date,symbol,series' });
    if (error) throw new Error(error.message);
    updated += batch.length;
  }
  return { updated, total: rows.length, source_file: fetched.sourceFile };
}

export async function main() {
  const result = await runEodMarketCap();
  console.log(JSON.stringify(result));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
