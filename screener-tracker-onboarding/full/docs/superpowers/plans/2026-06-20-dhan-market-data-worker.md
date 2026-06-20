# Dhan Market Data Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace production Yahoo chart/price/quote data with Dhan-backed Postgres reads and a dedicated Dhan market-data worker service.

**Architecture:** Postgres is the boundary. The Express web service reads normalized market data from `dhan_daily_candles` and `dhan_live_today`; the persistent worker owns Dhan auth, WebSocket feed decoding, reconnect recovery, and live writes; cron jobs own instrument sync and EOD finalization.

**Tech Stack:** Node.js ESM, Express 5, Node test runner, Supabase/Postgres, Railway services/cron, DhanHQ REST and WebSocket APIs, `otpauth`, `ws`.

---

## File Structure

- Create `migrations/016_dhan_market_data.sql`: Dhan schema, indexes, grants, RLS policies.
- Create `scripts/lib/dhan-time.mjs`: IST market-session and freshness helpers.
- Create `scripts/lib/dhan-normalize.mjs`: candle normalization, quote/live-row mapping, route response shaping.
- Create `scripts/lib/dhan-client.mjs`: Dhan REST wrapper and request chunking.
- Create `scripts/lib/dhan-feed-decoder.mjs`: binary packet decoder for ticker, previous close, and quote packets used by the worker.
- Create `dhan_auth.mjs`: token lifecycle with persisted `dhan_auth_state`.
- Create `dhan_market_data.js`: database readers for chart, prices, quote, universe active filtering, and health.
- Create `dhan_routes.js`: Express route registration for chart/price/quote/health.
- Create `dhan_live_feed.mjs`: persistent worker entrypoint and live candle aggregation.
- Create `scripts/dhan-instrument-sync.mjs`: Dhan scrip master sync.
- Create `scripts/dhan-historical-backfill.mjs`: resumable daily candle backfill.
- Create `scripts/dhan-eod-update.mjs`: EOD finalizer.
- Modify `server.js`: mount Dhan routes, remove Yahoo production imports/cache warmers/routes, keep unrelated routes untouched.
- Modify `scripts/run-cron.mjs`: add Dhan cron job definitions and dispatch.
- Modify `package.json`: add Dhan scripts/dependencies and remove production `yahoo-finance2` only after route cutover.
- Modify `.env.example`: add Dhan env vars.
- Modify `public/app.js` and `public/index.html`: PE cleanup, `MAX` range, stale live-candle protection, searched-symbol price refresh.
- Add tests under `tests/dhan-*.test.mjs`.
- Add verification scripts under `scripts/verify-dhan-*.mjs`.

## Task 1: Schema And Time Helpers

**Files:**
- Create: `migrations/016_dhan_market_data.sql`
- Create: `scripts/lib/dhan-time.mjs`
- Test: `tests/dhan-time.test.mjs`

- [ ] **Step 1: Write the failing time-helper tests**

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNseMarketOpenIst, isFreshLiveTick, todayIstDate } from '../scripts/lib/dhan-time.mjs';

test('isNseMarketOpenIst is true only during regular NSE session', () => {
  assert.equal(isNseMarketOpenIst(new Date('2026-06-22T03:44:00.000Z')), false); // 09:14 IST
  assert.equal(isNseMarketOpenIst(new Date('2026-06-22T03:45:00.000Z')), true);  // 09:15 IST
  assert.equal(isNseMarketOpenIst(new Date('2026-06-22T10:00:00.000Z')), true);  // 15:30 IST
  assert.equal(isNseMarketOpenIst(new Date('2026-06-22T10:01:00.000Z')), false); // 15:31 IST
});

test('isFreshLiveTick uses a 90 second freshness window by default', () => {
  const now = new Date('2026-06-22T05:00:00.000Z');
  assert.equal(isFreshLiveTick('2026-06-22T04:58:31.000Z', now), true);
  assert.equal(isFreshLiveTick('2026-06-22T04:58:29.000Z', now), false);
  assert.equal(isFreshLiveTick(null, now), false);
});

test('todayIstDate returns YYYY-MM-DD in Asia/Kolkata', () => {
  assert.equal(todayIstDate(new Date('2026-06-21T20:00:00.000Z')), '2026-06-22');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-time.test.mjs`

Expected: FAIL with module not found for `scripts/lib/dhan-time.mjs`.

- [ ] **Step 3: Add the migration**

```sql
ALTER TABLE nse_universe
  ADD COLUMN IF NOT EXISTS dhan_security_id TEXT,
  ADD COLUMN IF NOT EXISTS dhan_exchange_segment TEXT DEFAULT 'NSE_EQ',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS dhan_daily_candles (
  symbol TEXT NOT NULL REFERENCES nse_universe(symbol),
  trade_date DATE NOT NULL,
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  volume BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_dhan_daily_symbol_date_desc
  ON dhan_daily_candles(symbol, trade_date DESC);

CREATE TABLE IF NOT EXISTS dhan_live_today (
  symbol TEXT PRIMARY KEY REFERENCES nse_universe(symbol),
  trade_date DATE NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  ltp NUMERIC,
  prev_close NUMERIC,
  volume BIGINT,
  last_tick_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dhan_live_today_tick_at
  ON dhan_live_today(last_tick_at DESC);

CREATE TABLE IF NOT EXISTS dhan_auth_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token TEXT,
  issued_at TIMESTAMPTZ,
  expiry_time TIMESTAMPTZ,
  last_refresh_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dhan_daily_candles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dhan_daily_candles_read_all" ON dhan_daily_candles;
CREATE POLICY "dhan_daily_candles_read_all" ON dhan_daily_candles FOR SELECT USING (true);
GRANT ALL ON TABLE dhan_daily_candles TO service_role;

ALTER TABLE dhan_live_today ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dhan_live_today_read_all" ON dhan_live_today;
CREATE POLICY "dhan_live_today_read_all" ON dhan_live_today FOR SELECT USING (true);
GRANT ALL ON TABLE dhan_live_today TO service_role;

ALTER TABLE dhan_auth_state ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE dhan_auth_state TO service_role;
```

- [ ] **Step 4: Implement `dhan-time.mjs`**

```js
function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}

export function todayIstDate(date = new Date()) {
  const p = istParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function isNseMarketOpenIst(date = new Date()) {
  const p = istParts(date);
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

export function isFreshLiveTick(lastTickAt, now = new Date(), maxAgeSeconds = 90) {
  if (!lastTickAt) return false;
  const tickMs = new Date(lastTickAt).getTime();
  if (!Number.isFinite(tickMs)) return false;
  return now.getTime() - tickMs <= maxAgeSeconds * 1000;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-time.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add screener-tracker-onboarding/full/migrations/016_dhan_market_data.sql screener-tracker-onboarding/full/scripts/lib/dhan-time.mjs screener-tracker-onboarding/full/tests/dhan-time.test.mjs
git commit -m "feat: add Dhan market data schema"
```

## Task 2: Normalization And Route Shaping

**Files:**
- Create: `scripts/lib/dhan-normalize.mjs`
- Test: `tests/dhan-normalize.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
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
    timestamp: [1767225600, 1767139200],
    open: [11, 10],
    high: [12, 11],
    low: [9, 8],
    close: [10.5, 10],
    volume: [200, 100],
  });
  assert.deepEqual(rows.map(r => r.trade_date), ['2026-01-01', '2026-01-02']);
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
```

- [ ] **Step 2: Verify red**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-normalize.test.mjs`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement normalization helpers**

Create functions with these exported signatures:

```js
export function normalizeHistoricalResponse(payload) {}
export function toChartCandle(row) {}
export function appendFreshLiveCandle(candles, liveRow, options = {}) {}
export function toPriceResponse(row) {}
export function toQuoteResponse(row) {}
```

Use `Number(value)` only when values are not `null`; round price/change fields to 2 decimals and percent fields to 2 decimals.

- [ ] **Step 4: Verify green**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-normalize.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add screener-tracker-onboarding/full/scripts/lib/dhan-normalize.mjs screener-tracker-onboarding/full/tests/dhan-normalize.test.mjs
git commit -m "feat: add Dhan market data normalization"
```

## Task 3: Dhan Auth And REST Client

**Files:**
- Create: `dhan_auth.mjs`
- Create: `scripts/lib/dhan-client.mjs`
- Test: `tests/dhan-auth.test.mjs`
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Write failing auth tests**

Test token reuse with a fake state store, transient retry count, and terminal failure no-retry. Use dependency injection:

```js
const auth = createDhanAuth({ env, stateStore, generateTotp, fetchImpl, now });
await auth.getAccessToken();
```

Expected exported signature:

```js
export function createDhanAuth({ env, stateStore, generateTotp, fetchImpl, now }) {}
```

- [ ] **Step 2: Verify red**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-auth.test.mjs`

Expected: FAIL with module not found.

- [ ] **Step 3: Add dependencies and env docs**

Add dependencies:

```json
"otpauth": "^9.4.0",
"ws": "^8.18.0"
```

Add env entries:

```env
DHAN_CLIENT_ID=
DHAN_PIN=
DHAN_TOTP_SECRET=
```

- [ ] **Step 4: Implement auth and REST client**

`dhan_auth.mjs` owns `generateAccessToken` calls and persists `access_token`, `issued_at`, `expiry_time`, `last_refresh_error`.

`scripts/lib/dhan-client.mjs` exports:

```js
export function chunkSecurityIds(ids, chunkSize = 1000) {}
export function createDhanClient({ clientId, getAccessToken, fetchImpl = fetch }) {}
```

Client methods:

- `fetchHistoricalDaily({ securityId, exchangeSegment, fromDate, toDate })`
- `fetchOhlcBySegment(segmentMap)`
- `fetchQuoteBySegment(segmentMap)`
- `fetchScripMasterCsv()`

- [ ] **Step 5: Verify green**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-auth.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add screener-tracker-onboarding/full/dhan_auth.mjs screener-tracker-onboarding/full/scripts/lib/dhan-client.mjs screener-tracker-onboarding/full/tests/dhan-auth.test.mjs screener-tracker-onboarding/full/package.json screener-tracker-onboarding/full/package-lock.json screener-tracker-onboarding/full/.env.example
git commit -m "feat: add Dhan auth client"
```

## Task 4: Feed Decoder And Live Aggregator

**Files:**
- Create: `scripts/lib/dhan-feed-decoder.mjs`
- Create: `scripts/lib/dhan-live-aggregate.mjs`
- Test: `tests/dhan-feed.test.mjs`

- [ ] **Step 1: Write failing tests**

Test decoder with handcrafted little-endian buffers for packet code `2` ticker and code `6` previous close. Test aggregation:

```js
state = applyTick(state, { symbol: 'ABC', tradeDate: '2026-06-22', ltp: 100, volume: 10 });
state = applyTick(state, { symbol: 'ABC', tradeDate: '2026-06-22', ltp: 103, volume: 15 });
state = applyTick(state, { symbol: 'ABC', tradeDate: '2026-06-22', ltp: 99, volume: 20 });
assert.deepEqual(state.get('ABC'), { open: 100, high: 103, low: 99, ltp: 99, volume: 20 });
```

- [ ] **Step 2: Verify red**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-feed.test.mjs`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement decoder and aggregator**

Decoder exports:

```js
export function decodeFeedPacket(buffer) {}
```

Aggregator exports:

```js
export function applyTick(state, tick) {}
export function serializeLiveState(state) {}
```

- [ ] **Step 4: Verify green**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-feed.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add screener-tracker-onboarding/full/scripts/lib/dhan-feed-decoder.mjs screener-tracker-onboarding/full/scripts/lib/dhan-live-aggregate.mjs screener-tracker-onboarding/full/tests/dhan-feed.test.mjs
git commit -m "feat: add Dhan feed decoding"
```

## Task 5: Database Readers And Routes

**Files:**
- Create: `dhan_market_data.js`
- Create: `dhan_routes.js`
- Test: `tests/dhan-routes.test.mjs`
- Modify: `server.js`

- [ ] **Step 1: Write failing tests**

Use fake `dbPool.query()` responses to test:

- chart history is sorted and appends fresh live row
- stale live row is ignored
- quote omits PE fields
- active universe filters inactive rows

- [ ] **Step 2: Verify red**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-routes.test.mjs`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement data readers**

Export:

```js
export function createDhanMarketData({ dbPool, now }) {}
```

Methods:

- `getChart(symbol)`
- `getPrices(symbols)`
- `getQuote(symbol)`
- `getActiveUniverse()`
- `getLiveHealth()`

- [ ] **Step 4: Implement route registration**

Export:

```js
export function registerDhanRoutes(app, { auth, marketData }) {}
```

Register existing route paths and `/api/dhan/health`.

- [ ] **Step 5: Modify `server.js`**

Remove Yahoo imports, Yahoo helper functions, Yahoo route handlers, and startup Yahoo warmers. Mount Dhan routes after `auth` exists and after `dbPool` is configured. Keep portfolio, financials, auth, Kite, annuals, and events routes unchanged.

- [ ] **Step 6: Verify green**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-routes.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add screener-tracker-onboarding/full/dhan_market_data.js screener-tracker-onboarding/full/dhan_routes.js screener-tracker-onboarding/full/server.js screener-tracker-onboarding/full/tests/dhan-routes.test.mjs
git commit -m "feat: serve market data from Dhan tables"
```

## Task 6: Sync, Backfill, EOD, And Cron Dispatch

**Files:**
- Create: `scripts/dhan-instrument-sync.mjs`
- Create: `scripts/dhan-historical-backfill.mjs`
- Create: `scripts/dhan-eod-update.mjs`
- Test: `tests/dhan-jobs.test.mjs`
- Modify: `scripts/run-cron.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing job tests**

Test pure functions:

- `filterDhanEquityRows(rows)` keeps only NSE/E/EQ.
- `buildInactiveSymbols(existing, seen)` returns existing symbols missing from current pass.
- `buildEodRows(liveRows, fallbackQuotes)` chooses live row when fresh and fallback quote when stale.
- `getCronJobs()` includes `dhan-instrument-sync` and `dhan-eod-update`.

- [ ] **Step 2: Verify red**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-jobs.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement scripts and cron entries**

Add package scripts:

```json
"cron:dhan-instrument-sync": "node scripts/run-cron.mjs dhan-instrument-sync",
"cron:dhan-eod-update": "node scripts/run-cron.mjs dhan-eod-update",
"dhan:backfill": "node scripts/dhan-historical-backfill.mjs",
"dhan:worker": "node dhan_live_feed.mjs"
```

Add `JOB_DEFS` entries:

- `dhan-instrument-sync`: 07:30 IST
- `dhan-eod-update`: 16:00 IST

- [ ] **Step 4: Verify green**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-jobs.test.mjs tests/run-cron.test.mjs`

Expected: PASS; update existing `run-cron.test.mjs` expected job list.

- [ ] **Step 5: Commit**

```bash
git add screener-tracker-onboarding/full/scripts/dhan-instrument-sync.mjs screener-tracker-onboarding/full/scripts/dhan-historical-backfill.mjs screener-tracker-onboarding/full/scripts/dhan-eod-update.mjs screener-tracker-onboarding/full/scripts/run-cron.mjs screener-tracker-onboarding/full/tests/dhan-jobs.test.mjs screener-tracker-onboarding/full/tests/run-cron.test.mjs screener-tracker-onboarding/full/package.json
git commit -m "feat: add Dhan market data jobs"
```

## Task 7: Dedicated Worker Entrypoint

**Files:**
- Create: `dhan_live_feed.mjs`
- Test: `tests/dhan-worker.test.mjs`

- [ ] **Step 1: Write failing worker tests**

Test subscription batching:

```js
const batches = buildSubscriptionMessages(instruments, 100);
assert.equal(batches[0].InstrumentCount, 100);
assert.equal(batches[0].RequestCode, 15);
```

Test worker refuses to start with missing env vars through a pure `validateWorkerEnv(env)` function.

- [ ] **Step 2: Verify red**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-worker.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement worker**

Worker responsibilities:

- validate env
- load active mapped instruments from Postgres
- open `wss://api-feed.dhan.co?version=2&token=...&clientId=...&authType=2`
- send subscription messages in batches of 100
- decode binary messages
- aggregate live state
- bulk upsert every 10 seconds
- reconnect with backoff
- recover current OHLC snapshot using Dhan quote API after reconnect

- [ ] **Step 4: Verify green**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-worker.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add screener-tracker-onboarding/full/dhan_live_feed.mjs screener-tracker-onboarding/full/tests/dhan-worker.test.mjs
git commit -m "feat: add Dhan live feed worker"
```

## Task 8: Frontend Compatibility And Cleanup

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Test: `tests/dhan-frontend-contract.test.mjs`

- [ ] **Step 1: Write failing static contract tests**

Read `public/app.js` and `public/index.html` as text and assert:

- no active user-facing `yahoo-finance2` text remains
- `MAX` range button exists
- PE labels are not rendered when values are absent
- `refreshPrices` includes selected/search symbol handling

- [ ] **Step 2: Verify red**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-frontend-contract.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement frontend changes**

Add `MAX` button to desktop and mobile range controls. Treat `MAX` as full candle range with `fitContent()` or first candle date. Hide PE/forward-PE UI if values are absent. Prevent cached live candles from surviving closed-market responses. Include the open chart symbol in live refresh behavior.

- [ ] **Step 4: Verify green**

Run: `cd screener-tracker-onboarding/full && node --test tests/dhan-frontend-contract.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add screener-tracker-onboarding/full/public/app.js screener-tracker-onboarding/full/public/index.html screener-tracker-onboarding/full/tests/dhan-frontend-contract.test.mjs
git commit -m "fix: align chart UI with Dhan market data"
```

## Task 9: Verification Scripts, Graphify, Deployment Prep

**Files:**
- Create: `scripts/verify-dhan-market-data.mjs`
- Modify: `graphify-out/*` through Graphify update
- Modify: Railway config through CLI only after tests pass

- [ ] **Step 1: Add verification script**

Script checks:

- active mapped instrument count
- sample candles for RELIANCE/TCS/HDFCBANK
- `/api/chart/:symbol` shape
- `/api/quote/:symbol` shape
- `/api/dhan/health` shape

- [ ] **Step 2: Run full automated verification**

Run:

```bash
cd screener-tracker-onboarding/full
npm test
node scripts/qa-full.mjs
```

Expected: all tests pass; if `qa-full.mjs` requires live env and fails for missing credentials, record exact missing env and do not claim it passed.

- [ ] **Step 3: Update Graphify**

Run:

```bash
cd screener-tracker-onboarding/full
graphify . --update
```

Expected: `graphify-out/GRAPH_REPORT.md` and graph artifacts reflect Dhan modules.

- [ ] **Step 4: Commit verification and graph updates**

```bash
git add screener-tracker-onboarding/full/scripts/verify-dhan-market-data.mjs screener-tracker-onboarding/full/graphify-out
git commit -m "test: add Dhan market data verification"
```

- [ ] **Step 5: Push and deploy**

Run:

```bash
git push
railway status
railway config apply
```

Expected: GitHub push succeeds and Railway services/env/cron are configured for web service, `dhan:worker`, `cron:dhan-instrument-sync`, and `cron:dhan-eod-update`.
