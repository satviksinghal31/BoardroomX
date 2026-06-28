import { isFreshLiveTick } from './dhan-time.mjs';
import { gzipSync, gunzipSync } from 'node:zlib';

function round(value, digits = 2) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

export function rupeesToPaise(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function paiseToRupees(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return round(n / 100);
}

function normalizeCandleRow(row) {
  const tradeDate = String(row?.trade_date ?? row?.time ?? '').slice(0, 10);
  if (!tradeDate) return null;
  const open = round(row.open);
  const high = round(row.high);
  const low = round(row.low);
  const close = round(row.close ?? row.ltp);
  if (open == null || high == null || low == null || close == null) return null;
  return {
    trade_date: tradeDate,
    open,
    high,
    low,
    close,
    volume: Number(row.volume ?? 0),
  };
}

export function mergeCandleSeries(existing = [], repairs = []) {
  const byDate = new Map();
  for (const row of existing ?? []) {
    const candle = normalizeCandleRow(row);
    if (candle) byDate.set(candle.trade_date, candle);
  }
  for (const row of repairs ?? []) {
    const candle = normalizeCandleRow(row);
    if (candle) byDate.set(candle.trade_date, candle);
  }
  return [...byDate.values()].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
}

export function encodeCandleSeries(candles = []) {
  const normalized = mergeCandleSeries([], candles);
  return gzipSync(Buffer.from(JSON.stringify(normalized), 'utf8')).toString('base64');
}

export function decodeCandleSeries(value) {
  if (!value) return [];
  const json = gunzipSync(Buffer.from(String(value), 'base64')).toString('utf8');
  const parsed = JSON.parse(json);
  return mergeCandleSeries([], Array.isArray(parsed) ? parsed : []);
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
