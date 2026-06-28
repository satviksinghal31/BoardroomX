import { appendFreshLiveCandle, decodeCandleSeries, toChartCandle, toPriceResponse, toQuoteResponse } from './scripts/lib/dhan-normalize.mjs';
import { isNseMarketOpenIst } from './scripts/lib/dhan-time.mjs';

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase();
}

function displayFromYearsAgo(now, years = 1) {
  const date = new Date(now);
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function uniqueSymbols(symbols) {
  return [...new Set((symbols ?? []).map(normalizeSymbol).filter(Boolean))];
}

function week52FromCandles(candles, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 365);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  let week52High = null;
  let week52Low = null;
  for (const candle of candles ?? []) {
    const tradeDate = String(candle.trade_date ?? candle.time ?? '').slice(0, 10);
    if (!tradeDate || tradeDate < cutoffDate) continue;
    const high = Number(candle.high);
    const low = Number(candle.low);
    if (Number.isFinite(high)) week52High = week52High == null ? high : Math.max(week52High, high);
    if (Number.isFinite(low)) week52Low = week52Low == null ? low : Math.min(week52Low, low);
  }
  return { week52High, week52Low };
}

export function createDhanMarketData({
  dbPool,
  now = () => new Date(),
  isMarketOpen = isNseMarketOpenIst,
} = {}) {
  if (!dbPool?.query) throw new Error('dbPool with query() is required');

  return {
    async getChart(symbol) {
      const sym = normalizeSymbol(symbol);
      const [historyResult, liveResult] = await Promise.all([
        dbPool.query(`
          SELECT s.candles_gzip_base64
          FROM dhan_daily_candle_series s
          JOIN dhan_instruments i ON i.instrument_id = s.instrument_id
          WHERE i.symbol = $1
        `, [sym]),
        dbPool.query(`
          SELECT trade_date, open, high, low, ltp, volume, last_tick_at
          FROM dhan_live_today
          WHERE symbol = $1
        `, [sym]),
      ]);

      const candles = decodeCandleSeries(historyResult.rows[0]?.candles_gzip_base64).map(toChartCandle).filter(Boolean);
      const withLive = appendFreshLiveCandle(candles, liveResult.rows[0] ?? null, {
        now: now(),
        marketOpen: isMarketOpen(now()),
      });

      return {
        candles: withLive,
        displayFrom: displayFromYearsAgo(now()),
      };
    },

    async getPrices(symbols) {
      const list = uniqueSymbols(symbols);
      if (!list.length) return [];
      const { rows } = await dbPool.query(`
        SELECT symbol, trade_date, open, high, low, ltp, prev_close
        FROM dhan_live_today
        WHERE symbol = ANY($1)
        ORDER BY symbol ASC
      `, [list]);
      return rows.map(toPriceResponse);
    },

    async getQuote(symbol) {
      const sym = normalizeSymbol(symbol);
      const [quoteResult, seriesResult] = await Promise.all([
        dbPool.query(`
        SELECT
          u.symbol,
          u.company_name,
          u.market_cap,
          l.ltp,
          l.prev_close
        FROM market_universe u
        LEFT JOIN dhan_live_today l ON l.symbol = u.symbol
        WHERE u.symbol = $1
      `, [sym]),
        dbPool.query(`
          SELECT s.candles_gzip_base64
          FROM dhan_daily_candle_series s
          JOIN dhan_instruments i ON i.instrument_id = s.instrument_id
          WHERE i.symbol = $1
        `, [sym]),
      ]);
      if (!quoteResult.rows[0]) return { symbol: sym, name: sym, price: null, change: null, changePercent: null, mcap: null, week52High: null, week52Low: null };
      return toQuoteResponse({
        ...quoteResult.rows[0],
        ...week52FromCandles(decodeCandleSeries(seriesResult.rows[0]?.candles_gzip_base64), now()),
      });
    },

    async getQuotes(symbols) {
      const list = uniqueSymbols(symbols);
      if (!list.length) return new Map();
      const [quoteResult, seriesResult] = await Promise.all([
        dbPool.query(`
        SELECT
          u.symbol,
          u.company_name,
          u.market_cap,
          l.ltp,
          l.prev_close
        FROM market_universe u
        LEFT JOIN dhan_live_today l ON l.symbol = u.symbol
        WHERE u.symbol = ANY($1)
      `, [list]),
        dbPool.query(`
          SELECT i.symbol, s.candles_gzip_base64
          FROM dhan_daily_candle_series s
          JOIN dhan_instruments i ON i.instrument_id = s.instrument_id
          WHERE i.symbol = ANY($1)
        `, [list]),
      ]);
      const stats = new Map(seriesResult.rows.map(row => [
        row.symbol,
        week52FromCandles(decodeCandleSeries(row.candles_gzip_base64), now()),
      ]));
      return new Map(quoteResult.rows.map(row => [row.symbol, toQuoteResponse({ ...row, ...(stats.get(row.symbol) ?? {}) })]));
    },

    async getActiveUniverse() {
      const { rows } = await dbPool.query(`
        SELECT symbol, company_name, market_cap
        FROM market_universe
        WHERE is_active IS DISTINCT FROM false
        ORDER BY symbol ASC
      `);
      return rows;
    },

    async getLiveHealth() {
      const { rows } = await dbPool.query(`
        SELECT
          count(*) FILTER (WHERE dhan_security_id IS NOT NULL AND is_active IS DISTINCT FROM false)::int AS active_mapped,
          (SELECT count(*)::int FROM dhan_live_today WHERE last_tick_at > now() - interval '90 seconds') AS fresh_live_rows,
          (SELECT max(last_tick_at) FROM dhan_live_today) AS latest_tick_at
        FROM dhan_instruments
      `);
      return rows[0] ?? { active_mapped: 0, fresh_live_rows: 0, latest_tick_at: null };
    },
  };
}
