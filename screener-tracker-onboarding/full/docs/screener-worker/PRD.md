# Screener worker — implementation PRD

Current contract: **2.0.0**, replacing the initial strict draft. Sample extraction and section-level QA are complete. The worker itself is not implemented.

## Product scope

Start a run, fetch the active DB company list sequentially, save each company's overview, chart images and financial tables, retry unsuccessful companies once after the first pass, and finish. The frontend always reads stored results through server APIs. Closing the browser does not stop the worker.

No analysis/pros/cons, documents section, authentication, Dhan API calls, scheduled runs, peer comparison, forecasts, or additional dashboards. Quarterly raw filing links are retained with the quarterly table; this does not add a documents workflow. Financial table '+' subrows are not expanded: capture the default visible table shown in the references.

## Locked JSON sections and exact fields

| Section | JSON fields/content | Capture rule |
|---|---|---|
| `source` | url, basis, fetched_at, scraper_name, scraper_version | Record the company page used and the actual fetch time. Basis is consolidated or standalone. |
| `overview` | symbol, company_name, website, nse_symbol, bse_code, logo_url, price_change_percent, price_as_of, market_cap, current_price, high_low, stock_pe, book_value, dividend_yield, roce, roe, face_value, about, key_points | Capture the visible company header, nine top metrics, About and full Key Points text from HTML. Keep values as displayed, including currency/percent units. Missing individual values are null. |
| `chart_snapshots` | Four entries: `1y`, `3y`, `5y`, `max`. Each has range, image, captured_at, source_url, price_label, volume_included. | Save actual images of the rendered Price + Volume chart at each selected period. No fabricated chart or placeholder. |
| `quarterly_results` | basis, unit, periods, rows, filing_links when provided | Preserve all visible periods and rows, their order and displayed values. Each row has label and values aligned to periods. |
| `profit_and_loss` | basis, unit, periods, rows, growth_metrics | Same table structure, including TTM when displayed. Include the four growth cards beneath the table. |
| `balance_sheet` | basis, unit, periods, rows | All visible dates and rows, unchanged. |
| `cash_flows` | basis, unit, periods, rows | All visible dates and rows, unchanged. |
| `ratios` | basis, unit, periods, rows | Capture the company's actual ratio rows. Do not require industrial-company ratios for banks. |
| `shareholding_pattern` | unit, quarterly, yearly | Keep quarterly and yearly tables separate; each has periods and rows. Percentages stay percentages; shareholder counts stay counts. |

`contract_version` is `2.0.0`. The contract fixes section names and table structure, not a universal list of financial row labels or fixed historical years. Blank source cells become null; do not invent values or substitute zero. Zero and negative values stay as shown. Frontend displays null as a dash.

All table values are source display strings or null. This preserves commas, %, decimal precision and even displayed -0 exactly. Numeric calculations are outside this release. Currency figures follow the table's units, usually Rs. Crores; EPS and percentage rows keep their own source labels.

### Source row examples, not universal requirements

| Section | Non-financial company example | Financial-company handling |
|---|---|---|
| Quarterly | Sales; Expenses; Operating Profit; OPM %; Other Income; Interest; Depreciation; Profit before tax; Tax %; Net Profit; EPS in Rs | SBI has Revenue; Interest; Expenses; Financing Profit; Financing Margin %; Other Income; Depreciation; Profit before tax; Tax %; Net Profit; EPS in Rs; Gross NPA %; Net NPA %. Keep those exact labels. Other financial companies can differ. |
| P&L | Quarterly-style financial rows plus Dividend Payout % | SBI has Revenue, Financing Profit and Financing Margin % instead of Sales, Operating Profit and OPM %. Preserve its actual rows. |
| P&L growth cards | Compounded Sales Growth; Compounded Profit Growth; Stock Price CAGR; Return on Equity; preserve periods displayed inside each card | Preserve whichever cards and periods the company page displays; no failure for a missing historical growth value. |
| Balance sheet | Equity Capital; Reserves; Borrowings; Other Liabilities; Total Liabilities; Fixed Assets; CWIP; Investments; Other Assets; Total Assets | Capture actual financial-company labels and any additional rows. |
| Cash flows | Cash from Operating Activity; Cash from Investing Activity; Cash from Financing Activity; Net Cash Flow; Free Cash Flow; CFO/OP | Preserve actual rows without forcing a row checklist. |
| Ratios | Debtor Days; Inventory Days; Days Payable; Cash Conversion Cycle; Working Capital Days; ROCE % | SBI's ratios section contains only ROE %. This is valid. |
| Shareholding | Promoters; FIIs; DIIs; Public; No. of Shareholders | Preserve additional or different holder groups shown by the source. |

## Simple QA: section-level checks

| Section | Pass | Fail |
|---|---|---|
| Overview | Recognizable company overview and populated metric grid captured | Wrong company, absent overview, or empty metric grid |
| Chart snapshots | Four readable images, correct 1/3/5/Max selections, chart contains plotted data | A required range is missing, blank, still loading, or captured with the wrong selection |
| Quarterly, P&L, balance sheet, cash flows, ratios | Each section contains dates, actual financial rows and usable values | Section absent, table empty, or parse produces no usable values |
| Shareholding | Quarterly and yearly tables are captured separately with usable data | Section missing, empty, or the two period lists incorrectly merged |

Do not inspect every individual field or reject the company because a cell is blank, a metric is unavailable, or a company's row labels differ. Keep the complete source table rather than quietly dropping unavailable cells. Do not require a fixed number of years: a shorter listing history can pass. Section-level checks catch failed extraction; they do not certify every financial fact as independently accurate.

If a source section itself is genuinely unavailable, keep its failure explicit for manual review; do not invent an empty section and call it complete. Do not fall back solely because a cell is null. Fallback is for an unusable consolidated view or missing essential tables, not to rewrite a valid company's accounting basis.

## How the sample was captured

- `LAURUSLABS.sample.json` is a real consolidated company response in the current structure.
- The nine top metrics, header, About and Key Points are taken from the same saved company HTML.
- screener-scraper-pro **1.0.0** remains the required financial scraper. Its object is converted into the locked shape. Source HTML supplements its limitations: preserve blank cells and quarterly PDF links; separate the two shareholding tables.
- The package does not return chart images. A browser loads the same company's page, selects 1Yr, 3Yr, 5Yr and Max, waits for plotted data, and saves the chart area. Screener's own chart requests are part of loading that page; no Dhan API is used.
- Live capture selected each range and confirmed chart datasets before capture. All four PNGs exist and differ. The 1-year chart was visually checked.
- `SBIN.financial-table-example.json` demonstrates real bank quarterly/P&L/ratio rows. It is table-shape evidence, not a full bank company fetch.
- Current LAURUSLABS sample: **PASS under section-level QA**. The prior field-by-field failures no longer block legitimate blank cells. The old strict contract is replaced, not silently retained.

## Start to finish: exact implementation flow

| No. | Trigger/action | Server/worker action | Database write | Frontend result |
|---|---|---|---|---|
| 1 | Click Start | `POST /api/screener/runs` checks for an unfinished run. Return it if present. | None for duplicate Start. | Start response supplies run ID, status and total. |
| 2 | Create new run | Read active stocks from `dhan_instruments`, trim symbols and remove duplicates. Freeze the list; show an error if empty. | Save one run plus all company items together. If saving fails, create no partial run. | Display the fixed total and start polling. |
| 3 | Worker begins | Pick one pending company. Process one company at a time. | Item becomes Fetching with start time. | Current symbol appears from DB progress. |
| 4 | Fetch financial data | Use scraper 1.0.0, consolidated first. If consolidated view is unusable, use standalone. A fallback is part of the same company attempt. | None yet. | Polling continues; no frontend scraping. |
| 5 | Capture charts | Open that company's page in one reusable background browser; capture 1/3/5/Max Price + Volume charts. Each must finish loading. | Upload four images to Supabase Storage, under run/company/range paths. | No new result displayed before final save. |
| 6 | Build JSON and check sections | Create v2 JSON with overview, image references and exact financial tables. Apply only section-level QA. | None yet. | Not marked successful until saved. |
| 7 | Save success | Save JSON plus successful outcome together. | Insert/update latest company data; item Successful; completed_attempts +1; completion time. | Next poll increases Successful and Processed. Company detail reads stored JSON/image references. |
| 8 | Record failure | Save section error and draft JSON if available. | Item Awaiting retry, completed_attempts =1, last_attempt_json and error. Previous successful company data remains. | Show awaiting retry, without increasing finally Processed. |
| 9 | Finish first pass | After every first attempt has an outcome, switch to retry pass. | Run pass becomes Retry. | First pass attempts N/N; show retry workload. |
| 10 | Retry once | Process only Awaiting retry companies through the same steps. | Successful, or Failed with attempts =2 and manual-review error. No new company item. | Update retry and final counts. |
| 11 | Complete batch | Every company is Successful or finally Failed. | Run Completed or Completed with failures; finish time. | Processed N/N, success/failure totals, failure list. |
| 12 | Later Start | Read and freeze the current full universe again. | New run and items; overwrite latest data only after new success. | Show counts belonging to the new run. |

Cadence: two seconds between companies and between Screener data/chart requests within an attempt; static browser assets are not company fetch attempts. Never process companies in parallel. Reuse one browser/page instead of launching one per chart. Apply a 45-second timeout to a data request or chart load. Rate-limit responses pause requests using the server's retry instruction, or 60 seconds if none is supplied. No timed retry queues.

The company JSON stores image references, not image bytes. Use one Supabase Storage bucket for chart files; this avoids swelling the JSON table. Use new run paths so failed refreshes cannot overwrite the previous successful snapshots. The frontend gets image references from saved DB company data, not live Screener pages.

## Three application tables

| Table | One row | Fields | When written |
|---|---|---|---|
| `screener_runs` | One fixed batch | id, status, pass, total_companies, started_at, finished_at | Created by Start; updated at pass change and completion. |
| `screener_run_items` | One company in a batch | run_id, symbol, company_name, status, completed_attempts, started_at, completed_at, error, last_attempt_json | All created as Pending with zero attempts at Start; updated before fetching and after each outcome. Unique run_id + symbol. |
| `screener_company_data` | Latest successful company JSON | symbol, contract_version, source_url, basis, fetched_at, run_id, data_json | Insert/replace only after section QA and image capture pass. Unique symbol. |

Save successful company data and its successful item status together. If the DB cannot save, pause the worker instead of increasing progress or moving to an unrecorded company. Failed draft JSON belongs to its run item; never overwrite a previously good company response with it.

## APIs and frontend reads

| API | Purpose | Source |
|---|---|---|
| `POST /api/screener/runs` | Start; 202 new run, 200 existing unfinished run | DB universe and runs |
| `GET /api/screener/runs/current` | Run, pass, current symbol and counts | DB run/items |
| `GET /api/screener/runs/:id/items` | Company outcomes and failure reasons, paged | DB items |
| `GET /api/screener/companies/:symbol` | Overview, chart references and all saved tables | DB company JSON |

**Frontend Start -> server API -> DB creates run/items -> worker fetches and captures charts -> builds JSON -> section QA -> DB saves result/status -> read API reads DB -> frontend displays stored result.**

Frontend polls every two seconds. Processed = Successful + final Failed for this run. First-pass attempt count and retry-pass attempt count are displayed separately so awaiting retries do not obscure activity or inflate completed-company counts.

## Restart and completion

Use one worker in one Railway application instance. Resume its saved unfinished run and pass after restart. A company left Fetching is processed again in the same unfinished attempt; completed_attempts increases only after an outcome is saved. Skip successful items. Do not create a new batch on restart.

## Execution order

| Order | Deliverable | Acceptance |
|---|---|---|
| 1 | Lock v2 JSON and real chart sample | Completed: real sample passes section QA; bank labels verified. |
| 2 | Create three tables and chart bucket | Run/item uniqueness; complete batch creation; image references readable. |
| 3 | Implement Start and one worker | Duplicate Start returns one run; full first pass followed by one retry pass; two-second cadence. |
| 4 | Implement DB read APIs and Workers screen | Correct counts; current company; stored company inspection with four images and tables. |
| 5 | Verify full flow | Missing section fails; blank cells pass; bank rows pass; failed saves never count as success; restart resumes; final N/N. |
| 6 | Deploy and controlled run | Small real batch first, verify DB JSON/images/frontend, then enable full-universe Start. No automatic full scrape during deployment. |

## Playwright-only dry-run recommendation

A new TCS company was collected entirely through Playwright, without the scraper package. See `dry-runs/TCS/REPORT.md`, JSON, and four chart images. Collection passed section-level checks. The current locked v2 metadata still expects the old package, so a collector-metadata revision is required before adopting this as the worker's official JSON.

Recommended implementation: Node.js/JavaScript on the existing Express/Railway stack, with Playwright controlling a local Chromium browser. No Python script or paid Playwright API is needed. One reusable browser collects both tables and images. The worker remains DB-driven and the frontend reads only saved DB results.

This recommendation would replace the package-specific extraction steps in this PRD after the collector choice is confirmed. It is not an additional scraping path. The existing table and chart data shape remains valid; new metadata must identify the actual collector.
