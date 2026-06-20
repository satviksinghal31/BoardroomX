# BoardroomX — Handoff Document

> **Generated:** 2026-05-27
> **Purpose:** Resume work on another device or hand off context to a fresh Claude Code session.
> **Audience:** Future-you, or another developer/agent picking up exactly where this left off.

Read this top-to-bottom before touching any code. Everything is current as of the timestamp above.

---

## 1. Project snapshot

| Property | Value |
|---|---|
| Repo name | `screener-tracker` (product name: **BoardroomX**) |
| Local path | `/Users/satviksinghal/screener-tracker` |
| Production URL | https://portfolio-tracker-production-fe7d.up.railway.app/ |
| Hosting | Railway (auto-deploys from `main` branch) |
| Database | Supabase (Postgres + Auth) |
| Owner | Satvik Singhal — satviksinghal31@gmail.com |
| Stack | Node.js · Express · vanilla JS frontend · Supabase · Yahoo Finance · NSE public API |

---

## 2. Where we are right now (the **honest** state)

### Working in production
- Multi-tenant auth (Supabase JWT in localStorage, `bxFetch` wrapper, `requireAuth` middleware)
- `/api/portfolio`, `/api/watchlist`, `/api/financials`, `/api/candles`, `/api/quotes`, `/api/universe`
- `/api/events/grouped`, `/api/events/list`, `/api/events/purposes`
- `/api/scheduler/log` (cron health, persisted to DB table `scheduler_log`)
- God Mode dashboard (`/godmode.html`) — NSE Events tab, Scheduler tab, all 8 recent UX fixes shipped
- `nse_events` table — 11K+ rows, 2329 symbols (12-month backfill complete)
- `nse_universe` table — 2144 EQ-series stocks with market cap
- Background catalog worker (1 symbol/min, scrapes financials + board meetings)

### Known broken / non-ideal (pending fixes)
- **4× concurrent cron fires at scheduled slots.** Root cause: in-process `setTimeout` × N Railway containers = N fires. The "duplicate-instance guard" added in commit `0181010` is insufficient. **A full architecture redesign was discussed in the last session but NOT yet implemented.** See §6.
- `nse_board_meetings` and `nse_bm_runs` tables: deprecated, kept for backward compat. Can be dropped once new scheduler ships.
- `_schedLog` writes `scheduled` rows that pollute `scheduler_log` on every restart (currently filtered out on read — see commit `184b6bb`).

### Not started
- Scheduler refactor (Railway Cron + cleanup). Architecture decided, awaiting four user decisions before code. See §6.

---

## 3. Recent commits (newest first — all on `main`, all deployed)

| Commit | What it did |
|---|---|
| `9a937d8` | **Fix events-cron `new=0` bug** — was reading `data.length` from `upsert({ignoreDuplicates:true}).select()` which returns `[]` for ON CONFLICT DO NOTHING. Now counts via `ingested_at >= cronStartIso` after upsert. |
| `db55529` | **Resilient bhavcopy fetch + retry-with-reason scheduler pattern** — `_scheduleDaily` now supports `fn()` returning `{_retryMs, _retryReason}` for one-shot retry; logged with reason. |
| `1cbdb68` | **Fix bhavcopy temp file race condition** — hardcoded `/tmp/bhavcopy_refresh.zip` was shared by concurrent runs → corruption. Now unique path per iteration: `/tmp/bhavcopy_${Date.now()}_${pid}_${back}.zip`. |
| `0181010` | **Duplicate-instance guard** added to both `_scheduleDaily` and `scheduleEventsCron` (checks DB for `status='ok'` in last 30min). **Note: insufficient — see §6.** |
| `184b6bb` | God Mode: 8 UX fixes — scheduler log cleanup, stats placement, filter clarity, page-refresh blank state, NEW badge tooltip |
| `d322aca` | Fix 502 on prod — pg pool unhandled rejection + startup connectivity test |
| `c395b01` | Switch large table reads to direct pg pool — eliminates PostgREST 1000-row cap |
| `e54698c` | Fix `_evFetchAll` pagination — was loading 1000/11499 rows |
| `af14e05` | Migration 014 — persist `scheduler_log` to DB; add "new-rows" badge in God Mode |
| `5a098a5` | Migration 013 — drop `nse_board_meetings` + `nse_bm_runs` (cleanup) |

---

## 4. The current critical issue: 4 concurrent cron fires

### Symptom
Scheduler tab in God Mode shows 4× "started" entries for `events-cron` at exactly 08:00 IST. Should be exactly 1.

### Root cause
- Railway does rolling deploys (old container stays alive briefly while new one boots)
- Each push during a development day spawns a new container
- Each container runs `setTimeout(...)` for the next scheduled slot
- At 08:00 IST all N containers fire **simultaneously**
- The existing duplicate guard checks DB for recent `status='ok'` — but all 4 instances check **before any has written 'ok'**, so all 4 pass the guard and all 4 run

### Data impact
**Zero.** The `unique_key` PRIMARY KEY on `nse_events` (`symbol|purpose|bm_desc|date`) makes upserts idempotent. The bug only causes:
1. Wasted NSE API calls (4× the request volume — rate-limit risk)
2. Misleading log entries
3. Code smell that hides future bugs

### Why the existing guard fails
```js
// nse_events_cron.js line 178
const { data: recent } = await supabase
  .from('scheduler_log')
  .select('ts').eq('job', 'events-cron')
  .eq('status', 'ok')                       // ← only checks completed runs
  .order('ts', { ascending: false }).limit(1);
// 4 instances all reach this check simultaneously → all see no recent 'ok' → all proceed
```

### The fix (decided, not yet implemented)
Move scheduling **out of the web process** to **Railway Cron services**. Each cron service spawns a fresh one-off container at the scheduled time. No more in-process `setTimeout`. No more multi-container fires.

Full architecture in §6.

---

## 5. Other recently-fixed bugs (context for what was learned)

### 5a. Events-cron `new=0` bug (commit 9a937d8)
**What:** Scheduler log said `new=0` even when genuinely new rows like RPPL, TOLINS were ingested.
**Why:** PostgREST `ON CONFLICT DO NOTHING RETURNING *` returns `[]` for both inserted-but-conflicted AND inserted-fresh rows. We were doing `data.length` after `.upsert({ignoreDuplicates:true}).select()`.
**Fix:** Capture `cronStartIso = new Date().toISOString()` before any work. After upsert, query `SELECT count(*) WHERE ingested_at >= cronStartIso`. That's the true new-row count.

### 5b. Bhavcopy `{updated:0, total:0}` at midnight (commit 1cbdb68)
**What:** Multiple universe-mcap runs at midnight all returned 0 rows updated.
**Why:** Concurrent instances all wrote to `/tmp/bhavcopy_refresh.zip` → file corruption → unzip failed.
**Fix:** Unique temp path per run: `` `/tmp/bhavcopy_${Date.now()}_${process.pid}_${back}.zip` ``.

### 5c. PostgREST 1000-row cap (commits c395b01, e54698c)
**What:** `_evFetchAll()` loaded 1000/11499 rows; God Mode showed 829/2341 companies.
**Why:** PostgREST hard-caps every response at 1000 rows regardless of `.range()`. Pagination loops that don't break on `< 1000` silently truncate.
**Fix:** All large reads now use `dbPool.query(...)` (direct pg via `SUPABASE_DB_URL`). REST client only for mutations + small reads.
**Rule encoded in CLAUDE.md gotcha #8.**

### 5d. God Mode 8 UX fixes (commit 184b6bb)
1. Stats moved inside NSE Events tab (not global)
2. Removed "New (last cron)" + "Next cron in" cards (3 cards only)
3. `scheduled` status never written to log
4. `ok` rows show new-row count
5. NEW badge tooltip clarifies meaning (rows ingested in last 24h)
6. Sort confirmed: `ingested_at DESC` → `has_upcoming DESC` → `symbol ASC`
7. Page refresh of `/godmode.html` no longer shows blank events tab (init now calls `switchTab('events')`)
8. Log filter: in-memory ring buffer excludes legacy `scheduled` rows

---

## 6. PENDING DECISION: scheduler refactor

A multi-message architecture discussion happened. Outcome: agreed approach, awaiting four explicit go/no-go answers before implementation.

### The architecture (CTO-balanced, minimal)

**Move triggers to Railway Cron services. Remove in-process scheduler. Inline everything that doesn't need a separate file.**

```
NEW FILE
─────────────────────────────────────────────────────
scripts/run-cron.mjs  (~100 lines, no other new files)
  - 10-min hard timeout
  - parse argv[2] as job name
  - INSERT scheduler_log (status='started')
  - [optional 5 lines] pg_try_advisory_lock — return early if held
  - call runEventsCron OR refreshMcapOnly directly (no wrapper)
  - INSERT scheduler_log (status='ok'|'error'|'skipped')
  - exit

DELETIONS
─────────────────────────────────────────────────────
server.js         : remove _scheduleDaily, _midnightMcapRefresh,
                    _schedLog, _schedNextRun, scheduleEventsCron call (~150 lines)
nse_events_cron.js: delete scheduleEventsCron function (~60 lines)

RAILWAY (manual, in dashboard)
─────────────────────────────────────────────────────
+ Service "events-cron"    cron 30 2,14 * * *   cmd: node scripts/run-cron.mjs events-cron
+ Service "universe-mcap"  cron 0 13 * * *      cmd: node scripts/run-cron.mjs universe-mcap

DB (one-time SQL)
─────────────────────────────────────────────────────
DELETE FROM scheduler_log WHERE status IN ('scheduled', 'running', 'warn');
```

### Schedule rationale

| Job | New IST time | UTC cron | Reason |
|---|---|---|---|
| `events-cron` | 08:00 + 20:00 | `30 2,14 * * *` | Catches overnight + pre-market filings (8am) and post-market filings (8pm). "Past 7 days" window self-heals missed slots up to a week. |
| `universe-mcap` | 18:30 | `0 13 * * *` | After NSE bhavcopy publish window closes (~17-18:00 IST). Single slot replaces previous 16:30 + midnight retry. |

### Four open questions (need explicit answers)

1. **Q1 — Confirm Railway Cron is available on current plan.** Open Railway dashboard → any service → Settings → look for "Cron Schedule" field.
2. **J1 — Include the 5-line `pg_try_advisory_lock` defense-in-depth (inline in `run-cron.mjs`, no new file)?** CTO recommendation: yes. Removes hypothetical collision risk forever for 5 lines.
3. **J2 — God Mode "next run in Xm" display: hardcode the IST times in UI, or add `cron-parser` dep?** CTO recommendation: hardcode.
4. **J3 — Two log rows per run (`started` + terminal), or just one terminal row?** CTO recommendation: two (gives "currently running" indicator in UI).

### What was rejected (over-engineered for this app size)

- Separate `jobs/` directory with `events.js`, `universe-mcap.js`, `with-lock.js` files
- `lib/scheduler-log.js` as its own module
- `lib/db.js` to extract dbPool (cron is one-off; doesn't need a pool)
- Update-in-place log rows (track ID, update on finish)
- `--from --to` flags inside `run-cron.mjs` (keep existing `backfill-events.mjs` separate)
- 5-phase migration with 24h parallel-run gate
- Full 17-section PRD document committed to repo
- Jitter, "running" status check, retry-with-backoff inside the cron — `_retryMs`/`_retryReason` mechanism gets DELETED entirely

### Implementation plan (when given go-ahead)

1. Write `scripts/run-cron.mjs` (~100 lines including the 5-line lock if J1=yes)
2. Local smoke test: `node scripts/run-cron.mjs events-cron` exits 0, writes 1 started + 1 terminal row
3. Local lock test (if J1=yes): two terminals simultaneously → second exits with `skipped`
4. Commit + deploy to Railway
5. **In Railway dashboard:** create 2 new services pointing at same repo with the cron schedules above
6. Manually trigger each from dashboard to verify
7. Wait one natural slot — verify exactly 1 row per slot
8. **Then** delete in-app scheduler code from `server.js` + `nse_events_cron.js`
9. Run cleanup SQL: `DELETE FROM scheduler_log WHERE status IN ('scheduled', 'running', 'warn')`
10. Update `CLAUDE.md` §"Scheduled Jobs"

### Rollback if anything goes wrong

```bash
git revert <step-8-commit-hash>
# Deploy
# Disable Railway Cron services (toggle off cronSchedule)
# In-app scheduler resumes automatically
```

No data rollback ever needed — all writes are idempotent via `unique_key`.

---

## 7. Two-client Supabase pattern (CRITICAL — never violate)

```js
// server.js + auth_routes.js
const supabase     = createClient(URL, SERVICE_ROLE_KEY, { auth: {...} });  // ALL .from() ops
const supabaseAuth = createClient(URL, ANON_KEY,         { auth: {...} });  // signIn ONLY
```

`signInWithPassword` on the service-role client switches its auth state for ALL subsequent `.from()` queries → blank portfolios, hours of debugging. Bug BX-002. **Never mix.**

---

## 8. Setup on a new device

```bash
# 1. Unzip
cd ~/somewhere
unzip screener-tracker-handoff-2026-05-27.zip
cd screener-tracker

# 2. Install
npm install

# 3. Verify .env is present (came inside the zip)
cat .env   # should show SUPABASE_URL, keys, SCREENER_*, etc.

# 4. Start
npm start
# → "Portfolio: 25/30 stocks loaded."
# → Server on :3001

# 5. Open
open http://localhost:3001/                  # main app
open http://localhost:3001/godmode.html      # internal dashboard
```

### Required env vars (in `.env`, included in zip)

| Var | Purpose |
|---|---|
| `PORT` | Express port (Railway sets this in prod) |
| `SUPABASE_URL` | Both clients |
| `SUPABASE_ANON_KEY` | `supabaseAuth` client |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase` (service-role) client |
| `SUPABASE_DB_URL` | Direct pg pool — for >1000-row reads |
| `SCREENER_EMAIL` / `SCREENER_PASSWORD` | ScreenerScraperPro auth |
| `KITE_REDIRECT_URL` | Zerodha Kite Connect (secondary feature) |

### What's NOT in the zip
- `node_modules/` — reinstall with `npm install`
- `.git/` — clone fresh with `git clone <repo-url>` if you want git history
- `data/` — scraped artifacts, regenerable
- `screener-tracker-code-antigravity.zip` — old archive

---

## 9. Source-of-truth files (read these first on a new device)

| File | Why |
|---|---|
| `HANDOFF.md` (this file) | Current state + pending work |
| `CLAUDE.md` | Architecture, patterns, gotchas, file map |
| `REPOMAP.md` | Auto-generated symbol index — `npm run repomap` to refresh |
| `server.js` | Main Express server (~1260 lines after recent additions) |
| `nse_events_cron.js` | Bulk event-calendar cron (this file is the centerpiece of the pending refactor) |
| `scripts/refresh-universe.mjs` | NSE EQUITY_L + bhavcopy mcap |
| `public/godmode.html` | Internal dashboard — single file with all tabs |

---

## 10. Tasks (from session task list)

**In-progress (still open):**
- #27 Multi-agent QA pass — Stage 2 + 3 + fix plan
- #28 Phase 1: Mar 2026 completion — catalog cleanup + flag + SCREENER simplify

**Completed (latest first):**
- #26 CHUNK 3 — Intelligence + UI
- #25 CHUNK 2 — NSE bulk agent
- #24 CHUNK 1 — Foundation + SCREENER agent rebuild
- #23 CONTEXT-INFRA: CLAUDE.md + REPOMAP + hooks fail-safe
- (all earlier tasks — see git log)

---

## 11. Migrations applied (in order)

```
001_multitenant.sql           — watchlists table + RLS
002_grant_watchlists.sql      — grant policies
003_stocks_sector.sql         — stocks.sector column
004_results_purpose.sql       — results.purpose column
005_backfill_categories.sql   — one-time data fix
006_nse_synced_at.sql         — nse sync tracking
007_agent_state.sql           — agent state table
008_god_logs.sql              — god mode logs
009_mar_2026_complete.sql     — catalog cleanup
010_nse_board_meetings.sql    — (DEPRECATED, dropped in 013)
011_nse_universe.sql          — nse_universe table
012_nse_events.sql            — nse_events table (the big one)
013_drop_nse_bm_tables.sql    — drop deprecated tables
014_scheduler_log.sql         — persist scheduler log to DB
```

**Next migration (when scheduler refactor ships):** cleanup SQL for legacy log statuses (1 line: `DELETE FROM scheduler_log WHERE status IN ('scheduled', 'running', 'warn')`). Not worth a numbered migration file.

---

## 12. Quick reference: what to do on a fresh Claude session

Paste this into a new session to bootstrap context:

```
Resume BoardroomX work. Repo at <path>. Read HANDOFF.md first, then
CLAUDE.md for architecture. Current state: scheduler refactor pending —
4 open questions in HANDOFF.md §6. Awaiting answers before implementing.
```

---

## 13. Safety notes for this handoff

- **The `.env` in this zip contains production Supabase service-role key.** Anyone with this key has full read/write to the production database.
- **Transfer the zip over a trusted channel only:** AirDrop, encrypted USB, password-protected cloud share. Never email, never drop in a Slack channel, never commit to public git.
- **After transferring:** rotate the Supabase service-role key if you're at all unsure who saw the zip in transit. Supabase Dashboard → Project Settings → API → Rotate.
- The Screener.in credentials in `.env` are also production credentials. Same care applies.

---

*End of handoff. Last updated 2026-05-27. Maintained by: Claude Code.*
