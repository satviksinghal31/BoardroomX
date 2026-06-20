import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

import { createDhanClient } from './lib/dhan-client.mjs';
import { createDhanAuth, createSupabaseDhanAuthStateStore } from '../dhan_auth.mjs';

function pick(row, names) {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim() !== '') return String(row[name]).trim();
  }
  return '';
}

export function filterDhanEquityRows(rows) {
  return (rows ?? [])
    .filter(row =>
      pick(row, ['EXCH_ID', 'EXCH_ID ']) === 'NSE' &&
      pick(row, ['SEGMENT']) === 'E' &&
      pick(row, ['SERIES']) === 'EQ')
    .map(row => ({
      symbol: pick(row, ['UNDERLYING_SYMBOL', 'SEM_TRADING_SYMBOL', 'SYMBOL']).toUpperCase(),
      isin: pick(row, ['ISIN']),
      dhan_security_id: pick(row, ['SECURITY_ID', 'SEM_SMST_SECURITY_ID']),
      dhan_exchange_segment: 'NSE_EQ',
      is_active: true,
    }))
    .filter(row => row.symbol && row.dhan_security_id);
}

export function buildInactiveSymbols(existingSymbols, seenSymbols) {
  return (existingSymbols ?? [])
    .map(symbol => String(symbol).trim().toUpperCase())
    .filter(symbol => symbol && !seenSymbols.has(symbol))
    .sort();
}

export function parseCsvRows(csv) {
  const [headerLine, ...lines] = String(csv ?? '').trim().split(/\r?\n/);
  if (!headerLine) return [];
  const headers = headerLine.split(',').map(h => h.trim());
  return lines.filter(Boolean).map(line => {
    const cols = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cols[i]?.trim() ?? '']));
  });
}

function createSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function runDhanInstrumentSync({ supabase = createSupabase(), dhanClient } = {}) {
  const client = dhanClient ?? createDhanClient({
    clientId: process.env.DHAN_CLIENT_ID,
    getAccessToken: createDhanAuth({
      stateStore: createSupabaseDhanAuthStateStore(supabase),
    }).getAccessToken,
  });
  const csv = await client.fetchScripMasterCsv();
  const rows = filterDhanEquityRows(parseCsvRows(csv));
  const seen = new Set(rows.map(row => row.symbol));

  const { data: existing, error: existingErr } = await supabase
    .from('nse_universe')
    .select('symbol')
    .neq('is_active', false);
  if (existingErr) throw new Error(existingErr.message);

  const inactive = buildInactiveSymbols((existing ?? []).map(row => row.symbol), seen);

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase
      .from('nse_universe')
      .upsert(batch, { onConflict: 'symbol' });
    if (error) throw new Error(error.message);
  }

  if (inactive.length) {
    const { error } = await supabase
      .from('nse_universe')
      .update({ is_active: false })
      .in('symbol', inactive);
    if (error) throw new Error(error.message);
  }

  return { mapped: rows.length, inactive: inactive.length };
}

export async function main() {
  const result = await runDhanInstrumentSync();
  console.log(JSON.stringify(result));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
