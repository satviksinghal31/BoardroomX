import { appendFreshLiveCandle, toChartCandle, toPriceResponse, toQuoteResponse } from './scripts/lib/dhan-normalize.mjs';
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
          SELECT trade_date, open, high, low, close, volume
          FROM dhan_daily_candles
          WHERE symbol = $1
          ORDER BY trade_date ASC
        `, [sym]),
        dbPool.query(`
          SELECT trade_date, open, high, low, ltp, volume, last_tick_at
          FROM dhan_live_today
          WHERE symbol = $1
        `, [sym]),
      ]);

      const candles = historyResult.rows.map(toChartCandle).filter(Boolean);
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
      const { rows } = await dbPool.query(`
        WITH week52 AS (
          SELECT
            max(high) AS "week52High",
            min(low) AS "week52Low"
          FROM dhan_daily_candles
          WHERE symbol = $1
            AND trade_date >= CURRENT_DATE - interval '365 days'
        )
        SELECT
          u.symbol,
          u.company_name,
          u.market_cap,
          l.ltp,
          l.prev_close,
          week52."week52High",
          week52."week52Low"
        FROM market_universe u
        LEFT JOIN dhan_live_today l ON l.symbol = u.symbol
        CROSS JOIN week52
        WHERE u.symbol = $1
      `, [sym]);
      if (!rows[0]) return { symbol: sym, name: sym, price: null, change: null, changePercent: null, mcap: null, week52High: null, week52Low: null };
      return toQuoteResponse(rows[0]);
    },

    async getQuotes(symbols) {
      const list = uniqueSymbols(symbols);
      if (!list.length) return new Map();
      const { rows } = await dbPool.query(`
        WITH week52 AS (
          SELECT
            symbol,
            max(high) AS "week52High",
            min(low) AS "week52Low"
          FROM dhan_daily_candles
          WHERE symbol = ANY($1)
            AND trade_date >= CURRENT_DATE - interval '365 days'
          GROUP BY symbol
        )
        SELECT
          u.symbol,
          u.company_name,
          u.market_cap,
          l.ltp,
          l.prev_close,
          week52."week52High",
          week52."week52Low"
        FROM market_universe u
        LEFT JOIN dhan_live_today l ON l.symbol = u.symbol
        LEFT JOIN week52 ON week52.symbol = u.symbol
        WHERE u.symbol = ANY($1)
      `, [list]);
      return new Map(rows.map(row => [row.symbol, toQuoteResponse(row)]));
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
