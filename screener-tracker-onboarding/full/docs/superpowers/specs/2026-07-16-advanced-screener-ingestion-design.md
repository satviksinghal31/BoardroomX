# Advanced Screener Ingestion Design

## Goal

Integrate the supplied Python Screener scraper into BoardroomX as a reusable library, command-line tool, and Railway-ready bulk worker. Capture every requested Screener section without expanding the project into unrelated UI or platform work.

## Scope and Priorities

The implementation is intentionally limited to the highest-impact changes:

1. Make parsing reliable enough for repeated unattended use.
2. Store every parsed section without losing fields when Screener changes its page.
3. Preserve the existing typed annual-financial tables used by BoardroomX.
4. Add a polite, resumable, one-symbol Railway worker for bulk ingestion.
5. Add fixture-driven tests that detect parser drift before deployment.

The following are out of scope:

- new frontend screens or redesigns;
- replacing existing DB-backed APIs;
- broad refactors of the Node server or unrelated cron jobs;
- one dedicated SQL table for every nested field;
- parallel Screener requests or a long-running high-throughput scraper;
- historical retention of every unchanged full-page snapshot.

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

Add a thin CLI entry point supporting the requested single-ticker, batch, statement, output-directory, delay, credentials, section-filtering, and verbosity flags.

Batch input uses Python's CSV parser rather than splitting on commas. Duplicate and invalid tickers are reported explicitly. Results are written atomically so interruption cannot leave a valid-looking truncated JSON file. The summary records successes, partial successes, failures, duration, and output path.

The CLI remains useful without a database. Local JSON output is an export/debugging feature, not the BoardroomX application source of truth.

### Persistence adapter

Add a separate Supabase persistence adapter. It receives a scraper result and performs idempotent upserts.

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

### Railway worker

Replace the external scraper dependency in the existing annual worker path with the Python library and persistence adapter. The production command processes exactly one eligible queue item and exits.

The worker retains the existing BoardroomX queue contract:

- seed missing active `market_universe` symbols;
- acquire a Postgres advisory lock;
- claim one eligible `pending` or `retry` symbol;
- scrape consolidated statements first;
- fall back to standalone only when consolidated annual P&L is unavailable;
- validate and persist the result;
- update queue and run-log status;
- release the lock and exit.

Railway schedules the command once per minute. There is no parallel fetching. Complete symbols are refreshed only after an explicit request, a freshness trigger, or a chosen long audit interval.

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

Persistence tests use a fake adapter or transaction-isolated database boundary to verify idempotent upserts, no overwrite on failed refresh, queue transitions, and one-symbol-per-run behavior.

An opt-in live smoke command fetches `TDPOWERSYS`. It is not part of the default automated test suite because network state and Screener HTML can change independently of the code.

## Deliverables

1. Reusable `ScreenerScraper` and `ScraperConfig` Python package.
2. Single-ticker and batch CLI with the requested flags and JSON exports.
3. Lossless, versioned result contract covering all requested sections.
4. Supabase migration for the latest full-payload snapshot and operational metadata required by the worker.
5. Persistence adapter that fills both existing typed financial tables and the full JSONB snapshot.
6. Railway one-symbol worker integrated with the existing queue, locking, retry, and run-log model.
7. Fixture-based unit and integration tests plus an optional live verification command.
8. Dependency and deployment documentation, including environment variables and Railway cron command.

## Acceptance Criteria

- The library examples in the request work without importing BoardroomX internals.
- A `TDPOWERSYS` scrape returns every available requested section and typed annual periods.
- Every returned field is present in the stored full payload after persistence.
- Existing annual tables receive idempotent normalized rows.
- A missing optional section is visible as partial status and does not delete older good data.
- A production worker invocation claims at most one symbol and exits within its hard timeout.
- Default automated tests run without network access.
- Existing Node tests continue to pass after the cron command integration changes.
