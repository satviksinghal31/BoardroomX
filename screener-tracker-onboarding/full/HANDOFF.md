# BoardroomX Handoff

> Generated: 2026-06-20

## Current Direction

BoardroomX now treats Dhan scrip master as the source of truth for the tradable equity universe.

- `dhan_instruments`: canonical active instrument universe.
- `nse_eod_market_caps`: dated NSE EOD market-cap facts from bhavcopy.
- `market_universe`: read view joining active Dhan instruments with the latest market-cap row.

NSE bhavcopy is retained only as an EOD fact source. It is not the universe.

## Runtime Jobs

| Job | Schedule | Command | Target |
|---|---:|---|---|
| `events-cron` | 08:00 + 20:00 IST | `npm run cron:events` | `nse_events` |
| `eod-market-cap` | 18:30 IST | `npm run cron:eod-market-cap` | `nse_eod_market_caps` |
| `dhan-instrument-sync` | 07:30 IST | `npm run cron:dhan-instrument-sync` | `dhan_instruments` |
| `dhan-eod-update` | 16:00 IST | `npm run cron:dhan-eod-update` | `dhan_daily_candles` |

## Important Files

| File | Purpose |
|---|---|
| `migrations/011_market_sources.sql` | Fresh-install Dhan universe and EOD market-cap schema |
| `migrations/016_dhan_market_data.sql` | Dhan daily/live/auth tables keyed to `dhan_instruments` |
| `migrations/017_dhan_universe_eod_market_caps.sql` | Existing-prod transition into new schema while keeping legacy reads safe |
| `migrations/018_drop_legacy_nse_universe.sql` | Final cleanup after the Dhan/market-universe code is deployed |
| `scripts/dhan-instrument-sync.mjs` | Dhan scrip master sync |
| `scripts/eod-market-cap.mjs` | Latest bhavcopy market-cap ingestion |
| `dhan_market_data.js` | Chart, price, quote, health reads |
| `server.js` | Express APIs, including `/api/universe` and annual endpoints |

## Notes For Fresh Agents

- Do not reintroduce NSE/company-master universe ownership.
- Use `market_universe` for app/search/annual reads that need company name plus market cap.
- Use `dhan_instruments` for Dhan security IDs and write-side instrument sync.
- Sector is not provided by Dhan or NSE bhavcopy; keep sector enrichment separate through `stocks.sector` / Screener paths.
- Market cap is calculated by NSE EOD data from close price and issue size; it is not live intraday market cap.

## Verification

Run:

```bash
npm test
node --test tests/eod-market-cap.test.mjs tests/dhan-jobs.test.mjs tests/dhan-routes.test.mjs tests/dhan-worker.test.mjs tests/run-cron.test.mjs
npm run repomap
```
