import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildHistoricalRows, dateYearsAgo, fetchDhanBackfillUniverse } from '../scripts/dhan-historical-backfill.mjs';
import { buildEodRows } from '../scripts/dhan-eod-update.mjs';
import { buildInactiveSymbols, filterDhanEquityRows } from '../scripts/dhan-instrument-sync.mjs';
import { createDhanClient } from '../scripts/lib/dhan-client.mjs';
import { getCronJobs } from '../scripts/run-cron.mjs';

test('filterDhanEquityRows keeps only NSE equity EQ instruments', () => {
  const rows = filterDhanEquityRows([
    { EXCH_ID: 'NSE', SEGMENT: 'E', SERIES: 'EQ', UNDERLYING_SYMBOL: 'ABC', SECURITY_ID: '1', ISIN: 'INE1' },
    { EXCH_ID: 'NSE', SEGMENT: 'D', SERIES: 'EQ', UNDERLYING_SYMBOL: 'FNO', SECURITY_ID: '2' },
    { EXCH_ID: 'BSE', SEGMENT: 'E', SERIES: 'EQ', UNDERLYING_SYMBOL: 'BSE', SECURITY_ID: '3' },
    { EXCH_ID: 'NSE', SEGMENT: 'E', SERIES: 'BE', UNDERLYING_SYMBOL: 'BEONLY', SECURITY_ID: '4' },
  ]);

  assert.deepEqual(rows, [{
    symbol: 'ABC',
    isin: 'INE1',
    company_name: '',
    display_name: '',
    instrument: 'EQUITY',
    series: 'EQ',
    dhan_security_id: '1',
    dhan_exchange_segment: 'NSE_EQ',
    lot_size: null,
    tick_size: null,
    upper_limit: null,
    lower_limit: null,
    freeze_qty: null,
    is_active: true,
  }]);
});

test('buildInactiveSymbols returns active symbols missing from latest sync', () => {
  assert.deepEqual(
    buildInactiveSymbols(['ABC', 'XYZ', 'OLD'], new Set(['ABC', 'XYZ'])),
    ['OLD'],
  );
});

test('fetchScripMasterCsv reads CSV even when Dhan sends a non-text content type', async () => {
  const csv = 'EXCH_ID,SEGMENT,SERIES,UNDERLYING_SYMBOL,SECURITY_ID\nNSE,E,EQ,ABC,1\n';
  const client = createDhanClient({
    clientId: '1001',
    getAccessToken: async () => 'unused',
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'application/octet-stream' },
      text: async () => csv,
      json: async () => {
        throw new Error('CSV response should not be parsed as JSON');
      },
    }),
  });

  assert.equal(await client.fetchScripMasterCsv(), csv);
});

test('buildHistoricalRows maps normalized candles to DB rows', () => {
  assert.deepEqual(buildHistoricalRows('ABC', [
    { trade_date: '2026-01-01', open: 1, high: 2, low: 1, close: 2, volume: 100 },
  ]), [{
    symbol: 'ABC',
    trade_date: '2026-01-01',
    open: 1,
    high: 2,
    low: 1,
    close: 2,
    volume: 100,
  }]);
});

test('buildHistoricalRows dedupes repeated trade dates before upsert', () => {
  assert.deepEqual(buildHistoricalRows('ABC', [
    { trade_date: '2026-01-01', open: 1, high: 2, low: 1, close: 2, volume: 100 },
    { trade_date: '2026-01-01', open: 3, high: 4, low: 2, close: 3, volume: 200 },
  ]), [{
    symbol: 'ABC',
    trade_date: '2026-01-01',
    open: 3,
    high: 4,
    low: 2,
    close: 3,
    volume: 200,
  }]);
});

test('fetchDhanBackfillUniverse paginates beyond Supabase default page size', async () => {
  const ranges = [];
  const rows = Array.from({ length: 1001 }, (_, i) => ({
    symbol: `SYM${i}`,
    dhan_security_id: String(i),
    dhan_exchange_segment: 'NSE_EQ',
  }));
  const supabase = {
    from() {
      const query = {
        select() { return this; },
        neq() { return this; },
        not() { return this; },
        order() { return this; },
        in() { return this; },
        async range(from, to) {
          ranges.push([from, to]);
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
      return query;
    },
  };

  const universe = await fetchDhanBackfillUniverse({ supabase, pageSize: 1000 });

  assert.equal(universe.length, 1001);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
});

test('dateYearsAgo defaults historical backfills to bounded daily history', () => {
  assert.equal(dateYearsAgo(new Date('2026-06-21T00:00:00.000Z'), 5), '2021-06-21');
});

test('buildEodRows prefers fresh live rows and falls back to quote rows', () => {
  const rows = buildEodRows({
    liveRows: [
      { symbol: 'ABC', trade_date: '2026-06-22', open: 10, high: 12, low: 9, ltp: 11, volume: 100, last_tick_at: '2026-06-22T10:00:00.000Z' },
      { symbol: 'XYZ', trade_date: '2026-06-22', open: null, high: null, low: null, ltp: null, volume: null, last_tick_at: null },
    ],
    fallbackQuotes: new Map([
      ['XYZ', { open: 20, high: 22, low: 19, close: 21, volume: 200 }],
    ]),
    now: new Date('2026-06-22T10:00:30.000Z'),
  });

  assert.deepEqual(rows, [
    { symbol: 'ABC', trade_date: '2026-06-22', open: 10, high: 12, low: 9, close: 11, volume: 100 },
    { symbol: 'XYZ', trade_date: '2026-06-22', open: 20, high: 22, low: 19, close: 21, volume: 200 },
  ]);
});

test('getCronJobs exposes Dhan market-data jobs', () => {
  const jobs = getCronJobs(new Date('2026-06-22T01:00:00.000Z'));
  assert.equal(jobs.some(job => job.job === 'dhan-instrument-sync' && job.schedule_ist === '07:30 IST'), true);
  assert.equal(jobs.some(job => job.job === 'dhan-eod-update' && job.schedule_ist === '16:00 IST'), true);
});
