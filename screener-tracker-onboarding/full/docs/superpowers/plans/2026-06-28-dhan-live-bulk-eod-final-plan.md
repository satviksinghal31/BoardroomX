# Dhan Live Feed And Bulk EOD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BoardroomX charts reliable by using Dhan historical data for since-inception backfill, Dhan websocket only for intraday live overlay, and Dhan bulk OHLC after market close to update the final daily candle for all active stocks.

**Architecture:** Keep one authoritative compressed table, `dhan_daily_candle_series`, keyed by `instrument_id`. The live websocket writes temporary current-day ticks to `dhan_live_today`; it is useful but not required for final candles. The EOD cron uses Dhan `/marketfeed/ohlc` bulk snapshots in batches of up to 1000 instruments, rate-limited to 1 request/second, and merges the returned current daily OHLC into each instrument's compressed historical series.

**Tech Stack:** Node.js ESM scripts, Supabase Postgres, DhanHQ v2 REST/WebSocket APIs, Railway cron/services, Node test runner.

---

## Current Verified State

- Active mapped Dhan instruments: `2406`
- Stored candle series: `2415`
- Stored candles: `6,392,605`
- DB size: `194 MB`
- Candle series table size: `151 MB`
- Missing active historical series: `TURTLEMINT` only; Dhan historical API returns `DH-905 no data present`.
- Dhan live-feed service is online, but recent logs show repeated `ETIMEDOUT` before a later `subscribed 2406 instruments` line.
- `dhan_live_today` currently has `0` rows, so live overlay has not produced usable ticks yet.

## Count Mismatch Explanation

`active_mapped = 2406` means current active Dhan instruments with a security ID.

`series_symbols = 2415` means instruments for which we have stored historical candle series, including inactive instruments. We verified `10` inactive instruments still have series:

- `DAICHI`
- `HALDYNGL`
- `INDOAMIN`
- `MENONBE`
- `MUKTAARTS`
- `RAMASTEEL`
- `SHEMAROO`
- `STERTOOLS`
- `SUNDRMBRAK`
- `VIKRAMSOLR`

There is also `1` active mapped symbol without series: `TURTLEMINT`.

So the math is: `2406 active - 1 missing active + 10 inactive with stored history = 2415 series`.

## Dhan API Facts Used

Official Dhan docs:

- Historical daily candles: `POST /charts/historical`
  - Requires one `securityId`.
  - Provides daily OHLC back to inception.
  - No bulk historical endpoint is documented.

- Bulk OHLC snapshot: `POST /marketfeed/ohlc`
  - Supports up to `1000` instruments per request.
  - Rate limit: `1 request per second`.
  - Returns current daily OHLC plus LTP snapshot for requested instruments.

- Live websocket:
  - Endpoint: `wss://api-feed.dhan.co?version=2&token=...&clientId=...&authType=2`
  - Up to `5000` instruments per websocket connection.
  - Only `100` instruments per subscription JSON message.
  - Server sends ping every 10 seconds; if the client fails pong for more than 40 seconds, connection closes.

## Design Decision

Use three separate paths:

1. **Historical backfill**
   - Purpose: since-inception data.
   - API: `/charts/historical`.
   - Pattern: one instrument at a time, slow and resumable.
   - Runs manually or as a repair utility, not every day.

2. **Live overlay**
   - Purpose: intraday price movement and current visible price.
   - API: Dhan websocket.
   - Writes: `dhan_live_today`.
   - If down, charts still show historical candles; current live overlay may be missing.

3. **EOD final daily candle**
   - Purpose: update today's finalized daily OHLC for all active instruments after market close.
   - API: `/marketfeed/ohlc`.
   - Pattern: active instruments batched by exchange segment, up to 1000 per request, 1 request/second.
   - Writes: merge today's candle into `dhan_daily_candle_series`.

This is simpler than calling `/charts/historical` for every symbol daily and more aligned with Dhan's bulk API design.

## Important Edge Cases

- **Market holiday/weekend:** Bulk OHLC may return unchanged or no meaningful current-day data. The EOD cron should only merge rows whose date is the current IST trading date and whose OHLC values are valid.
- **Newly listed symbols:** If no historical series exists, EOD bulk OHLC can create a one-candle series after listing.
- **Inactive symbols:** Do not update inactive instruments in EOD. Keep existing historical series unless we explicitly decide to purge inactive history.
- **No-data symbols:** If Dhan gives no historical data for a symbol like `TURTLEMINT`, keep it active but mark EOD/historical missing in logs.
- **Websocket timeout:** The live feed must reconnect with backoff and should not block EOD final candles.
- **Dhan rate limit:** Bulk OHLC must never exceed 1 request/second.
- **Bad OHLC row:** Skip one bad instrument row; do not fail the whole batch.

---

### Task 1: Add Bulk OHLC Normalization

**Files:**
- Modify: `scripts/lib/dhan-normalize.mjs`
- Test: `tests/dhan-normalize.test.mjs`

- [ ] **Step 1: Write failing tests for bulk OHLC response normalization**

Add tests that convert a Dhan `/marketfeed/ohlc` response into daily candle rows:

```js
test('normalizeBulkOhlcResponse maps Dhan OHLC snapshots to daily candles', () => {
  const rows = normalizeBulkOhlcResponse({
    NSE_EQ: {
      1333: {
        last_price: 2500,
        ohlc: { open: 2400, high: 2550, low: 2390, close: 2480 },
        volume: 12345,
      },
    },
  }, new Map([['1333', { symbol: 'HDFCBANK', instrument_id: 42 }]]), '2026-06-29');

  assert.deepEqual(rows, [{
    instrument_id: 42,
    symbol: 'HDFCBANK',
    trade_date: '2026-06-29',
    open: 2400,
    high: 2550,
    low: 2390,
    close: 2500,
    volume: 12345,
  }]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/dhan-normalize.test.mjs
```

Expected: fails because `normalizeBulkOhlcResponse` is not exported.

- [ ] **Step 3: Implement `normalizeBulkOhlcResponse`**

Add a small parser that:

- iterates exchange segment keys
- maps security IDs to instrument IDs
- requires finite open/high/low/close or LTP
- uses `last_price` as final `close`
- returns sorted rows

- [ ] **Step 4: Run focused test and verify pass**

Run:

```bash
node --test tests/dhan-normalize.test.mjs
```

Expected: all normalize tests pass.

---

### Task 2: Add Bulk EOD Updater

**Files:**
- Modify: `scripts/dhan-eod-update.mjs`
- Test: `tests/dhan-jobs.test.mjs`

- [ ] **Step 1: Write failing test for bulk EOD flow**

Add a test that:

- loads two active instruments
- calls `fetchOhlcBySegment` once with `NSE_EQ: ['100', '101']`
- merges returned candles into `dhan_daily_candle_series`
- clears `dhan_live_today`

Expected output:

```js
assert.equal(result.attempted_count, 2);
assert.equal(result.updated_count, 2);
assert.equal(result.failed_count, 0);
assert.equal(result.source, 'dhan_marketfeed_ohlc');
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test tests/dhan-jobs.test.mjs
```

Expected: fails because EOD still uses `/charts/historical`.

- [ ] **Step 3: Implement bulk EOD path**

Implementation rules:

- Fetch active universe using `fetchDhanBackfillUniverse`.
- Group instruments by `dhan_exchange_segment`.
- Use `chunkSecurityIds(ids, 1000)`.
- Call `dhanClient.fetchOhlcBySegment({ [segment]: securityIds })`.
- Wait at least `1000ms` between requests.
- Convert bulk response to normalized candles.
- For each row:
  - read existing `candles_gzip_base64`
  - decode
  - merge today's candle
  - upsert compressed series
- Clear `dhan_live_today` after completion.

- [ ] **Step 4: Keep historical repair as a separate function**

Do not delete historical repair. Rename current historical EOD function to a repair utility such as:

```js
runDhanHistoricalRepair({ symbols, fromDate, toDate })
```

The daily cron should call bulk OHLC, not historical repair.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test tests/dhan-jobs.test.mjs tests/dhan-normalize.test.mjs
```

Expected: pass.

---

### Task 3: Live Feed RCA Instrumentation

**Files:**
- Modify: `dhan_live_feed.mjs`
- Test: `tests/dhan-worker.test.mjs`

- [ ] **Step 1: Add explicit connection lifecycle logging**

Log these events:

- `connect_start` with instrument count and batch count
- `open`
- `subscribed` with instrument count and message count
- `first_tick` with symbol and timestamp
- `flush` with row count
- `close` with code/reason
- `error` with error code/message

- [ ] **Step 2: Add websocket open timeout**

If socket does not open within `30s`, terminate it and reconnect with backoff.

- [ ] **Step 3: Add reconnect backoff**

Use capped backoff:

```js
5s, 10s, 20s, 30s, 30s...
```

Do not reconnect every 5 seconds forever during network timeout storms.

- [ ] **Step 4: Add tests**

Test cases:

- disabled live feed idles without falling through
- open timeout closes and reconnects
- subscription batches remain 100 instruments per message
- flush writes rows after ticker packets

- [ ] **Step 5: Verify in Railway logs**

After deploy, expected live-feed logs:

```text
[dhan-worker] connect_start instruments=2406 batches=25
[dhan-worker] open
[dhan-worker] subscribed instruments=2406 batches=25
[dhan-worker] first_tick symbol=...
[dhan-worker] flush rows=...
```

If logs show repeated `ETIMEDOUT` before `open`, RCA is network path from Railway to `api-feed.dhan.co`, not subscription payload shape.

---

### Task 4: QA Checklist

**Files:**
- Modify or create: `docs/qa/dhan-market-data-qa.md`

- [ ] Verify `/api/chart/RELIANCE` returns candles.
- [ ] Verify `/api/chart/TCS` returns candles.
- [ ] Verify `/api/chart/HDFCBANK` returns candles.
- [ ] Verify chart UI renders candle canvas after selecting a watchlist stock.
- [ ] Verify search symbol selection updates chart.
- [ ] Verify no `1H` chart control is shown.
- [ ] Verify `TURTLEMINT` fails gracefully with empty chart or clear fallback state.
- [ ] Verify EOD bulk update dry-run count equals active mapped instrument count.
- [ ] Verify Dhan live feed logs `first_tick` and `flush rows > 0` during market hours.

---

## Rollout Sequence

1. Implement tests first.
2. Implement bulk OHLC parser.
3. Implement bulk EOD updater.
4. Add live-feed instrumentation/backoff.
5. Run:

```bash
npm test
```

6. Push to GitHub.
7. Let Railway deploy.
8. Run a manual EOD dry run for 5 symbols.
9. Run manual EOD bulk for all active instruments after market close.
10. Check:

```sql
select count(*) from dhan_daily_candle_series;
select max(to_date) from dhan_daily_candle_series;
select count(*) from dhan_live_today;
```

## Open Decisions

- Whether to purge inactive historical series or keep them for old watchlists. Recommendation: keep them for now.
- Whether to set static IP for Railway if Dhan websocket timeout persists. Recommendation: first add instrumentation; if timeout is still pre-open network failure, use Railway outbound networking/static IP if available or move websocket worker to an environment with stable India-region connectivity.
- Whether live-feed is mandatory for app launch. Recommendation: charts should not depend on live-feed; bulk EOD and historical series must be enough for chart rendering.
