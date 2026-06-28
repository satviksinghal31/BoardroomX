# Dhan Compact Candles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store since-inception Dhan daily candles compactly and update finalized candles only through the Dhan historical API.

**Architecture:** `dhan_daily_candle_series` becomes an authoritative daily-history table keyed by `instrument_id`, with one gzip/base64 encoded candle series per instrument. `dhan_live_today` remains a temporary intraday overlay for chart display and is never used to finalize daily candles. EOD repair fetches exactly three calendar days from the Dhan historical API and merges those repaired candles into the compressed series.

**Explicit operating rules:**
- Historical backfill defaults to since inception: `fromDate = 1990-01-01`.
- Historical backfill defaults to a 2500ms per-symbol delay.
- EOD repair uses the IST calendar date and fetches exactly three calendar days inclusive: `fromDate = IST today - 2 days`, `toDate = IST today`.
- EOD repair defaults to a 2500ms per-symbol delay.
- `dhan_live_today` is only a live overlay and is never a source for finalized daily candles.
- Row-per-candle storage was rejected after pilot sizing because full since-inception history would put too much pressure on the free Supabase disk.

**Tech Stack:** Node.js ESM scripts, Supabase Postgres, Dhan historical API, Node test runner.

---

### Task 1: Compact Candle Shape

**Files:**
- Modify: `scripts/lib/dhan-normalize.mjs`
- Modify: `scripts/dhan-historical-backfill.mjs`
- Test: `tests/dhan-normalize.test.mjs`
- Test: `tests/dhan-jobs.test.mjs`

- [x] Add paise conversion helpers that round rupee values to integer paise.
- [x] Add gzip/base64 series helpers for compact per-instrument storage.
- [x] Change historical row building to emit one `dhan_daily_candle_series` row per instrument.
- [x] Keep chart responses in rupees after decompression.
- [x] Verify duplicate date dedupe still keeps only one candle per instrument/date.

### Task 2: Compact Schema Migration

**Files:**
- Create: `migrations/019_compact_dhan_daily_candles.sql`
- Create: `migrations/020_compressed_dhan_candle_series.sql`

- [x] Add a stable numeric `instrument_id` to `dhan_instruments`.
- [x] Recreate the currently-empty `dhan_daily_candles` table with compact columns.
- [x] Replace row-per-candle storage with `dhan_daily_candle_series`.
- [x] Keep primary key on `instrument_id` and a `to_date` lookup index.
- [x] Preserve RLS/read policy and service-role grants.

### Task 3: Historical-Only EOD Repair

**Files:**
- Modify: `scripts/dhan-eod-update.mjs`
- Test: `tests/dhan-jobs.test.mjs`

- [x] Replace live-to-daily finalization with historical API repair.
- [x] Fetch exactly three calendar days inclusive: `fromDate = toDate - 2 days`.
- [x] Merge repaired candles into the compressed instrument series.
- [x] Clear `dhan_live_today` after EOD, without using it as a candle source.
- [x] Wait between historical API calls; default EOD delay is 2500ms per symbol.
- [x] Use the IST calendar date for the EOD repair window.

### Task 4: Query Compatibility

**Files:**
- Modify: `dhan_market_data.js`
- Test: `tests/dhan-routes.test.mjs`

- [x] Join `dhan_daily_candle_series` to `dhan_instruments` by `instrument_id`.
- [x] Return OHLC values as rupees by decompressing the series in the API.
- [x] Keep chart, 52-week high/low, and live overlay API shapes unchanged.

### Task 5: Verification And Rollout

**Files:**
- Modify as needed based on tests.

- [x] Run focused Dhan tests.
- [x] Run full `npm test`.
- [ ] Commit and push.
- [ ] Apply migration to production while candle table is empty.
- [ ] Run a tiny since-inception pilot backfill with 2-3 second per-symbol delay.
- [ ] Check DB size/WAL before continuing.
