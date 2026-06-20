import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

import { createDhanAuth, createSupabaseDhanAuthStateStore } from '../dhan_auth.mjs';
import { createDhanClient } from './lib/dhan-client.mjs';
import { normalizeHistoricalResponse } from './lib/dhan-normalize.mjs';

export function buildHistoricalRows(symbol, candles) {
  return (candles ?? []).map(row => ({
    symbol,
    trade_date: row.trade_date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume ?? 0,
  }));
}

function createSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function runDhanHistoricalBackfill({ supabase = createSupabase(), dhanClient, symbols = null } = {}) {
  const client = dhanClient ?? createDhanClient({
    clientId: process.env.DHAN_CLIENT_ID,
    getAccessToken: createDhanAuth({
      stateStore: createSupabaseDhanAuthStateStore(supabase),
    }).getAccessToken,
  });

  let query = supabase
    .from('nse_universe')
    .select('symbol,dhan_security_id,dhan_exchange_segment,date_of_listing')
    .neq('is_active', false)
    .not('dhan_security_id', 'is', null);
  if (symbols?.length) query = query.in('symbol', symbols.map(s => String(s).toUpperCase()));
  const { data: universe, error } = await query;
  if (error) throw new Error(error.message);

  let success_count = 0;
  const failed_symbols = [];
  for (const row of universe ?? []) {
    try {
      const payload = await client.fetchHistoricalDaily({
        securityId: row.dhan_security_id,
        exchangeSegment: row.dhan_exchange_segment ?? 'NSE_EQ',
        fromDate: row.date_of_listing ?? '1990-01-01',
        toDate: new Date().toISOString().slice(0, 10),
      });
      const rows = buildHistoricalRows(row.symbol, normalizeHistoricalResponse(payload));
      if (rows.length) {
        const { error: upsertErr } = await supabase
          .from('dhan_daily_candles')
          .upsert(rows, { onConflict: 'symbol,trade_date' });
        if (upsertErr) throw new Error(upsertErr.message);
      }
      success_count += 1;
    } catch (err) {
      failed_symbols.push({ symbol: row.symbol, error: err.message });
    }
  }

  return { success_count, failed_count: failed_symbols.length, failed_symbols };
}

export async function main() {
  const symbolsArg = process.argv.find(arg => arg.startsWith('--symbols='))?.split('=')[1];
  const symbols = symbolsArg ? symbolsArg.split(',').map(s => s.trim()).filter(Boolean) : null;
  const result = await runDhanHistoricalBackfill({ symbols });
  console.log(JSON.stringify(result));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
