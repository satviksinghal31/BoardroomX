import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

import { createDhanAuth, createSupabaseDhanAuthStateStore } from '../dhan_auth.mjs';
import { fetchDhanBackfillUniverse } from './dhan-historical-backfill.mjs';
import { createDhanClient } from './lib/dhan-client.mjs';
import { decodeCandleSeries, encodeCandleSeries, mergeCandleSeries, normalizeHistoricalResponse } from './lib/dhan-normalize.mjs';
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

function isNoDataHistoricalError(err) {
  return /DH-905|no data present/i.test(err?.message ?? '');
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
  const skipped_no_data_symbols = [];
  for (const [index, row] of universe.entries()) {
    if (index > 0 && delayMs > 0) await sleepFn(delayMs);
    try {
      const payload = await client.fetchHistoricalDaily({
        securityId: row.dhan_security_id,
        exchangeSegment: row.dhan_exchange_segment ?? 'NSE_EQ',
        fromDate,
        toDate,
      });
      const repairs = normalizeHistoricalResponse(payload);
      if (repairs.length) {
        const { data: existing, error: existingErr } = await supabase
          .from('dhan_daily_candle_series')
          .select('candles_gzip_base64')
          .eq('instrument_id', row.instrument_id)
          .maybeSingle();
        if (existingErr) throw new Error(existingErr.message);

        const series = mergeCandleSeries(decodeCandleSeries(existing?.candles_gzip_base64), repairs);
        const { error: upsertErr } = await supabase
          .from('dhan_daily_candle_series')
          .upsert([{
            instrument_id: row.instrument_id,
            from_date: series[0].trade_date,
            to_date: series.at(-1).trade_date,
            candle_count: series.length,
            candles_gzip_base64: encodeCandleSeries(series),
          }], { onConflict: 'instrument_id' });
        if (upsertErr) throw new Error(upsertErr.message);
        repaired += repairs.length;
      }
    } catch (err) {
      if (isNoDataHistoricalError(err)) {
        skipped_no_data_symbols.push(row.symbol);
        continue;
      }
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
    skipped_no_data_count: skipped_no_data_symbols.length,
    skipped_no_data_symbols,
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
