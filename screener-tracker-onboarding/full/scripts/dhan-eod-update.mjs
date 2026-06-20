import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

import { isFreshLiveTick, todayIstDate } from './lib/dhan-time.mjs';

function candleFromLive(row, now) {
  if (!isFreshLiveTick(row.last_tick_at, now)) return null;
  if ([row.open, row.high, row.low, row.ltp].some(v => v == null)) return null;
  return {
    symbol: row.symbol,
    trade_date: String(row.trade_date).slice(0, 10),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.ltp),
    volume: Number(row.volume ?? 0),
  };
}

export function buildEodRows({ liveRows = [], fallbackQuotes = new Map(), now = new Date() } = {}) {
  const out = [];
  for (const live of liveRows) {
    const liveCandle = candleFromLive(live, now);
    if (liveCandle) {
      out.push(liveCandle);
      continue;
    }
    const fallback = fallbackQuotes.get(live.symbol);
    if (!fallback) continue;
    out.push({
      symbol: live.symbol,
      trade_date: String(live.trade_date ?? todayIstDate(now)).slice(0, 10),
      open: Number(fallback.open),
      high: Number(fallback.high),
      low: Number(fallback.low),
      close: Number(fallback.close ?? fallback.ltp),
      volume: Number(fallback.volume ?? 0),
    });
  }
  return out;
}

function createSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function runDhanEodUpdate({ supabase = createSupabase(), now = new Date(), fallbackQuotes = new Map() } = {}) {
  const { data: liveRows, error } = await supabase
    .from('dhan_live_today')
    .select('symbol,trade_date,open,high,low,ltp,volume,last_tick_at');
  if (error) throw new Error(error.message);

  const rows = buildEodRows({ liveRows: liveRows ?? [], fallbackQuotes, now });
  if (rows.length) {
    const { error: upsertErr } = await supabase
      .from('dhan_daily_candles')
      .upsert(rows, { onConflict: 'symbol,trade_date' });
    if (upsertErr) throw new Error(upsertErr.message);
  }

  const { error: clearErr } = await supabase.from('dhan_live_today').delete().neq('symbol', '');
  if (clearErr) throw new Error(clearErr.message);
  return { finalized: rows.length, cleared: liveRows?.length ?? 0 };
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
