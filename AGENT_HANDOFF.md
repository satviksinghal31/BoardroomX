# BoardroomX Agent Handoff

BoardroomX is a Node.js/Express and vanilla JavaScript stock intelligence app deployed on Railway with Supabase/Postgres as the database.

## Primary App

The production app lives in:

```text
screener-tracker-onboarding/full
```

Railway should deploy from this directory, or from the repository root with the service root set to `screener-tracker-onboarding/full`.

## Module Ownership

### Core Server

- `server.js`: Express app, portfolio/watchlist APIs, chart/quote APIs, Supabase clients, cache warmup, and background catalog worker.
- `auth_middleware.js`: JWT validation middleware.
- `auth_routes.js`: login, registration, refresh flow. Keep service-role and anon Supabase clients separate.

### Frontend

- `public/index.html`: main app shell.
- `public/app.js`: watchlist UI, chart rendering, RSI/EMA/gap calculations, events UI, and stock selection flow.
- `public/style.css`: main application styling.
- `public/auth.html`, `public/auth.js`, `public/auth.css`: authentication UI and authenticated fetch wrapper.
- `public/godmode.html`: internal operations dashboard.
- `public/annuals.*`: annual financials UI.

### Market Data And Indicators

- Current chart source is Yahoo Finance through `yahoo-finance2`.
- `/api/chart/:symbol` returns daily OHLCV candles.
- RSI is currently calculated client-side in `public/app.js` from close prices.
- Future Dhan/Upstox work should add a dedicated market-data module rather than expanding `server.js` further.

### Fundamentals And Screener

- `scraper.js`: on-demand Screener quarterly financial scrape.
- `scripts/lib/screener-annuals.mjs`: annual financial parser.
- `scripts/screener-worker.mjs`: annual financial worker.
- `migrations/015_screener_annuals.sql`: annual financial schema.

### NSE Universe And Events

- `scripts/refresh-universe.mjs`: NSE universe and market-cap refresh.
- `nse_events_cron.js`: NSE event-calendar ingestion.
- `scripts/backfill-events.mjs`: one-time historical event backfill.
- `migrations/011_nse_universe.sql`, `012_nse_events.sql`: related schema.

### Scheduler And Railway Cron

- `scripts/run-cron.mjs`: one-off Railway cron runner with scheduler logging and advisory locks.
- Railway cron services:
  - `events-cron`: `npm run cron:events`
  - `universe-mcap`: `npm run cron:universe-mcap`
  - `screener-annuals`: `npm run cron:screener-annuals`

### Broker Integrations

- `kite_routes.js`: existing Zerodha Kite read-only holdings integration.
- Future broker work should be isolated in files like `dhan_routes.js`, `upstox_routes.js`, and `scripts/lib/market-data-provider.mjs`.

### Database

- `migrations/`: schema changes.
- Large reads that may exceed 1000 rows should use direct Postgres via `SUPABASE_DB_URL`, not Supabase REST.

### Tests And QA

- `tests/*.test.mjs`: Node test runner tests.
- `scripts/qa-full.mjs`: end-to-end QA harness.
- `scripts/verify-*.mjs`: targeted verification scripts.

## Environment Variables

Never commit real `.env` files. Use `.env.example` and configure production secrets in Railway.

Required production variables include:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
PORT
```

Optional/current integrations:

```text
KITE_API_KEY
KITE_API_SECRET
KITE_REDIRECT_URL
KITE_ENCRYPTION_KEY
SCREENER_EMAIL
SCREENER_PASSWORD
```

## Development

```bash
cd screener-tracker-onboarding/full
npm install
npm start
```

Run tests:

```bash
cd screener-tracker-onboarding/full
npm test
```

## Deployment

Production URL:

```text
https://portfolio-tracker-production-fe7d.up.railway.app/
```

Deploy by pushing to the GitHub branch connected to Railway. Railway should run:

```bash
npm start
```

from `screener-tracker-onboarding/full`.
