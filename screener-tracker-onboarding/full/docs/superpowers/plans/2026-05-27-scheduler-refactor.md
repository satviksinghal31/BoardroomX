# Scheduler Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move cron execution out of the web process and into Railway Cron one-off commands.

**Architecture:** Add `scripts/run-cron.mjs` as the single job runner. Remove web-process timers from `server.js` and remove `scheduleEventsCron` from `nse_events_cron.js`. Keep `/api/scheduler/log` compatible by computing next-run timestamps from fixed IST schedules.

**Tech Stack:** Node.js ESM, Express, Supabase JS, direct Postgres via `pg`, Node built-in `node:test`.

---

### Task 1: Runner Tests

**Files:**
- Create: `tests/run-cron.test.mjs`
- Modify: `package.json`

- [ ] Add tests for next-run calculation, advisory-lock skip behavior, and result message formatting.
- [ ] Add `npm test` using `node --test`.
- [ ] Run `npm test` and confirm the tests fail because `scripts/run-cron.mjs` does not exist yet.

### Task 2: Cron Runner

**Files:**
- Create: `scripts/run-cron.mjs`

- [ ] Implement job registry for `events-cron` and `universe-mcap`.
- [ ] Implement `withAdvisoryLock()` using `pg_try_advisory_lock(hashtext($1))`.
- [ ] Insert `started`, `skipped`, `ok`, and `error` rows into `scheduler_log`.
- [ ] Add a 10-minute hard timeout.
- [ ] Ensure importing the file does not run a job.
- [ ] Run `npm test` and confirm runner unit tests pass.

### Task 3: Remove In-Process Scheduling

**Files:**
- Modify: `server.js`
- Modify: `nse_events_cron.js`

- [ ] Remove `scheduleEventsCron` import and call from `server.js`.
- [ ] Remove `_schedLog`, `_scheduleDaily`, `_midnightMcapRefresh`, and mutable `_schedNextRun` timer state from `server.js`.
- [ ] Keep `_loadSchedulerLog()` for UI history.
- [ ] Compute `/api/scheduler/log` `jobs` from fixed IST schedules.
- [ ] Remove `scheduleEventsCron()` export from `nse_events_cron.js`.

### Task 4: Verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `HANDOFF.md` if needed

- [ ] Run `npm test`.
- [ ] Run `node --check server.js`.
- [ ] Run `node --check nse_events_cron.js`.
- [ ] Run `node --check scripts/run-cron.mjs`.
- [ ] Start the server and confirm no cron scheduling log appears on startup.
- [ ] Share Railway Cron service commands and cleanup SQL.
