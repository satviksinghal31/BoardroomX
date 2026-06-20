import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendFreshLiveCandle,
  normalizeHistoricalResponse,
  toPriceResponse,
  toQuoteResponse,
} from '../scripts/lib/dhan-normalize.mjs';

test('normalizeHistoricalResponse converts parallel Dhan arrays to sorted candles', () => {
  const rows = normalizeHistoricalResponse({
    timestamp: [1767312000, 1767225600],
    open: [11, 10],
    high: [12, 11],
    low: [9, 8],
    close: [10.5, 10],
    volume: [200, 100],
  });

  assert.deepEqual(rows.map(row => row.trade_date), ['2026-01-01', '2026-01-02']);
  assert.equal(rows[1].close, 10.5);
});

test('appendFreshLiveCandle appends fresh live row without duplicating same date', () => {
  const history = [{ time: '2026-06-19', open: 1, high: 2, low: 1, close: 2, volume: 10 }];
  const appended = appendFreshLiveCandle(history, {
    trade_date: '2026-06-22',
    open: 3,
    high: 4,
    low: 2,
    ltp: 3.5,
    volume: 50,
    last_tick_at: '2026-06-22T05:00:00.000Z',
  }, { now: new Date('2026-06-22T05:00:20.000Z'), marketOpen: true });

  assert.equal(appended.length, 2);
  assert.equal(appended.at(-1).close, 3.5);

  const replaced = appendFreshLiveCandle(appended, {
    trade_date: '2026-06-22',
    open: 3,
    high: 5,
    low: 2,
    ltp: 4,
    volume: 60,
    last_tick_at: '2026-06-22T05:00:30.000Z',
  }, { now: new Date('2026-06-22T05:00:40.000Z'), marketOpen: true });

  assert.equal(replaced.length, 2);
  assert.equal(replaced.at(-1).high, 5);
});

test('appendFreshLiveCandle ignores stale or closed-market live rows', () => {
  const history = [{ time: '2026-06-19', open: 1, high: 2, low: 1, close: 2, volume: 10 }];
  const live = {
    trade_date: '2026-06-22',
    open: 3,
    high: 4,
    low: 2,
    ltp: 3.5,
    volume: 50,
    last_tick_at: '2026-06-22T04:00:00.000Z',
  };

  assert.deepEqual(
    appendFreshLiveCandle(history, live, { now: new Date('2026-06-22T05:00:20.000Z'), marketOpen: true }),
    history,
  );
  assert.deepEqual(
    appendFreshLiveCandle(history, { ...live, last_tick_at: '2026-06-22T05:00:00.000Z' }, { now: new Date('2026-06-22T05:00:20.000Z'), marketOpen: false }),
    history,
  );
});

test('toPriceResponse keeps frontend candle patch shape', () => {
  assert.deepEqual(toPriceResponse({
    symbol: 'RELIANCE',
    ltp: 100,
    prev_close: 95,
    trade_date: '2026-06-22',
    open: 96,
    high: 101,
    low: 94,
  }), {
    symbol: 'RELIANCE',
    price: 100,
    change: 5,
    changePercent: 5.26,
    candle: { time: '2026-06-22', open: 96, high: 101, low: 94, close: 100 },
  });
});

test('toQuoteResponse removes PE fields and preserves market stats', () => {
  const quote = toQuoteResponse({
    symbol: 'ABC',
    company_name: 'ABC Ltd',
    market_cap: 123,
    ltp: 10,
    prev_close: 8,
    week52High: 20,
    week52Low: 5,
  });

  assert.equal('pe' in quote, false);
  assert.equal('forwardPE' in quote, false);
  assert.equal(quote.changePercent, 25);
});
