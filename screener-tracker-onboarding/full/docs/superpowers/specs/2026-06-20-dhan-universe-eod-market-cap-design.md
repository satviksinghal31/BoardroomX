# Dhan Universe And EOD Market Cap Design

## Goal

Make Dhan the source of truth for the tradable equity universe, keep NSE bhavcopy only as dated EOD market-cap enrichment, and remove `nse_universe` naming from runtime code so the data model reflects ownership clearly.

## Brutal Assessment

The current `nse_universe` table is overloaded. It represents an NSE company master, a market-cap cache, and Dhan instrument mapping at the same time. That makes freshness and provenance hard to reason about. The correct model is not "one table for everything"; it is one canonical instrument table plus dated fact tables that can be joined.

Keeping bhavcopy is reasonable because it gives useful EOD fields: `issue_size`, `close_price`, `face_value`, and `market_cap`. Treating bhavcopy as the universe is not reasonable. Dhan's scrip master is the right source for tradable instrument availability because charts and live feed depend on Dhan security IDs.

## Data Model

### `dhan_instruments`

Canonical active universe for market-data and chart workflows.

Columns:
- `symbol` primary key
- `isin`
- `company_name`
- `display_name`
- `dhan_security_id`
- `dhan_exchange_segment`
- `instrument`
- `series`
- `lot_size`
- `tick_size`
- `upper_limit`
- `lower_limit`
- `freeze_qty`
- `is_active`
- `last_synced_at`
- `created_at`
- `updated_at`

### `nse_eod_market_caps`

Dated NSE bhavcopy market-cap facts. This is not a universe table.

Columns:
- `trade_date`
- `symbol`
- `series`
- `security_name`
- `category`
- `last_trade_date`
- `face_value`
- `issue_size`
- `close_price`
- `market_cap`
- `source_file`
- `fetched_at`

Primary key: `(trade_date, symbol, series)`.

### `market_universe`

Read model view used by app APIs. It left-joins latest EOD market cap onto active Dhan instruments.

Fields:
- Dhan identity fields from `dhan_instruments`
- latest market-cap fields from `nse_eod_market_caps`
- `market_cap_updated_at`

## Runtime Flow

1. `dhan-instrument-sync` fetches Dhan scrip master and upserts active NSE EQ instruments into `dhan_instruments`.
2. `eod-market-cap` fetches NSE PR bhavcopy, parses only `mcap*.csv`, and inserts dated rows into `nse_eod_market_caps`.
3. Chart, quote, price, annual, worker, and search APIs read `market_universe` or `dhan_instruments`, not `nse_universe`.
4. Dhan candle/live tables reference `dhan_instruments(symbol)`.

## Cleanup

Remove runtime dependence on:
- `nse_universe`
- `refresh-universe`
- `EQUITY_L.csv`
- static `data/nse_universe.json`
- `fetch-market-caps.py`
- `universe-mcap` job naming

Historical docs may still mention old names, but runtime code, tests, current specs/plans, migrations, scripts, package scripts, and Railway config should not.

## Deployment Notes

The expand-and-switch migration must preserve existing production rows by copying current `nse_universe` values into `dhan_instruments` and latest `nse_eod_market_caps` rows while the old production code is still live. Existing `dhan_daily_candles` and `dhan_live_today` foreign keys must be moved from `nse_universe` to `dhan_instruments`. The old table is dropped only after the Dhan/market-universe code is deployed.

## Verification

- `npm test`
- `node --check server.js`
- `node --check dhan_live_feed.mjs`
- `node --check scripts/dhan-instrument-sync.mjs`
- `node --check scripts/eod-market-cap.mjs`
- `rg "nse_universe|NSE Universe|refresh-universe|EQUITY_L|fetch-market-caps|universe-mcap" runtime paths` returns no runtime matches.
- Railway plan shows old `universe-mcap` removed and new `eod-market-cap` added.
