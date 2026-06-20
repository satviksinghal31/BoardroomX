# Dhan Universe And EOD Market Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `nse_universe` runtime ownership with Dhan instruments plus a dated NSE EOD market-cap enrichment table.

**Architecture:** Dhan scrip master owns the instrument universe. NSE bhavcopy is parsed into `nse_eod_market_caps` only. App reads use a `market_universe` view that joins active Dhan instruments with the latest EOD market cap.

**Tech Stack:** Node.js ESM, Express, Supabase/Postgres SQL migrations, Railway IaC, Node test runner.

---

### Task 1: Schema Migration

**Files:**
- Create: `migrations/017_dhan_instruments_market_caps.sql`

- [ ] Add `dhan_instruments`, `nse_eod_market_caps`, and `market_universe`.
- [ ] Backfill from existing `nse_universe` when present.
- [ ] Move Dhan candle/live FKs to `dhan_instruments`.
- [ ] Keep the legacy table through the expand-and-switch deploy window, then drop it in the final cleanup migration.

### Task 2: EOD Market Cap Parser And Job

**Files:**
- Create: `scripts/eod-market-cap.mjs`
- Delete: `scripts/refresh-universe.mjs`
- Delete: `scripts/fetch-market-caps.py`
- Modify: `scripts/run-cron.mjs`
- Modify: `package.json`
- Modify: `.railway/railway.ts`
- Test: `tests/eod-market-cap.test.mjs`
- Test: `tests/run-cron.test.mjs`

- [ ] Extract bhavcopy URL/date logic into testable functions.
- [ ] Parse `mcap*.csv` into dated market-cap rows with issue size and close price.
- [ ] Upsert into `nse_eod_market_caps`.
- [ ] Rename cron from `universe-mcap` to `eod-market-cap`.

### Task 3: Dhan Instrument Sync Owns Universe

**Files:**
- Modify: `scripts/dhan-instrument-sync.mjs`
- Modify: `tests/dhan-jobs.test.mjs`

- [ ] Upsert Dhan NSE EQ rows into `dhan_instruments`.
- [ ] Keep inactive marking scoped to `dhan_instruments`.
- [ ] Preserve Dhan display/company fields and trading metadata.

### Task 4: Runtime Reads Use `market_universe`

**Files:**
- Modify: `dhan_market_data.js`
- Modify: `dhan_live_feed.mjs`
- Modify: `scripts/dhan-historical-backfill.mjs`
- Modify: `scripts/screener-worker.mjs`
- Modify: `scripts/verify-dhan-market-data.mjs`
- Modify: `server.js`
- Modify: `public/app.js`
- Test: `tests/dhan-routes.test.mjs`
- Test: `tests/dhan-worker.test.mjs`

- [ ] Replace chart/search/quote/annual universe reads with `market_universe` or `dhan_instruments`.
- [ ] Keep market cap read-only from `market_universe`.
- [ ] Keep stocks table only for app/Screener metadata, not universe truth.

### Task 5: Cleanup And Verification

**Files:**
- Modify current docs where they are operational handoff docs.
- Do not chase stale historical plan/spec docs unless they affect runtime guidance.

- [ ] Remove runtime references to `nse_universe`, `EQUITY_L`, `refresh-universe`, `fetch-market-caps`, and `universe-mcap`.
- [ ] Run `npm test`.
- [ ] Run syntax checks.
- [ ] Run `railway config plan`.
- [ ] Push branch and update PR.
