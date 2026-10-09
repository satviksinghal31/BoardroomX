# Boardroom Screener scraper

`boardroom_screener_scraper.py` fetches exactly one company's public Screener data. Python 3.9+, requests and BeautifulSoup; no production browser or batch worker.

```sh
python -m pip install -r scrapers/requirements.txt
python scrapers/boardroom_screener_scraper.py RELIANCE --out out
python scrapers/boardroom_screener_scraper.py 531494 --out out
python scrapers/boardroom_screener_scraper.py RELIANCE --summary-only
python -m unittest discover -s scrapers/tests -v
```

Library usage:

```python
from scrapers.boardroom_screener_scraper import fetch_company, scrape
company = fetch_company("RELIANCE")
# scrape(existing_requests_session, "RELIANCE", details=False) reuses a session.
```

Auto selects usable consolidated financials first; standalone is fetched only on genuine absence/no usable financials. Operational errors do not trigger fallback. Views are never combined. Explicit `--view standalone` or `--view consolidated` is available. Short selected-view histories produce a warning.

Output covers profile/citations, headline ratios, peers, quarterly/annual financials and result-source links, balance sheet, cash flow, historical ratios, both shareholding frequencies, public schedules/named holders, and document attachment URLs with metadata. Charts and pros/cons are excluded. Files themselves are not downloaded. Recent announcements are a recent list, not an archive. Login/premium content is marked unavailable; no credentials are used.

Values preserve missing/locked cells as null. Units are per field; percentages are percentage points, not fractions. Bank and NBFC labels are preserved rather than forced into industrial-company labels. `requested_identifier`, canonical `symbol`, selected `view`, source URL, parser version and UTC timestamp support ingestion provenance.

Financial-page failures raise `ScrapeError`; CLI returns 1 and preserves the previous file. JSON updates use atomic replacement. Optional failures preserve financials with `warnings`, null peers or detail `status: unavailable`; CLI returns 0 for such partial results. Consumers MUST inspect warnings and detail status before treating a snapshot as complete; do not erase previously ingested optional data because a refresh is unavailable. Serialization rejects non-finite JSON numbers.

Requests are sequential with a default one-second interval within one company call, 30-second per-request timeout and at most two retries. Retry-After seconds and dates are respected; waits over 60 seconds fail immediately so the caller can retry later, never sooner than instructed. Exhausted optional network/server/access failures stop remaining optional HTTP calls for that company. A total call deadline is not implemented.

Full Reliance enrichment observed 27 requests, roughly 26 seconds in earlier validation; runtime varies by network and company. `--summary-only` skips schedule/holder calls but retains documents and financial tables. A future daily caller can use summary refreshes daily and full enrichment when needed. Pacing resets per call; callers must control aggregate traffic across companies/processes. No promise of daily full-universe throughput is made. Do not add parallel scraping without a shared rate policy.

Tests use public saved fixtures and mocked HTTP responses, with no network access. The QA report records browser/live validation, benchmark scope, and remaining limitations.

CI template: `docs/boardroom-screener-scraper/ci-workflow.yml`. To enable it, move it to `.github/workflows/boardroom-screener-scraper.yml` using a GitHub credential with workflow scope.
