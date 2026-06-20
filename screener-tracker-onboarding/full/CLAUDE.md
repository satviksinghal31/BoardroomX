# BoardroomX — Claude Context File

> Auto-loaded by Claude Code at every session start.  
> **Keep this file accurate.** Run `npm run repomap` after significant changes.

---

## Project Identity

**Name:** BoardroomX (repo: screener-tracker)  
**Owner:** Satvik Singhal — satviksinghal31@gmail.com  
**Production URL:** https://portfolio-tracker-production-fe7d.up.railway.app/  
**Stack:** Node.js/Express · Vanilla JS (no framework) · Supabase (auth + Postgres) · Railway (hosting)

---

## Architecture at a Glance

```
Browser (public/)              Server (server.js ~1085 lines)
  app.js  ~2500 lines    ←→     /api/portfolio        (user-scoped)
  auth.js   ~433 lines          /api/watchlist        (add/remove)
  index.html                    /api/financials       (screener data)
  style.css                     /api/candles          (yahoo chart data)
  auth.html                     /api/quotes           (live price)
  godmode.html                  /api/universe         (active market universe, public)
                                /api/events/*         (NSE event-calendar feed)
                                /api/scheduler/log    (cron health + log stream)
                          ←→   Supabase DB (tables below)
                          ←→   ScreenerScraperPro    (quarterly results)
                          ←→   Yahoo Finance API     (candles / quotes)
                          ←→   NSE India public API  (event-calendar + bhavcopy)
```

### Database Tables (Supabase / Postgres)
| Table | Purpose |
|-------|---------|
| `watchlists` | Join table: `user_id` + `symbol` — makes app multi-tenant |
| `stocks` | Global catalog: symbol, name, sector, fetched_at |
| `financials` | Quarterly P&L / balance sheet per symbol |
| `results` | Board meeting / earnings dates (NSE announcements per-symbol) |
| `nse_board_meetings` | **DEPRECATED** — kept for backward compat; not written by cron anymore |
| `nse_bm_runs` | BM cron health state (id=1); still read by `/api/bm/status` |
| `nse_events` | NSE event-calendar data — 11K+ rows, 2329 symbols, all board meetings |
| `dhan_instruments` | Canonical Dhan NSE equity instrument universe |
| `nse_eod_market_caps` | Dated NSE EOD market-cap facts from bhavcopy |
| `market_universe` | View joining active Dhan instruments to latest EOD market cap |

**RLS is ON** for watchlists. Service role bypasses RLS for server-side ops.

---

## CRITICAL: Two-Client Supabase Pattern

**Never collapse these into one client — auth pollution will break everything.**

```js
// server.js (and auth_routes.js)
const supabase      = createClient(URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const supabaseAuth  = createClient(URL, ANON_KEY,         { auth: { persistSession: false, autoRefreshToken: false } });
```

- `supabase` (service_role): all `.from()` DB queries, `auth.admin.*`, `auth.getUser(token)`
- `supabaseAuth` (anon): `signInWithPassword`, `refreshSession` ONLY
- **Bug BX-002**: calling `signInWithPassword` on the service_role client switches its auth state for all subsequent `.from()` queries — this caused post-signup blank portfolios and took hours to debug. NEVER mix them.

---

## Multi-Tenant Architecture

App is **per-user**. Each user has their own watchlist of symbols. Global catalog (`stocks`, `financials`) is shared — no data duplication.

Flow:
1. User adds symbol → `POST /api/watchlist` inserts into `watchlists(user_id, symbol)`
2. `/api/portfolio` joins `watchlists` on `user_id` → only returns user's stocks
3. Financials scraped on-demand (first add) + background worker keeps catalog fresh

**Never** read directly from `financials` or `stocks` without filtering by user's watchlist.

---

## Auth Flow

```
auth.html → Supabase anon client → JWT in localStorage
app.js    → bxFetch() → attaches Bearer token → server middleware
server.js → requireAuth(supabase) → req.user.id
```

`bxFetch(url, init)` in `public/auth.js`:
- Attaches `Authorization: Bearer <token>`
- On 401: tries `refreshSession()` once, retries request
- On second 401: redirects to `/auth.html`

`requireAuth(supabase)` in `auth_middleware.js`:
- Calls `supabase.auth.getUser(token)` (service_role client — validates JWT)
- Sets `req.user = { id, email }`

---

## Background Catalog Worker

Defined at the bottom of `server.js`:

```js
setTimeout(() => {
  catalogWorkerTick();
  setInterval(catalogWorkerTick, CATALOG_WORKER_INTERVAL_MS); // 60s
}, 30_000);
```

`catalogWorkerTick()`:
1. Finds symbol with oldest `financials.fetched_at` (or null)
2. Calls `scrapeAndStore(symbol, {}, supabase)`
3. Calls `syncBoardMeetings(symbol, supabase)` best-effort (writes to `results` + `nse_board_meetings`)
4. Covers active symbols from `market_universe` (Dhan instruments plus latest EOD market cap)

**On first deploy**, worker bootstraps the entire catalog. After that, it keeps data fresh on a rolling basis.

---

## Non-Blocking Add Flow (P2.2-C)

When user adds a symbol:
1. `POST /api/watchlist` — inserts into watchlists, checks if financials exist
2. If financials exist: returns `{ bootstrapping: false }` instantly
3. If not: fires `scrapeAndStore` async (fire-and-forget), returns `{ bootstrapping: true }` immediately (< 1.5s)
4. Client sees `bootstrapping: true` → shows loading pill in stock row
5. `_pollUntilBootstrapped(symbol)` polls `/api/portfolio` every 3-5s, max 12 attempts
6. When `stock.quarters8` appears: removes pill, renders full chart

---

## Market Universe — Live DB

**`dhan_instruments` table**: source of truth for tradable NSE equity instruments from Dhan scrip master.

**`nse_eod_market_caps` table**: dated market-cap facts from NSE bhavcopy ZIP (`PR{DDMMYY}.zip`). This table is enrichment only; it is not the stock universe.

**`market_universe` view**: active Dhan instruments left-joined to latest market cap.

`/api/universe` (GET, no auth): returns `[{symbol, company_name, market_cap}]` for active market-universe rows.

**Client-side search**: `app.js` calls `/api/universe` once on load, stores in `MARKET_UNIVERSE[]`, does local filtering. No `/api/search` endpoint exists.

---

## NSE Events — Event Calendar

**nse_events table**: 11K+ rows, 7 columns: `unique_key, symbol, company, purpose, bm_desc, date, ingested_at`.

**Unique key**: `symbol|purpose|bm_desc|date` — prevents duplicates on re-fetch.

**Cron**: `nse_events_cron.js` — fires at 8am + 8pm IST. Fetches:
- Past 7 days (catches corrections + new disclosures)
- Next 90 days (upcoming board meetings)
Source: `https://www.nseindia.com/api/event-calendar?index=equities&from_date=...&to_date=...`

**5-min in-memory cache**: `_evFetchAll()` caches all rows, serves all filter combos from memory.

**Sort logic** in `/api/events/grouped`:
1. `latest_ingested_at DESC` (newest cron batch first — "NEW" badge in God Mode)
2. `has_upcoming DESC` (companies with upcoming events above past-only)
3. `symbol ASC` (alphabetical within same batch/tier)

---

## Key Frontend Patterns (app.js)

### Stock Selection Flow
```
selectStock(symbol, name)
  → selectedSymbol = symbol
  → _updateChartHeader(symbol)   ← called unconditionally
  → loadDesktopChart(symbol)
```

**`_updateChartHeader(symbol)`** — shared helper. Always guard async boundaries:
```js
if (selectedSymbol !== symbol) return;  // stale — user switched stocks mid-await
```
This guard must appear after EVERY await inside chart/header loading functions.

### Chart Header Updates
`_updateChartHeader(symbol)` reads from `portfolioData` (global array). It updates:
- Stock name + price + change
- Live quote badge
- About card (pros/cons, CAGRs)

### Bootstrap Polling
```js
_bootstrappingSymbols = new Set()
isBootstrapping(symbol) → checks set
_pollUntilBootstrapped(symbol, attempt=1) → polls /api/portfolio every 3-5s
```

### Earnings Markers (earningsMarkers) — Bug History
**Wrong pattern** (DO NOT USE):
```js
const pRow = withData[idx - 4];  // idx from filtered array → wrong
```
**Correct pattern**:
```js
const wIdx = withData.indexOf(r);
const pRow = wIdx >= 4 ? withData[wIdx - 4] : null;
```
`withData` is the full array with data; always use `.indexOf()` to get real index.

---

## API Endpoints Summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/portfolio` | ✓ | User's stocks with market data + financials |
| POST | `/api/watchlist` | ✓ | Add symbol to user's watchlist |
| DELETE | `/api/watchlist/:symbol` | ✓ | Remove symbol |
| GET | `/api/financials?symbol=X` | ✓ | Quarterly data for symbol |
| GET | `/api/candles?symbol=X` | ✓ | 5Y OHLCV chart data (cached 15min) |
| GET | `/api/quotes` | ✓ | Live price for all user stocks (cached 2min) |
| GET | `/api/universe` | — | All 2144 NSE EQ stocks (public, used for search) |
| GET | `/api/events/purposes` | ✓ | Distinct purpose tokens for filter dropdown |
| GET | `/api/events/list?symbol=X` | ✓ | All events for one symbol |
| GET | `/api/events/grouped` | ✓ | Company-grouped event feed; `?purpose=`, `?type=`, `?symbol=`, `?limit=`, `?offset=` |
| GET | `/api/bm/status` | ✓ | Legacy BM cron health (nse_bm_runs row) — kept for backward compat |
| GET | `/api/scheduler/log` | ✓ | All scheduled jobs + last 50 log entries |
| POST | `/auth/login` | — | Returns JWT |
| POST | `/auth/register` | — | Creates user + returns JWT |
| POST | `/auth/refresh` | — | Refreshes JWT |

All `/api/*` routes require `Authorization: Bearer <token>` header (except `/api/universe`).  
Always return JSON — never let Express send an HTML error page.

---

## Scheduled Jobs (Railway Cron)

| Job | Schedule | Source | Target |
|-----|----------|--------|--------|
| `events-cron` | 08:00 + 20:00 IST (`30 2,14 * * *` UTC) | `npm run cron:events` | `nse_events` table |
| `eod-market-cap` | 18:30 IST (`0 13 * * *` UTC) | `npm run cron:eod-market-cap` | `nse_eod_market_caps` |

The Express web process must not start cron timers. Railway Cron starts one-off
containers, and `scripts/run-cron.mjs` writes `scheduler_log` rows:
`started` plus terminal `ok`, `error`, or `skipped`. The runner uses
`pg_try_advisory_lock(hashtext(job))` as defense-in-depth against duplicate
manual triggers or overlapping cron containers.

Create two separate Railway cron services from the same repo and environment:

1. `events-cron`
   - Cron schedule: `30 2,14 * * *`
   - Start command: `npm run cron:events`
2. `eod-market-cap`
   - Cron schedule: `0 13 * * *`
   - Start command: `npm run cron:eod-market-cap`

Railway evaluates cron expressions in UTC. These cron services should not expose
HTTP ports and should exit after the command finishes.

After deploying this refactor, run once:

```sql
DELETE FROM scheduler_log WHERE status IN ('scheduled', 'running', 'warn');
```

---

## Files Reference

| File | Role |
|------|------|
| `server.js` | Main Express server (~1085 lines) |
| `auth_middleware.js` | `requireAuth(supabase)` factory |
| `auth_routes.js` | Login/register/refresh — uses two-client pattern |
| `scraper.js` | `scrapeAndStore(symbol, opts, supabase)` — calls ScreenerScraperPro + syncBoardMeetings |
| `nse_announcements.js` | `syncBoardMeetings(symbol, supabase)` — per-symbol board meeting (writes `results` + `nse_board_meetings`) |
| `nse_events_cron.js` | `runEventsCron(supabase)` — bulk event-calendar cron logic |
| `scripts/run-cron.mjs` | One-off Railway Cron runner with scheduler logging + advisory lock |
| `kite_routes.js` | Zerodha Kite Connect integration (secondary feature) |
| `scripts/dhan-instrument-sync.mjs` | Downloads Dhan scrip master and upserts active NSE EQ instruments |
| `scripts/eod-market-cap.mjs` | Fetches latest NSE bhavcopy market-cap CSV and upserts dated facts |
| `scripts/backfill-events.mjs` | One-time: 12-month backfill of nse_events from event-calendar API |
| `public/app.js` | Main SPA frontend (~2500 lines) |
| `public/auth.js` | Auth + `bxFetch` wrapper (~433 lines) |
| `public/godmode.html` | Internal dashboard: tick health + NSE Events tab + Scheduler tab |
| `public/style.css` | All styles including loading pill, timeline, empty state |
| `public/index.html` | Single-page shell |
| `public/auth.html` | Login/signup page |
| `portfolio.json` | Legacy seed file (≤30 stocks) — still used for yahooSymbol overrides |
| `migrations/` | SQL migration files (001–012) |
| `scripts/` | QA harness, verify scripts, one-off utilities |
| `REPOMAP.md` | Auto-generated symbol index — check before searching |

---

## Environment Variables

| Variable | Where Used |
|----------|-----------|
| `SUPABASE_URL` | Both clients |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase` client (service role) |
| `SUPABASE_ANON_KEY` | `supabaseAuth` client |
| `PORT` | Express listen (Railway sets this) |
| `KITE_API_KEY` | Kite Connect |

Set in Railway for production. `.env` for local dev.

---

## Common Gotchas

1. **`portfolio.json` is NOT the user's portfolio** — it's a legacy seed / yahoo symbol override map. User portfolios live in `watchlists` table.
2. **Sector data** comes from `stocks.sector` column. Dhan and NSE bhavcopy do not provide sector; use Screener-backed enrichment for sector coverage.
3. **Yahoo Finance tickers** need `.NS` suffix for NSE stocks: `toYahooTicker("BAJFINANCE")` → `"BAJFINANCE.NS"`. Override via `yahooSymbol` field in `portfolio.json`.
4. **ScreenerScraperPro** fetches from Screener.in. Symbol must be uppercase NSE symbol. Scraping takes 5-10s — never call synchronously in a request handler.
5. **NSE API** needs a cookie warm-up GET before the actual data fetch. See `nse_events_cron.js` for the warm-up pattern.
6. **CSS class `.det-timeline`**: max-height 380px, overflow-y auto — don't increase without testing scroll on small screens.
7. **Empty portfolio**: `/api/portfolio` returns `[]` (not 500) when user has no watchlist entries. Frontend shows `.wl-empty` state with search CTA.
8. **Large table reads — always use `dbPool` (direct pg), never the Supabase JS REST client**: PostgREST hard-caps every response at **1000 rows** regardless of `.range()` arguments. PAGE > 1000 silently truncates and exits after one page — this caused `_evFetchAll()` to load 1000/11499 rows and show 829/2341 companies. **Rule**: any SELECT that may exceed 1000 rows must use `dbPool.query('SELECT ...')`. The `dbPool` (`pg.Pool`) uses `SUPABASE_DB_URL` — direct Postgres, no cap. Use `supabase` (REST) only for mutations and single-row lookups. `_evFetchAll()` and `_loadUniverseCache()` now use `dbPool` with a REST fallback and an async count-validation guard.
9. **nse_events sort**: `ingested_at DESC` → latest cron batch first. NEW badge shown in God Mode when `ingested_at < 24h ago`. Companies with only old data sink to bottom — expected behavior.
10. **bhavcopy ZIP URL**: `https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR{DDMMYY}.zip` (2-digit year). Contains `mcap{DDMMYYYY}.csv`. Walk back up to 7 days to find latest.

---

## Development Workflow

```bash
# Local dev
npm start                    # starts server on :3001

# QA
node scripts/qa-full.mjs     # 36-test full QA (creates + cleans throwaway user)
node scripts/verify-nonblock.mjs SYMBOL   # test non-blocking add

# Universe and market-cap jobs
node scripts/dhan-instrument-sync.mjs      # Dhan source-of-truth instrument sync
node scripts/eod-market-cap.mjs            # latest NSE EOD market-cap facts

# Events backfill (one-time / disaster recovery)
node scripts/backfill-events.mjs           # 12-month backfill
node scripts/backfill-events.mjs --dry-run # preview only

# Regenerate REPOMAP after big changes
npm run repomap

# Run a migration
node scripts/run-migration.mjs migrations/00X_name.sql
```

**Deploy:** Push to main → Railway auto-deploys. Check Railway logs for startup errors.

---

## Pending Cleanup (Post Prod Confirmation)

- `nse_board_meetings` table: can be dropped once God Mode confirmed working on prod
- `nse_bm_runs` table + `/api/bm/status`: can be removed
- `nse_announcements.js` `syncBoardMeetings()`: called in `scraper.js` per-symbol add — decide whether to keep or switch to no-op

---

*Last updated: 2026-06-20 (Dhan market universe + EOD market-cap refactor) | Maintained by: Codex*
