# Scheduler Refactor Design

## Goal

Move scheduled NSE jobs out of the Express web process and into one-off Railway Cron executions so overlapping Railway web containers cannot fire the same job multiple times.

## Current Behavior

`server.js` starts long-lived `setTimeout` schedulers for `events-cron` and `universe-mcap`. Railway deploy overlap can leave multiple web containers alive at the same scheduled slot. Each container checks for a recent `ok` row before any peer has written one, so all containers proceed.

## Target Behavior

The web process serves pages, APIs, cache warmups, and scheduler-log reads only. It does not start cron timers.

Railway Cron services run:

- `node scripts/run-cron.mjs events-cron`
- `node scripts/run-cron.mjs universe-mcap`

Each invocation:

- writes `scheduler_log` status `started`
- attempts a Postgres advisory lock scoped to the job
- exits with `skipped` if another invocation holds the lock
- runs the existing job logic
- writes terminal status `ok` or `error`
- exits non-zero on job errors

## Business Logic Preserved

`events-cron` still calls `runEventsCron(supabase)`, which fetches the NSE event calendar for the past 7 days and next 90 days, builds rows, upserts into `nse_events` using `unique_key`, and counts new rows via `ingested_at >= cronStartIso`.

`universe-mcap` still calls `refreshMcapOnly()`, which fetches the NSE bhavcopy market-cap file and upserts `nse_universe.market_cap`.

## Scheduler Log UI

`/api/scheduler/log` continues returning `{ jobs, log }`. `jobs` is computed from hardcoded IST schedules instead of in-process timer state:

- `events-cron`: 08:00 and 20:00 IST
- `universe-mcap`: 18:30 IST

Legacy `scheduled`, `running`, and `warn` rows should be cleaned from DB manually after deployment.

## Non-Goals

- No new job framework.
- No queue system.
- No retry chain inside the cron runner.
- No change to NSE data model.
- No change to Supabase auth/client split.
