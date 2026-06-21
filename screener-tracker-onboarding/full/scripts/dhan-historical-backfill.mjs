import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

import { createDhanAuth, createSupabaseDhanAuthStateStore } from '../dhan_auth.mjs';
import { createDhanClient } from './lib/dhan-client.mjs';
import { normalizeHistoricalResponse } from './lib/dhan-normalize.mjs';

export function buildHistoricalRows(symbol, candles) {
  const byDate = new Map();
  for (const row of candles ?? []) {
    if (!row?.trade_date) continue;
    byDate.set(row.trade_date, {
      symbol,
      trade_date: row.trade_date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume ?? 0,
    });
  }
  return [...byDate.values()];
}

function createSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function dateYearsAgo(now = new Date(), years = 5) {
  const date = new Date(now);
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function isRateLimitError(err) {
  return /\b429\b|Rate_Limit|DH-904/i.test(err?.message ?? '');
}

async function withRateLimitRetry(fn, { retries = 2, retryDelayMs = 60_000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRateLimitError(err) || attempt === retries) break;
      await sleep(retryDelayMs * (attempt + 1));
    }
  }
  throw lastError;
}

export async function fetchDhanBackfillUniverse({ supabase, symbols = null, pageSize = 1000 } = {}) {
  const universe = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from('dhan_instruments')
      .select('symbol,dhan_security_id,dhan_exchange_segment')
      .neq('is_active', false)
      .not('dhan_security_id', 'is', null)
      .order('symbol', { ascending: true })
      .range(from, from + pageSize - 1);
    if (symbols?.length) query = query.in('symbol', symbols.map(s => String(s).toUpperCase()));

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    universe.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return universe;
}

export async function runDhanHistoricalBackfill({
  supabase = createSupabase(),
  dhanClient,
  symbols = null,
  fromDate = process.env.DHAN_BACKFILL_FROM_DATE ?? dateYearsAgo(new Date(), Number(process.env.DHAN_BACKFILL_YEARS ?? 5)),
  toDate = new Date().toISOString().slice(0, 10),
  delayMs = Number(process.env.DHAN_BACKFILL_DELAY_MS ?? 750),
  retries = Number(process.env.DHAN_BACKFILL_RETRIES ?? 2),
  retryDelayMs = Number(process.env.DHAN_BACKFILL_RETRY_DELAY_MS ?? 60_000),
  onProgress = null,
} = {}) {
  const client = dhanClient ?? createDhanClient({
    clientId: process.env.DHAN_CLIENT_ID,
    getAccessToken: createDhanAuth({
      stateStore: createSupabaseDhanAuthStateStore(supabase),
    }).getAccessToken,
  });

  const universe = await fetchDhanBackfillUniverse({ supabase, symbols });

  let success_count = 0;
  const failed_symbols = [];
  for (const [index, row] of (universe ?? []).entries()) {
    try {
      const payload = await withRateLimitRetry(() => client.fetchHistoricalDaily({
        securityId: row.dhan_security_id,
        exchangeSegment: row.dhan_exchange_segment ?? 'NSE_EQ',
        fromDate,
        toDate,
      }), { retries, retryDelayMs });
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
    onProgress?.({ index: index + 1, total: universe.length, symbol: row.symbol, success_count, failed_count: failed_symbols.length });
    if (delayMs > 0 && index < universe.length - 1) await sleep(delayMs);
  }

  return { attempted_count: universe.length, success_count, failed_count: failed_symbols.length, fromDate, toDate, failed_symbols };
}

export async function main() {
  const symbolsArg = process.argv.find(arg => arg.startsWith('--symbols='))?.split('=')[1];
  const symbols = symbolsArg ? symbolsArg.split(',').map(s => s.trim()).filter(Boolean) : null;
  const fromDateArg = process.argv.find(arg => arg.startsWith('--from-date='))?.split('=')[1];
  const yearsArg = process.argv.find(arg => arg.startsWith('--years='))?.split('=')[1];
  const delayArg = process.argv.find(arg => arg.startsWith('--delay-ms='))?.split('=')[1];
  const retriesArg = process.argv.find(arg => arg.startsWith('--retries='))?.split('=')[1];
  const retryDelayArg = process.argv.find(arg => arg.startsWith('--retry-delay-ms='))?.split('=')[1];
  const result = await runDhanHistoricalBackfill({
    symbols,
    fromDate: fromDateArg ?? (yearsArg == null ? undefined : dateYearsAgo(new Date(), Number(yearsArg))),
    delayMs: delayArg == null ? undefined : Number(delayArg),
    retries: retriesArg == null ? undefined : Number(retriesArg),
    retryDelayMs: retryDelayArg == null ? undefined : Number(retryDelayArg),
    onProgress: ({ index, total, symbol, success_count, failed_count }) => {
      if (index === 1 || index === total || index % 50 === 0) {
        console.error(JSON.stringify({ progress: `${index}/${total}`, symbol, success_count, failed_count }));
      }
    },
  });
  console.log(JSON.stringify(result));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
