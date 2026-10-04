# Screener worker — implementation PRD

Status: JSON contract v1 locked for review; worker not implemented.

## What this release does

Click Start, read active stocks from the database, fetch every company sequentially, retry failed companies once after the first pass, and finish. The browser reads saved database data through the server. Closing the browser does not stop the run. No authentication, Dhan requests, scheduled jobs, or parallel company fetching.

## Step 1 completed: real draft and JSON contract

A live consolidated LAURUSLABS page was fetched with screener-scraper-pro 1.0.0. See `LAURUSLABS.sample.json`, `company.schema.v1.json`, and `LAURUSLABS.validation.json`. The untouched package response and fetch metadata are also retained.

The package already returns a JavaScript object. Convert it to the locked JSON structure and serialize it; do not use AI to infer values. Company overview and top metrics are extracted from the same HTML because the package omits them. Shareholding quarterly and yearly tables are separated because version 1.0.0 merges their headers incorrectly. No second network request is needed for these corrections.

All contract fields and required data points are mandatory. Missing, null, blank, malformed percentage, or absent required table cell means failure. Zero and negative financial values are valid. No invented defaults, no replacement with zero, and no silent removal of missing values. Arrays must contain data under this strict policy.

The live sample FAILS: 78 validation findings at 60 distinct data locations. Examples: Stock Price CAGR / 10 Years is `%`; announcement descriptions and annual-report sources are blank; some concalls lack transcript/PPT/recording links; TTM tax and dividend payout cells are absent. This result is preserved, not labeled successful. Some gaps may be source-unavailable rather than scraper errors. Retrying cannot guarantee those values appear.

The JSON structure is locked as version 1.0.0, not the company values, dates, number of years, or number of documents. Financial row labels come from each company page, rather than forcing an industrial company's Sales row onto a bank. Every row and period shown in the source table must be captured; the worker must compare source row labels and periods to JSON before success. A deleted row must fail even if other rows remain. Listed document counts and links must also match the source; a missing document must fail.

Scope: full data exposed by version 1.0.0 plus company overview, key points and the nine top metrics. Financial values retain the page's units (usually Rs crore), percentages retain `%`, periods retain source labels. It does not include interactive chart prices, asynchronously loaded peer comparisons, expanded financial subrows, or downloaded PDF contents. These are not returned by the package and are not claimed as captured. Document metadata and links are captured.

Before implementing the worker, resolve the failed sample through extraction corrections or an explicitly agreed contract change. Do not weaken validation automatically. No live sample has passed strict v1 yet.

## Locked JSON contents

| Area | Required content |
|---|---|
| Version | `contract_version: 1.0.0` |
| Company | Symbol, name, about, key points, nine top metrics |
| Source | Exact company URL, consolidated/standalone basis, fetch time, scraper name and version |
| Analysis | Pros and cons |
| Financials | Quarters, profitLoss, balanceSheet, cashFlow, ratios; each has headers and row values |
| Shareholding | Separate quarterly and yearly headers and row values |
| Documents | Announcements, annualReports, creditRatings, concalls and their required metadata/links |
| Growth | Compounded Sales Growth, Compounded Profit Growth, Stock Price CAGR, Return on Equity with the periods specified in schema v1 |

## Exact flow: Start to finish

| Step | Action | Server/worker behavior | Database change | Frontend behavior |
|---|---|---|---|---|
| 1 | User clicks Start | `POST /api/screener/runs` checks for an unfinished run. | None if one exists. | Disable repeated clicks while the response is pending. |
| 2 | No unfinished run exists | Read all active symbols from `dhan_instruments`, trim and deduplicate, freeze the list. Reject an empty list with a clear message. | In one save, create one run and all its company items. If any item cannot be created, create no run. | Receive run ID and fixed total; Start response does not contain scraped data. |
| 3 | Start accepted | Return 202 for a new run, 200 for the existing run. One background worker begins/resumes work. | Run: Running, First pass. | Poll `GET /api/screener/runs/current` every two seconds. |
| 4 | Pick a company | Select the next pending symbol. | Item: Fetching; record start time. | Show Currently fetching: SYMBOL. |
| 5 | Fetch | Call the package on the consolidated company page. If unusable or incomplete, try standalone. Keep two seconds between actual requests, including fallback. A company attempt finishes after this consolidated/fallback sequence. | None yet. | Continue reading stored progress; no browser scraping. |
| 6 | Build and validate JSON | Apply the locked structure, preserve all data, validate required fields and source coverage. A request taking over 45 seconds fails. | None yet. | No company result is shown as successful yet. |
| 7 | Valid result | Save the entire JSON and mark success together. | Insert/update company data; item Successful; completed attempts +1; completion time. | On next poll, show success. Company inspection reads the stored JSON. |
| 8 | Failed first attempt | Save returned draft JSON if available, missing-field paths/error, and attempt result. | Item Awaiting retry; completed attempts =1. Preserve older valid company data. | Show awaiting retry; do not count as finally processed. |
| 9 | End first pass | All companies have completed their first attempt. Change pass. | Run: Retry pass. | Show first-pass attempts N/N and retry workload. |
| 10 | Retry once | Process only Awaiting retry items using the identical fetch/validation/save flow. | Success follows step 7; another failure becomes Failed, attempts =2, manual review reason. | Show retry progress separately. No duplicate company entries. |
| 11 | Finish | Every company is Successful or Failed. | Run Completed or Completed with failures; finish time. | Processed N/N; successful and final-failed counts; failure list. |
| 12 | Start again later | Snapshot the current active universe for a new full refresh. | New run and company items. Latest valid data updates only when a new fetch passes. | Show the new run's progress, never historical totals. |

If Screener sends a rate-limit response, pause requests according to its retry instruction or a simple 60-second pause if none is supplied. Keep it visible in the run status; do not create an extra retry system.

## Three tables and when entries are made

| Table | One row represents | Fields | Written when |
|---|---|---|---|
| `screener_runs` | One fixed batch | id, status, pass, total_companies, started_at, finished_at | Created by Start; pass updated after first pass; status and finish time updated after all outcomes are final. |
| `screener_run_items` | One company in one batch | run_id, symbol, company_name, status, completed_attempts, started_at, completed_at, error, validation_errors, last_attempt_json | All inserted at Start as Pending with zero attempts; updated before fetching and after each completed attempt. Failed draft JSON lives here, not in successful company data. Unique run_id + symbol. |
| `screener_company_data` | Latest valid response for a company | symbol, contract_version, source_url, basis, fetched_at, run_id, data_json | Inserted or replaced only after strict validation passes. Unique symbol. Never overwritten by a failed result. |

The successful JSON and the successful item status must be saved together. Failure to save must not produce a success count. If the DB cannot save, pause the worker rather than proceeding with unrecorded outcomes.

## APIs and data display

| Call | Purpose | Data source |
|---|---|---|
| `POST /api/screener/runs` | Start or return unfinished run | DB stock universe and saved run |
| `GET /api/screener/runs/current` | Current/latest run, pass, progress, current company | DB run and item rows |
| `GET /api/screener/runs/:id/items` | Company outcomes and failure details, paged | DB item rows |
| `GET /api/screener/companies/:symbol` | Show latest successful JSON, source and fetch time | DB company data; never triggers a fetch |

Frontend -> Start API -> DB creates run/items -> worker fetches Screener -> builds/validates JSON -> DB stores result/status -> read APIs query DB -> frontend displays DB result.

Processed = Successful + final Failed for the selected run. Awaiting retry and Fetching do not increase this count. Also display First pass attempts / total and Retry pass attempts / retry total so the user sees activity even while final outcomes are pending.

## Restart behavior

Use one worker and one Railway app instance. On restart, resume the saved unfinished run and its saved pass. A Fetching item left by an interrupted process is fetched again in the same unfinished attempt; completed_attempts increases only after an outcome is saved. This prevents a restart from using up retries or skipping a company. Already successful items are skipped. No new batch is created automatically.

## Implementation order and acceptance

| Order | Deliverable | Must be verified before proceeding |
|---|---|---|
| 1 | Draft JSON, schema, failure report | Real sample captured; missing values rejected; no fabricated successful sample. Completed, sample currently fails strict v1. |
| 2 | Resolve strict completeness | Correct extraction and rerun sample; explicit rule decision for source-unavailable values. |
| 3 | Three DB tables and Start API | Fixed list, deduplication, empty-list message, duplicate Start returns one run. |
| 4 | One worker with two passes | Two-second request gaps, consolidated/standalone handling, timeout, valid-save/failure-save behavior. |
| 5 | Progress and inspection APIs/UI | Counts belong to current run; all display data read from DB; failed JSON inspectable. |
| 6 | Restart and final completion checks | No lost outcomes, one retry per failed company, terminal N/N, previous good data retained after failed refresh. |
| 7 | Railway release | Controlled small batch first, verify stored JSON and progress, then make full-universe Start available. No automatic full run during deployment. |

No scheduling, authentication, additional queues, or unrelated dashboards in this release.
