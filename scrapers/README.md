# Boardroom Screener data pipeline

One company scraper, one sequential batch runner, one JSON row per stock. No UI, peer fetching, expanded rows, document downloads or weekly scheduler.

## Single-company output

```sh
python -m pip install -r scrapers/requirements.txt
python scrapers/boardroom_screener_scraper.py RELIANCE --out out
```

The CLI writes `out/RELIANCE.json`. Library `fetch_company("RELIANCE")` returns the equivalent Python dictionary; `scrape(session, symbol)` reuses a requests session. JSON is produced and validated by code, not by an LLM or skill.

One normal company-page request. A second page request is used only for genuine standalone fallback; retries/redirects may add network requests. Operational errors never trigger accounting-view fallback. Default fixed request delay is zero; server-requested backoff remains.

The output includes identity, source/accounting view, UTC extraction time, profile/citations, headline metrics, full exposed quarterly/annual financial history, balance sheet including total borrowings, cash flow, ratios, aggregate shareholding, growth tables and document URLs/dates. Financial period-end dates and units are explicit. Missing/locked values are null. TTM has no invented date. `scraped_at` is not a market quote timestamp.

The standard structure is documented in `company.schema.json`. JSON keeps the ticker, Screener company ID, website and exchange codes, source URL, accounting view and extraction time. It excludes internal warehouse IDs, request duplicates, version/scope fields, calculated history/freshness, document scope and unused feature metadata. Runtime validation checks required keys/types, calendar-aligned periods, finite JSON numbers and usable annual or quarterly financials. Dynamic company-specific financial labels are preserved. Peers, named shareholders, clicked breakdowns, charts, pros/cons and gated content are excluded; recent announcements are not a full archive.

Documents have four arrays: `annual_reports`, `concalls`, `credit_ratings` and `announcements`. Each concall row keeps its displayed month and transcript, presentation and recording URLs together; duplicate months remain separate rows. Missing links are null. Optional `additional_links` preserves multiple or unfamiliar non-AI attachments without repeating the primary URL. AI summaries are excluded. A call's month is not automatically assigned to a financial reporting quarter, and report years do not imply a fiscal year-end date.

Auto prefers consolidated when it has usable annual values in two distinct calendar years within the last 24 months and at least two consecutive usable quarters within the last 12 months, with the newest quarter no older than six months. Dates are inclusive calendar cutoffs; TTM, future dates and empty columns do not count. Zero values and losses count. Otherwise it requests standalone once and keeps its usable annual or quarterly financials, even if coverage is incomplete. If standalone is absent or has no usable financials, available consolidated financials are retained. Missing/recent-coverage warnings remain explicit; no views are mixed or scored. Neither view having usable annual or quarterly financials remains an explicit failure. Operational errors still raise. Explicit `--view consolidated` and `--view standalone` select that diagnostic view without the recency gate. The JSON has no calculated history/freshness section.

## Universe ingestion

```sh
python -m pip install -r scrapers/requirements-ingestion.txt
# Set SUPABASE_DB_URL privately; do not commit credentials.
python scrapers/ingest.py seed
python scrapers/ingest.py pilot
python scrapers/ingest.py verify-pilot
python scrapers/ingest.py run
python scrapers/ingest.py progress
```

Provision `ingestion.sql` first. Seed freezes active Dhan NSE equity stocks classified EQUITY_SHARE in the existing taxonomy. The initial eligible count is 2,563; funds/inactive instruments are excluded. Universe/identifier issues remain explicit failures, never guessed company substitutions.

Ten representative pilot stocks must pass before the full run. One advisory-locked worker starts at most one company every 2 seconds and reports checkpoints every 50 attempts, without a batch cooldown. Each result is saved immediately and checked for exact JSON equality after database roundtrip. Incomplete/failed companies get at most one second-pass retry. A structurally empty source table is distinguished from a malformed or missing selector; known source-unavailable partials do not get a futile same-run retry and remain eligible for the next explicit refresh. Main required tables missing/empty produce partial status. Known short-history warnings do not prevent completeness.

`boardroom_screener_data` holds one stock row with complete returned JSON, status, attempts, errors and snapshot timestamps. `boardroom_screener_ingestion` is one control row holding progress, pilot gate and pause state. RLS and grants deny public database access. Read-only progress works while the worker holds its lock.

Network/server/access/rate-limit errors pause the universe worker before another company. Inspect the error, wait any durable Retry-After deadline, then use `resume` and `run` (or `pilot` if not verified). Restarted interrupted attempts remain consumed; completed stocks are skipped. Every validated fresh response replaces the prior JSON, including partial responses. Fetch or validation failures retain prior JSON and its original fetch timestamp.

## Repeat later

```sh
python scrapers/ingest.py pilot --refresh
python scrapers/ingest.py verify-pilot
python scrapers/ingest.py run
```

An explicit refresh resets processing state while retaining stored JSON. A future weekly scheduler should invoke these same commands, never duplicate scraper logic. No recurring schedule is created for the initial backfill. A skill is optional operator guidance; it is not part of the extraction/storage runtime.

## Tests and deployment

```sh
python -m unittest discover -s scrapers/tests -v
```

The Dockerfile packages this Python worker for the existing Railway service with one replica. It reads the existing secret database URL, resumes pending work and exits when exhausted. It exposes no website or scrape-trigger endpoint. The old application and old tables/storage were retired. CI remains a template pending GitHub workflow permission.
