import { isFreshLiveTick } from './dhan-time.mjs';

function round(value, digits = 2) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function epochToDateString(epochSeconds) {
  return new Date(Number(epochSeconds) * 1000).toISOString().slice(0, 10);
}

export function normalizeHistoricalResponse(payload = {}) {
  const timestamps = payload.timestamp ?? [];
  return timestamps
    .map((timestamp, index) => ({
      trade_date: epochToDateString(timestamp),
      open: round(payload.open?.[index]),
      high: round(payload.high?.[index]),
      low: round(payload.low?.[index]),
      close: round(payload.close?.[index]),
      volume: Number(payload.volume?.[index] ?? 0),
    }))
    .filter(row => row.open != null && row.high != null && row.low != null && row.close != null)
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
}

export function toChartCandle(row) {
  if (!row) return null;
  const time = String(row.trade_date ?? row.time ?? '').slice(0, 10);
  if (!time) return null;
  return {
    time,
    open: round(row.open),
    high: round(row.high),
    low: round(row.low),
    close: round(row.close ?? row.ltp),
    volume: Number(row.volume ?? 0),
  };
}

export function appendFreshLiveCandle(candles, liveRow, options = {}) {
  const base = Array.isArray(candles) ? [...candles] : [];
  if (!liveRow || !options.marketOpen) return base;
  if (!isFreshLiveTick(liveRow.last_tick_at, options.now ?? new Date())) return base;

  const liveCandle = toChartCandle({
    trade_date: liveRow.trade_date,
    open: liveRow.open,
    high: liveRow.high,
    low: liveRow.low,
    close: liveRow.ltp,
    volume: liveRow.volume,
  });
  if (!liveCandle || liveCandle.open == null || liveCandle.high == null || liveCandle.low == null || liveCandle.close == null) {
    return base;
  }

  const last = base.at(-1);
  if (last?.time === liveCandle.time) return [...base.slice(0, -1), liveCandle];
  if (!last || liveCandle.time > last.time) return [...base, liveCandle];
  return base;
}

export function toPriceResponse(row) {
  const price = round(row?.ltp);
  const prevClose = round(row?.prev_close);
  const change = price != null && prevClose != null ? round(price - prevClose) : null;
  const changePercent = change != null && prevClose ? round((change / prevClose) * 100) : null;
  const candle = row?.trade_date
    ? {
        time: String(row.trade_date).slice(0, 10),
        open: round(row.open),
        high: round(row.high),
        low: round(row.low),
        close: price,
      }
    : null;

  return {
    symbol: row?.symbol,
    price,
    change,
    changePercent,
    candle,
  };
}

export function toQuoteResponse(row) {
  const price = round(row?.ltp);
  const prevClose = round(row?.prev_close);
  const change = price != null && prevClose != null ? round(price - prevClose) : null;
  const changePercent = change != null && prevClose ? round((change / prevClose) * 100) : null;

  return {
    symbol: row?.symbol,
    name: row?.company_name ?? row?.name ?? row?.symbol,
    price,
    change,
    changePercent,
    mcap: row?.market_cap ?? null,
    week52High: round(row?.week52High),
    week52Low: round(row?.week52Low),
  };
}
