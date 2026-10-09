# Page-and-peers scraper review — 9 October 2026

Version 3.0 intentionally removes financial-schedule and individual-shareholder expansion fetching. This simplifies scope; those endpoints were required for clicked details, but need not be fetched for a main-page snapshot. Total borrowings and aggregate shareholding remain intact.

## Exact request breakdown

| Company | Requests | Measured elapsed | Selected view |
|---|---:|---:|---|
| RELIANCE | 2: company page + peers | 0.64s | consolidated |
| HDFCBANK | 2: company page + peers | 0.36s | consolidated |
| 531494 / NAVKARURB | 3: consolidated check + standalone + peers | 0.49s | standalone |

All three live fetches had zero warnings and zero schedule/investor calls. These single-run timings are not a universe-throughput guarantee. Retries, redirects and optional absence can alter network request counts. Peers already embedded in the initial HTML need no extra request.

## Sanity and independent review

- 40 offline tests pass: base financial fixture comparison across eight companies, source/document links and metadata, view selection, malformed growth/periods, units, HTTP/network errors, bounded Retry-After, atomic output, session reuse and explicit request-count tests.
- An independent agent reviewed spec compliance and code quality, added five page-scope tests and reported no critical/medium findings in its scope.
- Final Playwright comparison matched 701 financial cells, all 93 document attachment anchors and all 5 document ISO date nodes on Reliance's page. Total borrowings remained in the balance sheet. No detail controls were clicked in this check.
- Dates remain financial period/period-end, available document ISO/display dates, annual-report year, concall month and UTC extraction timestamp. Missing dates remain null; TTM has no invented end date.
- Earlier eight-company exploratory browser checks matched 5,734 financial/headline/growth/peer values. The current eight-company fixtures ensure simplification retained the same base values; they are not fresh network tests of all eight issuers.

## Deliberate omissions and practical limits

Expanded borrowings/other financial breakdowns and named shareholders are removed, not marked missing. Charts, pros/cons, login/premium content, document downloads and a full announcement archive remain excluded. A short consolidated history still wins over a longer standalone history, without mixing views.

Upstream HTML/API changes and blocks remain possible. Peer failures return financials with warnings. Consumers must inspect warnings and retain last-good data. Default fixed delay is 0; sequential requests and server-requested backoff remain. No batch runner or UI is part of this change.

Batch ingestion is paused for scraper review. The old Railway deployment was stopped and old records backed up, but legacy database tables remain; no new universe ingestion or UI was started. CI remains an inactive template because the available OAuth credential lacks workflow scope.

## Compatibility

Parser version 3.0 is a scope/API change: `details`, `--summary-only`, `schedules`, `holders`, `details_requested` and their endpoint parsers/discovery were removed. Main-page financial/document fields retain their names. Consumers should call `fetch_company(symbol)` and use `scope=company_page_and_peers`.
