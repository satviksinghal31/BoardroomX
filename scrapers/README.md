# Boardroom Screener scraper

Fetch one company's main Screener page and peer comparison as JSON. Python 3.9+, requests and BeautifulSoup. No production browser.

```sh
python -m pip install -r scrapers/requirements.txt
python scrapers/boardroom_screener_scraper.py RELIANCE --out out
python scrapers/boardroom_screener_scraper.py 531494 --out out
python -m unittest discover -s scrapers/tests -v
```

```python
from scrapers.boardroom_screener_scraper import fetch_company, scrape
company = fetch_company("RELIANCE")
# Or scrape(existing_requests_session, "RELIANCE") to reuse a session.
```

## Requests

| Call | Data |
|---|---|
| Company page | Profile/citations, headline metrics, quarterly/annual results and source links, balance sheet including total borrowings, cash flow, historical ratios, aggregate shareholding, growth tables, announcements, annual reports, ratings and all concall attachment links |
| Peers, only if absent from the page HTML | Peer comparison table and median |

Normal healthy fetch: two application requests; one if peers are already in the HTML. Standalone fallback can require a third call. Retries and HTTP redirects can add network requests. Document URLs are saved, never downloaded.

Auto chooses usable consolidated data first, otherwise standalone, without mixing views. Explicit `--view standalone`/`--view consolidated` is available. Short history is reported, not replaced with another accounting view.

Expanded financial breakdowns and individual shareholder names are excluded. Main-page totals remain. Charts, pros/cons and login/premium content are excluded. Recent announcements are a recent list, not an archive; profile commentary may be a preview.

## Dates and reliability

Each financial value retains its displayed period and calendar period-end date. TTM has no invented period-end. Documents retain available ISO dates and display dates; annual reports retain their year, concalls their month. Missing dates stay null. UTC `scraped_at` is extraction time, not the market quote timestamp. Units are explicit per field, percentages are percentage points and missing/locked cells stay null.

No fixed request delay by default; `--pause` is an optional nonnegative interval. Requests remain sequential. Network errors/429/5xx have at most two retries and 30-second request timeouts. Retry-After seconds/dates are respected; waits over 60 seconds fail so the caller can retry later, never sooner. No full-run deadline or batch logic is present.

Main-page failures raise `ScrapeError`; CLI returns 1 and preserves yesterday's file. Optional peers failures keep financials with warnings; callers must inspect warnings. JSON writes replace the destination atomically and reject non-finite numbers.

Version 3.0 removes `details`, `--summary-only`, `schedules`, `holders` and `details_requested`. Existing integrations must use `fetch_company(symbol)`/`scrape(session,symbol)` and read the main-page fields. Output scope is `company_page_and_peers`.

The current QA report is in `docs/boardroom-screener-scraper/QA.md`. The CI workflow template in that directory remains inactive because the existing GitHub credential lacks workflow permission.
