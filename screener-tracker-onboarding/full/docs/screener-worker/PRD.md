# Screener worker — phase 1

Click Start → freeze the DB company list → fetch each company → save JSON and charts → retry failures once → finish. Company data display is a separate future flow.

## Scope and technology

Express API and one background Node.js worker in the existing Railway service. Playwright 1.61.0 controls Chromium directly; no Python, paid browser API, scraper package, schedule, authentication or Codex skill. One Railway instance. The worker continues when the browser tab closes.

Use the existing `dhan_instruments` table: active companies, uppercase trimmed unique symbols. No Dhan API calls. A normal Start covers the full active list. Companies added later wait for the next batch.

## Exact execution flow

| No. | Action | What runs | What is saved |
|---|---|---|---|
| 1 | Click Start | Workers screen disables Start and calls `POST /api/screener/runs` with `{}`. | Nothing yet. |
| 2 | Freeze company list | Server reads active DB companies and deduplicates symbols. | In one transaction: one `screener_runs` row with status Running, pass First, fixed total; one Pending item per company with attempts 0. An empty universe returns an error. |
| 3 | Return immediately | API returns 202 with batch ID and total. Server starts its background worker. | Worker uses the saved items; it does not re-read the universe mid-run. |
| 4 | Pick one company | Worker marks item Fetching, then opens its Screener page. Consolidated first; standalone only if consolidated overview/tables are unusable. | Item status and updated time. |
| 5 | Read source data | Read overview and all default visible financial table rows, dates and values. Select 1Yr, 3Yr, 5Yr, Max; wait for rendered price and volume, then take chart PNGs. | Nothing to company-data table yet. |
| 6 | Build and check JSON | Apply contract v3 and section checks. Missing/empty sections fail. Legitimate blank cells and different bank rows pass. | Four validated chart PNGs uploaded to Supabase Storage under batch/company/range paths. JSON receives public image URLs. |
| 7 | Save success | Save full JSON and company outcome together. | Transaction updates `screener_company_data`, marks item Successful, adds one completed attempt. Processed and Successful each increase once. |
| 8 | Save first failure | Record fetch, chart, validation or upload error. | Item Awaiting retry, attempts 1. Previous successful company JSON remains. Processed does not increase yet. |
| 9 | Finish first pass | Visit every Pending company before retries. | Run pass changes to Retry. |
| 10 | Retry failures once | Fetch only Awaiting retry companies again through the same steps. | Successful or Failed, attempts 2. Each final outcome increases Processed once. Failed items keep their error for manual review. |
| 11 | Finish | Check every item has a final outcome. | Run Completed or Completed with failures, finish time. Processed equals total. |
| 12 | Read progress | Minimal Workers screen polls `GET /api/screener/runs/current` every 2 seconds. | Reads only run/item state from DB; no frontend scraping or company-display flow. |
| 13 | Railway restarts | At server startup, mark any Running batch Not completed. Do not resume or fetch automatically. | Run status, finish time and interruption reason. Pending/Fetching items remain evidence of incomplete work. |
| 14 | Manual Start again | Create a new batch from the current full DB universe. | New run/items. Previous good data is replaced only after a successful new fetch. |

Start stays disabled while Running. The API also returns 409 for accidental duplicate requests; a database constraint prevents two Running batches. This is a simple safeguard for multiple tabs, not a queue.

Two seconds between companies and between Screener data requests; page reading, screenshots and storage take additional time. Static images/scripts are not throttled. Respect HTTP 429 `Retry-After`, or a 60-second cooldown. There are no delayed retry jobs: retries happen only in the second pass. Navigation limit is 60 seconds; page/chart readiness is 45 seconds. DB errors stop the batch as Not completed rather than inventing progress.

## Tables and entries

| Table | Fields | Entry / update |
|---|---|---|
| `screener_runs` | id, status, pass, total, started_at, finished_at, error | Insert at Start; update pass, completion or interruption. |
| `screener_run_items` | run_id, symbol, company_name, status, attempts, error, updated_at | Insert all at Start. Update Fetching before each attempt, then outcome. Attempts count completed attempts, maximum two. Unique run + symbol. |
| `screener_company_data` | symbol, data, updated_at, run_id, source_url, basis | One latest successful full JSON per symbol. Insert/update in the same transaction as Successful item. Failed attempts never overwrite it. |

RLS protects all three tables. No public database writes. Database connection and Supabase service key stay on Railway. Public chart bucket `screener-charts` contains only screenshots of public company data. Images live in Storage, not as binary data inside JSON. Interrupted/failed uploads may leave unused images; cleanup is deferred.

## Locked company JSON v3

Canonical schema: `company.schema.v3.json`. Historical v2 samples remain extraction evidence, not the runtime contract. Version 3 changes collector metadata to Playwright and requires all defined overview keys and chart metadata keys to exist; individual unavailable values remain null.

| Section | Exact fields / content |
|---|---|
| Root | contract_version, source, overview, chart_snapshots, quarterly_results, profit_and_loss, balance_sheet, cash_flows, ratios, shareholding_pattern |
| source | url, basis, fetched_at, scraper_name=`playwright`, scraper_version=`1.61.0` |
| overview | symbol, company_name, website, nse_symbol, bse_code, logo_url, price_change_percent, price_as_of, market_cap, current_price, high_low, stock_pe, book_value, dividend_yield, roce, roe, face_value, about, key_points |
| chart_snapshots | `1y`, `3y`, `5y`, `max`; each: range, image, captured_at, source_url, price_label, volume_included |
| quarterly_results | basis, unit, periods, rows; filing_links if shown |
| profit_and_loss | basis, unit, periods, rows, growth_metrics |
| balance_sheet / cash_flows / ratios | basis, unit, periods, rows |
| shareholding_pattern | unit, quarterly, yearly; each table: basis, unit, periods, rows |
| Every table row | label, values aligned exactly to periods; source display strings or null |
| growth_metrics | Source card labels mapped to source period labels and display values/null |

Capture all default visible rows and periods; do not expand `+` rows or calculate new ratios. Preserve commas, percentages, negative values, precision and TTM exactly. Do not force Sales/Operating Profit on a bank: preserve Revenue/Financing Profit and whatever rows Screener shows. Both quarterly and yearly shareholding tables stay separate. About and Key Points are text from source HTML. No analysis, peers or documents section.

QA checks recognizable company identity and populated overview, dates/rows/usable values in every required financial/shareholding section, aligned table columns and four loaded price/volume chart images. It does not require each cell to be populated or a fixed historical year count. A genuinely unavailable required section is a failed company for manual review.

## API and UI

| API | Result |
|---|---|
| `POST /api/screener/runs` | 202 new batch; 409 already running; 400 invalid or empty active list. Optional `symbols` array (maximum 20) supports controlled QA only; every symbol must exist in the active DB universe. Normal UI sends `{}`. |
| `GET /api/screener/runs/current` | Latest batch, universe total, pass, current company, processed, successful, final failed, awaiting retry, times, error and failure list. All from DB. |

Minimal Workers page follows the reference HTML’s colours, type, borders, collapsible left rail and bottom drawer. Start, status, progress, counts, current company, times and failure reasons only. No company-result display endpoints or dashboard added.

## Verification and release

Run unit/API tests, local browser QA, real controlled batch including a bank, and DB checks for duplicate Start, retry exhaustion, saved images/JSON, preserved good data and restart marking. Deploy one Docker-based Railway instance with the matching Playwright Chromium image. Deployment does not start a full scrape. After controlled live QA, full-universe Start is ready for manual use.
