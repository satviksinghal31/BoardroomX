import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

import { createDhanAuth, createSupabaseDhanAuthStateStore } from '../dhan_auth.mjs';
import { buildHistoricalRows, fetchDhanBackfillUniverse } from './dhan-historical-backfill.mjs';
import { createDhanClient } from './lib/dhan-client.mjs';
import { normalizeHistoricalResponse } from './lib/dhan-normalize.mjs';
import { todayIstDate } from './lib/dhan-time.mjs';

const DEFAULT_EOD_DELAY_MS = 2500;

function createSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function eodRepairWindow(now = new Date()) {
  const toDate = todayIstDate(now);
  const from = new Date(`${toDate}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 2);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runDhanEodUpdate({
  supabase = createSupabase(),
  dhanClient,
  now = new Date(),
  symbols = null,
  delayMs = Number(process.env.DHAN_EOD_DELAY_MS ?? DEFAULT_EOD_DELAY_MS),
  sleepFn = sleep,
} = {}) {
  const client = dhanClient ?? createDhanClient({
    clientId: process.env.DHAN_CLIENT_ID,
    getAccessToken: createDhanAuth({
      stateStore: createSupabaseDhanAuthStateStore(supabase),
    }).getAccessToken,
  });

  const { fromDate, toDate } = eodRepairWindow(now);
  const universe = await fetchDhanBackfillUniverse({ supabase, symbols });

  let repaired = 0;
  const failed_symbols = [];
  for (const [index, row] of universe.entries()) {
    if (index > 0 && delayMs > 0) await sleepFn(delayMs);
    try {
      const payload = await client.fetchHistoricalDaily({
        securityId: row.dhan_security_id,
        exchangeSegment: row.dhan_exchange_segment ?? 'NSE_EQ',
        fromDate,
        toDate,
      });
      const rows = buildHistoricalRows(row, normalizeHistoricalResponse(payload));
      if (rows.length) {
        const { error: upsertErr } = await supabase
          .from('dhan_daily_candles')
          .upsert(rows, { onConflict: 'instrument_id,trade_date' });
        if (upsertErr) throw new Error(upsertErr.message);
        repaired += rows.length;
      }
    } catch (err) {
      failed_symbols.push({ symbol: row.symbol, error: err.message });
    }
  }

  const { error: clearErr } = await supabase.from('dhan_live_today').delete().neq('symbol', '');
  if (clearErr) throw new Error(clearErr.message);
  return {
    attempted_count: universe.length,
    repaired,
    cleared_live: true,
    fromDate,
    toDate,
    failed_count: failed_symbols.length,
    failed_symbols,
  };
}

export async function main() {
  const result = await runDhanEodUpdate();
  console.log(JSON.stringify(result));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
