import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildHistoricalSeriesRow, dateYearsAgo, fetchDhanBackfillUniverse } from '../scripts/dhan-historical-backfill.mjs';
import { decodeCandleSeries } from '../scripts/lib/dhan-normalize.mjs';
import { eodRepairWindow, runDhanEodUpdate } from '../scripts/dhan-eod-update.mjs';
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

test('buildHistoricalSeriesRow maps normalized candles to one compressed DB row', () => {
  const row = buildHistoricalSeriesRow({ symbol: 'ABC', instrument_id: 42 }, [
    { trade_date: '2026-01-01', open: 1, high: 2, low: 1, close: 2, volume: 100 },
  ]);

  assert.equal(row.instrument_id, 42);
  assert.equal(row.from_date, '2026-01-01');
  assert.equal(row.to_date, '2026-01-01');
  assert.equal(row.candle_count, 1);
  assert.deepEqual(decodeCandleSeries(row.candles_gzip_base64), [{
    trade_date: '2026-01-01',
    open: 1,
    high: 2,
    low: 1,
    close: 2,
    volume: 100,
  }]);
});

test('buildHistoricalSeriesRow dedupes repeated trade dates before upsert', () => {
  const row = buildHistoricalSeriesRow({ symbol: 'ABC', instrument_id: 42 }, [
    { trade_date: '2026-01-01', open: 1, high: 2, low: 1, close: 2, volume: 100 },
    { trade_date: '2026-01-01', open: 3, high: 4, low: 2, close: 3, volume: 200 },
  ]);

  assert.deepEqual(decodeCandleSeries(row.candles_gzip_base64), [{
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
    instrument_id: i + 1,
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

test('dateYearsAgo supports optional bounded historical runs', () => {
  assert.equal(dateYearsAgo(new Date('2026-06-21T00:00:00.000Z'), 5), '2021-06-21');
});

test('eodRepairWindow is exactly three calendar days inclusive', () => {
  assert.deepEqual(eodRepairWindow(new Date('2026-06-22T10:00:30.000Z')), {
    fromDate: '2026-06-20',
    toDate: '2026-06-22',
  });
});

test('eodRepairWindow uses the IST calendar date', () => {
  assert.deepEqual(eodRepairWindow(new Date('2026-06-21T20:00:00.000Z')), {
    fromDate: '2026-06-20',
    toDate: '2026-06-22',
  });
});

test('runDhanEodUpdate repairs daily candles from historical API and clears live overlay', async () => {
  const upserts = [];
  const deletes = [];
  const supabase = {
    from(table) {
      if (table === 'dhan_instruments') {
        const query = {
          select() { return this; },
          neq() { return this; },
          not() { return this; },
          order() { return this; },
          async range() {
            return { data: [{ symbol: 'ABC', instrument_id: 42, dhan_security_id: '100', dhan_exchange_segment: 'NSE_EQ' }], error: null };
          },
        };
        return query;
      }
      if (table === 'dhan_daily_candle_series') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: null, error: null };
          },
          async upsert(rows, options) {
            upserts.push({ rows, options });
            return { error: null };
          },
        };
      }
      if (table === 'dhan_live_today') {
        return {
          delete() {
            return {
              async neq() {
                deletes.push(table);
                return { error: null };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  const dhanClient = {
    async fetchHistoricalDaily(request) {
      assert.deepEqual(request, {
        securityId: '100',
        exchangeSegment: 'NSE_EQ',
        fromDate: '2026-06-20',
        toDate: '2026-06-22',
      });
      return {
        timestamp: [1781913600],
        open: [1],
        high: [2],
        low: [1],
        close: [2],
        volume: [100],
      };
    },
  };

  const result = await runDhanEodUpdate({
    supabase,
    dhanClient,
    now: new Date('2026-06-22T10:00:30.000Z'),
  });

  assert.equal(result.repaired, 1);
  assert.equal(result.failed_count, 0);
  assert.equal(deletes.length, 1);
  assert.deepEqual(upserts[0], {
    rows: [{
      instrument_id: 42,
      from_date: '2026-06-20',
      to_date: '2026-06-20',
      candle_count: 1,
      candles_gzip_base64: upserts[0].rows[0].candles_gzip_base64,
    }],
    options: { onConflict: 'instrument_id' },
  });
  assert.deepEqual(decodeCandleSeries(upserts[0].rows[0].candles_gzip_base64), [{
    trade_date: '2026-06-20',
    open: 1,
    high: 2,
    low: 1,
    close: 2,
    volume: 100,
  }]);
});

test('runDhanEodUpdate waits between historical repair symbols', async () => {
  const delayCalls = [];
  const fetched = [];
  const supabase = {
    from(table) {
      if (table === 'dhan_instruments') {
        const query = {
          select() { return this; },
          neq() { return this; },
          not() { return this; },
          order() { return this; },
          async range() {
            return {
              data: [
                { symbol: 'ABC', instrument_id: 42, dhan_security_id: '100', dhan_exchange_segment: 'NSE_EQ' },
                { symbol: 'XYZ', instrument_id: 43, dhan_security_id: '101', dhan_exchange_segment: 'NSE_EQ' },
              ],
              error: null,
            };
          },
        };
        return query;
      }
      if (table === 'dhan_daily_candle_series') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: null, error: null };
          },
          async upsert() {
            return { error: null };
          },
        };
      }
      if (table === 'dhan_live_today') {
        return {
          delete() {
            return {
              async neq() {
                return { error: null };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  const dhanClient = {
    async fetchHistoricalDaily(request) {
      fetched.push(request.securityId);
      return {
        timestamp: [1781913600],
        open: [1],
        high: [2],
        low: [1],
        close: [2],
        volume: [100],
      };
    },
  };

  await runDhanEodUpdate({
    supabase,
    dhanClient,
    now: new Date('2026-06-22T10:00:30.000Z'),
    delayMs: 2500,
    sleepFn: async ms => delayCalls.push(ms),
  });

  assert.deepEqual(fetched, ['100', '101']);
  assert.deepEqual(delayCalls, [2500]);
});

test('getCronJobs exposes Dhan market-data jobs', () => {
  const jobs = getCronJobs(new Date('2026-06-22T01:00:00.000Z'));
  assert.equal(jobs.some(job => job.job === 'dhan-instrument-sync' && job.schedule_ist === '07:30 IST'), true);
  assert.equal(jobs.some(job => job.job === 'dhan-eod-update' && job.schedule_ist === '16:00 IST'), true);
});
