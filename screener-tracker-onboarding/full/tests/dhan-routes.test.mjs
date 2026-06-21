import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDhanMarketData } from '../dhan_market_data.js';
import { registerDhanRoutes } from '../dhan_routes.js';

function createFakePool(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return handler(sql, params);
    },
  };
}

test('getChart returns history and appends only fresh live candle', async () => {
  const pool = createFakePool(sql => {
    if (sql.includes('FROM dhan_daily_candles')) {
      return { rows: [
        { trade_date: '2026-06-20', open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      ] };
    }
    if (sql.includes('FROM dhan_live_today')) {
      return { rows: [
        { trade_date: '2026-06-22', open: 11, high: 12, low: 10, ltp: 11.5, volume: 200, last_tick_at: '2026-06-22T05:00:00.000Z' },
      ] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const marketData = createDhanMarketData({
    dbPool: pool,
    now: () => new Date('2026-06-22T05:00:20.000Z'),
    isMarketOpen: () => true,
  });

  const result = await marketData.getChart('reliance');

  assert.equal(result.candles.length, 2);
  assert.equal(result.candles.at(-1).time, '2026-06-22');
  assert.equal(result.candles.at(-1).close, 11.5);
  assert.match(result.displayFrom, /^\d{4}-\d{2}-\d{2}$/);
});

test('getChart ignores stale live candle', async () => {
  const pool = createFakePool(sql => {
    if (sql.includes('FROM dhan_daily_candles')) {
      return { rows: [
        { trade_date: '2026-06-20', open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      ] };
    }
    if (sql.includes('FROM dhan_live_today')) {
      return { rows: [
        { trade_date: '2026-06-22', open: 11, high: 12, low: 10, ltp: 11.5, volume: 200, last_tick_at: '2026-06-22T04:00:00.000Z' },
      ] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const marketData = createDhanMarketData({
    dbPool: pool,
    now: () => new Date('2026-06-22T05:00:20.000Z'),
    isMarketOpen: () => true,
  });

  const result = await marketData.getChart('RELIANCE');

  assert.equal(result.candles.length, 1);
  assert.equal(result.candles.at(-1).time, '2026-06-20');
});

test('getPrices and getQuote shape live data for the frontend', async () => {
  const pool = createFakePool((sql, params) => {
    if (sql.includes('WITH week52')) {
      assert.deepEqual(params, ['ABC']);
      assert.match(sql, /FROM market_universe u/);
      return { rows: [{
        symbol: 'ABC',
        company_name: 'ABC Ltd',
        market_cap: 123,
        ltp: 10,
        prev_close: 8,
        week52High: 20,
        week52Low: 5,
      }] };
    }
    if (sql.includes('FROM dhan_live_today')) {
      assert.deepEqual(params, [['ABC', 'XYZ']]);
      return { rows: [
        { symbol: 'ABC', trade_date: '2026-06-22', open: 9, high: 11, low: 8, ltp: 10, prev_close: 8 },
      ] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const marketData = createDhanMarketData({ dbPool: pool });

  assert.deepEqual(await marketData.getPrices(['abc', 'ABC', 'xyz']), [{
    symbol: 'ABC',
    price: 10,
    change: 2,
    changePercent: 25,
    candle: { time: '2026-06-22', open: 9, high: 11, low: 8, close: 10 },
  }]);

  const quote = await marketData.getQuote('abc');
  assert.equal(quote.symbol, 'ABC');
  assert.equal('pe' in quote, false);
  assert.equal(quote.week52High, 20);
});

test('getQuotes fetches portfolio quote data in one SQL round trip', async () => {
  const pool = createFakePool((sql, params) => {
    assert.deepEqual(params, [['ABC', 'XYZ']]);
    assert.match(sql, /FROM market_universe u/);
    assert.match(sql, /symbol = ANY\(\$1\)/);
    return { rows: [
      {
        symbol: 'ABC',
        company_name: 'ABC Ltd',
        market_cap: 123,
        ltp: 10,
        prev_close: 8,
        week52High: 20,
        week52Low: 5,
      },
      {
        symbol: 'XYZ',
        company_name: 'XYZ Ltd',
        market_cap: 456,
        ltp: null,
        prev_close: null,
        week52High: null,
        week52Low: null,
      },
    ] };
  });
  const marketData = createDhanMarketData({ dbPool: pool });

  const quotes = await marketData.getQuotes(['abc', 'ABC', 'xyz']);

  assert.equal(quotes.get('ABC').price, 10);
  assert.equal(quotes.get('ABC').week52High, 20);
  assert.equal(quotes.get('XYZ').name, 'XYZ Ltd');
});

test('getActiveUniverse filters inactive rows in SQL', async () => {
  const pool = createFakePool(sql => {
    assert.match(sql, /FROM market_universe/);
    assert.match(sql, /is_active IS DISTINCT FROM false/);
    return { rows: [{ symbol: 'ABC', company_name: 'ABC Ltd', market_cap: 1 }] };
  });
  const marketData = createDhanMarketData({ dbPool: pool });

  assert.deepEqual(await marketData.getActiveUniverse(), [{ symbol: 'ABC', company_name: 'ABC Ltd', market_cap: 1 }]);
});

test('registerDhanRoutes wires existing API paths', async () => {
  const routes = [];
  const app = {
    get(path, ...handlers) {
      routes.push({ path, handlers });
    },
  };
  const auth = (_req, _res, next) => next();
  const marketData = {
    getChart: async () => ({ candles: [], displayFrom: '2026-01-01' }),
    getPrices: async () => [],
    getQuote: async () => ({ symbol: 'ABC' }),
    getLiveHealth: async () => ({ ok: true }),
  };

  registerDhanRoutes(app, { auth, marketData, getVisiblePriceSymbols: () => ['ABC'] });

  assert.deepEqual(routes.map(route => route.path), [
    '/api/chart/:symbol',
    '/api/prices',
    '/api/quote/:symbol',
    '/api/dhan/health',
  ]);
});
