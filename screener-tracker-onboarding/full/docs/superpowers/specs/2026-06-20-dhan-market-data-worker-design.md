# Dhan Market Data Worker Design

## Goal

Replace Yahoo Finance as the production source for BoardroomX charts, live prices, and quote data with DhanHQ, while keeping the user-facing chart and watchlist experience fast, stable, and broad enough to open any active NSE equity.

The chosen architecture is a dedicated market-data worker service plus a thin web API. The web service reads market data from Postgres. The worker owns Dhan authentication, live feed connections, Dhan REST calls, and writes normalized data into Postgres.

## Scope

This phase covers daily charts, live today candle updates, quote/price route replacement, Dhan instrument mapping, historical daily backfill, EOD finalization, worker health, cleanup of obsolete chart/price code, tests, Graphify refresh, GitHub push, and Railway deployment.

This phase does not cover hourly/intraday charts, alerts, GTT/order placement, trading APIs, a queue framework, or a separate notification system.

## Architecture

BoardroomX will run three operational surfaces:

- Web API service: Express app serving existing user routes. It does not open Dhan sockets and does not call Dhan for normal chart reads.
- Market-data worker service: persistent Railway service that owns Dhan token refresh, WebSocket subscription, binary tick decoding, reconnect/backfill behavior, and live candle writes.
- Cron jobs: one-off Railway cron commands for instrument sync and EOD finalization, following the existing `scripts/run-cron.mjs` advisory-lock and `scheduler_log` pattern.

Postgres is the boundary between these surfaces. Dhan `security_id` stays internal to market-data modules. Public and app-level joins continue to use `symbol`.

## Database Design

Migration `016_dhan_market_data.sql` will extend `nse_universe` with:

- `dhan_security_id`
- `dhan_exchange_segment`
- `is_active`

It will add:

- `dhan_daily_candles`: finalized daily OHLCV, primary key `(symbol, trade_date)`.
- `dhan_live_today`: current trading-day OHLC/LTP/volume plus `last_tick_at`.
- `dhan_auth_state`: single-row token state for server-side Dhan access only.

RLS will allow public read policies only for candle/live market data needed by the backend service role. `dhan_auth_state` must not expose a read policy and must be reachable only through service-role/database credentials.

## Data Flow

Instrument sync downloads Dhan's detailed scrip master, filters active NSE equity instruments, maps by symbol/ISIN where available, upserts Dhan IDs onto `nse_universe`, and marks missing instruments inactive instead of deleting them.

Historical backfill fetches daily candles from Dhan `/charts/historical` for active mapped equities and upserts by `(symbol, trade_date)`. It is idempotent and can be resumed.

The market-data worker subscribes to all active mapped NSE equities through Dhan's WebSocket feed. Dhan feed responses are binary, so the worker includes a focused decoder for the packet modes used in this phase. The worker maintains in-memory live candle state and bulk-upserts to `dhan_live_today` on a short interval.

On disconnect or restart, the worker reconnects with backoff and uses Dhan Market Quote REST calls to recover the current day's OHLC/LTP/volume snapshot before continuing live aggregation.

The EOD job runs after market close at 4:00 PM IST. It upserts the final current-day candle into `dhan_daily_candles`, falls back to Market Quote for stale or missing live rows, and clears `dhan_live_today` after successful finalization.

## Web API Behavior

Existing routes stay in place:

- `GET /api/chart/:symbol`
- `GET /api/prices`
- `GET /api/quote/:symbol`

`/api/chart/:symbol` reads full available daily history from `dhan_daily_candles` through `dbPool`, appends a fresh live row only during market hours, and returns the existing `{ candles, displayFrom }` shape.

`/api/prices` reads live rows for the user's visible watchlist plus the currently open chart symbol when needed. It returns the same live patch structure the frontend already uses for `candleSeries.update()`.

`/api/quote/:symbol` reads current live data, previous close, market cap from `nse_universe`, and 52-week high/low from `dhan_daily_candles`. `pe` and `forwardPE` are removed as a deliberate product change because Dhan does not provide equivalent fields in this data path.

`/api/universe` filters out `is_active = false` rows so delisted/inactive symbols disappear from search without deleting historical candles.

## Frontend Compatibility

Most chart rendering remains unchanged because the existing lightweight-charts code already uses full-series `setData()` and live `update(bar)` patches.

Required small frontend changes:

- Add or honor a `MAX` range control as a client-side visible-range zoom over already-fetched daily history.
- Remove or gracefully hide PE/forward-PE display slots.
- Prevent stale live candles from persisting in `chartDataCache` after market close or EOD reset.
- Ensure a searched non-watchlist chart can still receive live candle patches.

No landing-page, visual redesign, or chart library replacement is part of this phase.

## Cleanup Scope

Remove production code that becomes unnecessary after the Dhan cutover:

- Yahoo Finance imports and production dependency.
- `toYahooTicker()`, `yahooSymMap`, and production `yahooSymbol` alias usage.
- `chartCache`, `fetchChartData()`, `refreshChartCache()`, and `refreshAllChartCache()`.
- Yahoo-backed `getMarketData()` and `marketCache` warmers once Dhan-backed portfolio market data is in place.
- Startup timers that warm Yahoo chart/market caches.
- Frontend text or diagnostics that describe Yahoo as the active market-data source.

Do not remove unrelated systems in this phase:

- Screener fundamentals and annuals.
- Watchlist flows.
- Auth routes and Supabase auth separation.
- Kite read-only holdings.
- NSE event calendar.
- Offline research scripts that deliberately use their own reproducible Yahoo cache.

The cleanup rule is simple: remove code only when it is specifically chart, price, quote, or market-data rendering plumbing made obsolete by Dhan. Leave unrelated product surfaces alone.

## Freshness Rules

Market-hours live candles are eligible only during regular NSE session hours, 09:15-15:30 IST. A live row is fresh if `last_tick_at` is within 90 seconds. Outside market hours, charts show finalized daily candles only.

Holidays and special sessions are handled conservatively in this phase: if no fresh live ticks exist, the app behaves as closed-market and does not append a live candle.

52-week high/low uses daily candles over the trailing 365 calendar days plus today's fresh live high/low when available. This mirrors the existing user-facing intent without adding a trading-calendar service in this phase.

## Error Handling

Dhan auth uses stored tokens when they are valid with a safety margin. Refresh uses TOTP and PIN. Transient network or 5xx failures retry with bounded backoff. Terminal auth failures such as invalid PIN/TOTP do not retry repeatedly; they are recorded and surfaced.

Web API routes should return stable JSON with `null` market fields when data is unavailable, not HTML errors or partial crashes. Chart routes return clear 404/empty-data behavior for unmapped or inactive symbols.

The market-data worker should fail visibly on missing required env vars, log reconnect attempts, and expose health based on live-row freshness rather than pretending a persistent worker is a cron job.

## Observability

Batch jobs continue using `scheduler_log` and God Mode's existing scheduler view.

The persistent worker gets a live health endpoint/tile based on:

- active mapped instrument count
- rows fresh in `dhan_live_today`
- latest tick timestamp
- token expiry timestamp
- last worker error

This separates persistent feed health from one-off cron history.

## Testing

Unit tests use Node's built-in test runner and focus on pure logic:

- Dhan auth token reuse, refresh, retry, terminal failure handling.
- Instrument sync filtering and idempotent active/inactive updates.
- Historical candle normalization and idempotent upsert shape.
- Binary feed packet decoding for packet types used by the worker.
- Live candle aggregation, high/low updates, and day rollover.
- Chart route merge behavior for finalized candles plus fresh live candle.
- Stale live row exclusion outside freshness rules.
- EOD finalization and live-table clearing.

Flow verification scripts cover:

- instrument sync active count
- RELIANCE/TCS/HDFCBANK historical spot checks
- searched non-watchlist chart open
- live worker restart and recovery
- EOD finalization
- forced auth refresh
- full existing `scripts/qa-full.mjs` regression

## Cutover

Ship the schema and Dhan modules alongside the current app first. Run instrument sync and selected historical backfills. Validate Dhan historical output and live rows against known symbols. Switch routes to Dhan once validation passes. Remove Yahoo production code and dependency after the cutover passes; keep research scripts' local Yahoo usage untouched.

Deployment will push to GitHub and Railway only after tests and verification pass for the implemented phase.

## Open Decisions

None blocking for the chosen architecture.

Known follow-up decisions for later phases:

- Dedicated alert engine and delivery channels.
- Intraday/hourly data storage and retention.
- Whether to add a trading-calendar table for special market sessions.
