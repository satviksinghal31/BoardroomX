# Advanced Screener Ingestion Design

## Goal

Integrate the supplied Python Screener scraper into BoardroomX through three independently testable and deployable milestones: a robust single-ticker scraper, a resumable bulk ingestion worker, and a God Mode manual-refresh experience with progress reporting. Capture every requested Screener section while deferring automated quarterly refresh scheduling.

## Scope and Priorities

The implementation is intentionally limited to the highest-impact changes:

1. Prove that one ticker can be scraped reliably before adding bulk behavior.
2. Store every parsed section without losing fields when Screener changes its page.
3. Add a sequential, resumable bulk run with a configurable delay and visible progress.
4. Expose one manual full-universe refresh action in God Mode.
5. Deploy and verify each milestone before beginning the next one.

The following are out of scope:

- replacing existing DB-backed APIs;
- broad refactors of the Node server or unrelated cron jobs;
- one dedicated SQL table for every nested field;
- parallel Screener requests or an unbounded high-throughput scraper;
- historical retention of every unchanged full-page snapshot.
- automatic quarterly refresh cadence or announcement-driven refresh triggers;
- multiple concurrent scraper workers;
- redesigning God Mode beyond the minimum refresh control and progress panel.

## Delivery Milestones

### Milestone 1: Single-ticker scraper

Build and deploy the scraper library and single-ticker CLI first. It must fetch all available sections for one company, return a stable versioned result, and report partial section failures without disguising them as success.

Verification uses saved HTML fixtures plus a small live sample drawn from the BoardroomX universe. The sample should include a standard industrial company such as `TDPOWERSYS`, a large-cap, a bank or NBFC, a recent listing, and a small/mid-cap. A live test is successful only when annual P&L is present and each optional section is either populated or explicitly marked unavailable/failed.

Deployment for this milestone is a Railway-compatible command that can run a single ticker as a one-off task. No bulk queue or UI is required yet.

### Milestone 2: Bulk ingestion and persistence

After Milestone 1 is verified in production, add Supabase persistence and a background bulk runner. A manual run creates a durable run record and a queue containing the selected universe. One worker processes symbols sequentially; the request that starts the run returns immediately and does not remain open for hours.

The inter-company delay is configurable, with two seconds as the initial production default. The worker honors `Retry-After`, slows down after `429` or temporary server errors, and never runs symbols in parallel. At roughly 2,100 symbols, network and parsing time—not just the configured delay—will determine total duration; a practical target is completion within approximately two to four hours, subject to Screener response times and backoff.

The run is resumable after a Railway restart because claimed, completed, retry, and failed symbols are stored in Supabase. Re-running an interrupted job continues pending work rather than starting from zero. This milestone also adds status APIs that return total, pending, running, completed, partial, failed, elapsed time, and the current symbol.

Deploy and verify the worker using a small batch, then a larger controlled batch, before attempting the full universe.

### Milestone 3: God Mode manual refresh

Add one minimal God Mode panel with a `Refresh Screener Data` action. Clicking it creates a full-universe bulk run unless another run is active. The UI polls the status API and displays a progressive loader with counts, percentage, current symbol, elapsed time, and failures. It must be safe to close the browser; the Railway worker continues independently.

The first version always fetches the full requested payload, including quarterly and annual sections. Automatic quarterly refresh frequency is a later decision and is not part of these milestones.

## Architecture

### Python scraper library

Add a focused Python module under `scripts/screener_scraper/` with a stable public API:

```python
from screener_scraper import ScreenerScraper, ScraperConfig

with ScreenerScraper() as scraper:
    company = scraper.scrape_company("TDPOWERSYS")
    pnl = scraper.scrape_section("TDPOWERSYS", "pnl")
```

The package owns HTTP sessions, authentication, request retries, HTML parsing, section aliases, ticker validation, and CAGR calculation. It must not know about Supabase or Railway.

The scraper returns one versioned dictionary containing:

- summary and ratio box values with original labels and canonical snake-case keys;
- pros and cons;
- peer headers, rows, and footer;
- quarterly results;
- profit and loss, balance sheet, cash flow, and ratio histories;
- growth ranges;
- quarterly and yearly shareholding;
- annual reports, ratings, concalls, and announcements with absolute URLs;
- wiki commentary when authenticated;
- per-section parse status and errors;
- source URL, statement type, parser version, and UTC fetch timestamp.

### CLI

Add a thin CLI entry point supporting the requested single-ticker, batch, statement, output-directory, delay, credentials, section-filtering, and verbosity flags. Single-ticker mode is completed and deployed in Milestone 1; batch mode is enabled in Milestone 2.

Batch input uses Python's CSV parser rather than splitting on commas. Duplicate and invalid tickers are reported explicitly. Results are written atomically so interruption cannot leave a valid-looking truncated JSON file. The summary records successes, partial successes, failures, duration, and output path.

The CLI remains useful without a database. Local JSON output is an export/debugging feature, not the BoardroomX application source of truth.

### Persistence adapter

Add a separate Supabase persistence adapter in Milestone 2. It receives a scraper result and performs idempotent upserts.

Existing typed tables remain authoritative for queryable annual data:

- `annual_fundamentals`;
- `annual_ratios`;
- `annual_balance_sheet`;
- `annual_cash_flows`;
- `shareholding_pattern`.

Add one compact latest-snapshot table keyed by `symbol + statement_type`. It stores:

- summary identity fields useful for inspection;
- `full_payload` JSONB containing every parsed section and unrecognized field;
- `section_status` JSONB;
- parser version, source URL, content hash, and timestamps.

This hybrid model keeps important financial fields typed while guaranteeing that peers, documents, commentary, analysis, growth ranges, and future fields are not discarded. A new snapshot replaces the previous latest snapshot only after the required annual P&L section parses successfully. Partial optional-section failures are retained in status metadata and do not erase the previous good values for those sections.

Documents are stored in the lossless payload with absolute URLs. Dedicated document, peer, or commentary tables are deferred until a concrete query or UI requires them.

### Railway bulk worker

Replace the external scraper dependency in the existing annual worker path with the Python library and persistence adapter. A manually started bulk run is drained by one sequential worker process so a full universe can finish within hours rather than days.

The worker retains the useful parts of the existing BoardroomX queue contract:

- seed missing active `market_universe` symbols;
- acquire a Postgres advisory lock so only one bulk worker runs;
- claim one eligible `pending` or `retry` symbol at a time;
- scrape consolidated statements first;
- fall back to standalone only when consolidated annual P&L is unavailable;
- validate and persist the result;
- update queue and run-log status;
- wait for the configured delay and claim the next eligible symbol;
- exit when the run has no eligible symbols or receives a termination signal.

There is no automatic schedule in this phase and no parallel fetching. God Mode starts the durable run; Railway hosts the sequential worker. Complete symbols are refreshed only when a new manual run explicitly includes them. Scheduled or higher-frequency quarterly refreshes are deferred.

## Data Integrity

The required success condition is at least one annual P&L period. Optional section failures produce `partial` section status but do not turn usable historical financial data into a total failure.

All timestamps are timezone-aware UTC ISO 8601 values. Numeric parsing handles commas, percentages, currency symbols, parenthesized negatives, missing values, and text values without converting unrelated text to zero.

Upserts are keyed by symbol and period. A failed refresh never deletes older good rows. The stored full payload includes a deterministic content hash so unchanged content does not cause unnecessary rewrites.

`compute_cagr(values, years)` uses the first and last observations of the requested trailing window, rejects non-positive starting values, and documents that `years` requires `years + 1` observations. This preserves the requested decimal return format, such as `0.12` for 12%.

## HTTP and Authentication

Use one `requests.Session` with bounded timeouts, retry handling for temporary failures, `Retry-After` support, and a descriptive user agent. HTTP failures raise typed exceptions rather than returning ambiguous `None` values.

Credentials come from arguments or `SCREENER_USER` and `SCREENER_PASS`. Secrets are never logged or written to output. Login failure is explicit when a user requested authenticated content; anonymous scraping remains supported when no credentials were supplied.

Wiki commentary is attempted only for authenticated sessions. A missing gated section is represented as unavailable, not as an empty successful value.

## Testing

Tests are fixture-driven and do not depend on Screener availability. Sanitized HTML fixtures cover:

- a standard industrial company;
- consolidated-to-standalone fallback;
- a bank/NBFC label variant;
- a recent listing with short history;
- missing optional sections;
- documents with relative URLs;
- quarterly and yearly shareholding classification;
- login-gated commentary responses;
- malformed or changed tables;
- CSV batch input and CAGR edge cases.

Persistence tests use a fake adapter or transaction-isolated database boundary to verify idempotent upserts, no overwrite on failed refresh, queue transitions, resumption after interruption, and single-worker sequential behavior.

An opt-in live smoke command fetches `TDPOWERSYS`. It is not part of the default automated test suite because network state and Screener HTML can change independently of the code.

## Deliverables

1. Reusable `ScreenerScraper` and `ScraperConfig` Python package.
2. Single-ticker and batch CLI with the requested flags and JSON exports.
3. Lossless, versioned result contract covering all requested sections.
4. Supabase migration for the latest full-payload snapshot, bulk runs, queue items, and progress metadata.
5. Persistence adapter that fills both existing typed financial tables and the full JSONB snapshot.
6. Railway bulk worker with configurable delay, locking, retries, resumption, and run logs.
7. Status/start APIs plus a minimal God Mode manual-refresh control and progressive loader.
8. Fixture-based unit and integration tests plus an optional live verification command.
9. Milestone-specific deployment and verification instructions.

## Acceptance Criteria

- The library examples in the request work without importing BoardroomX internals.
- A `TDPOWERSYS` scrape returns every available requested section and typed annual periods.
- Every returned field is present in the stored full payload after persistence.
- Existing annual tables receive idempotent normalized rows.
- A missing optional section is visible as partial status and does not delete older good data.
- Only one production worker is active, and it processes symbols sequentially with the configured delay.
- An interrupted bulk run resumes from durable queue state.
- God Mode can start a run and display accurate progress without holding the original HTTP request open.
- Each milestone is deployable and verifiable without requiring the following milestone.
- Default automated tests run without network access.
- Existing Node tests continue to pass after the worker and status API integration changes.
