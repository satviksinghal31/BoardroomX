# Company-page scraper and initial ingestion QA

Release: parser 4.0.0, JSON schema 1.0.0, scope `company_page`. Normal fetch makes one company-page call; genuine standalone fallback makes a second. Peers, clicked financial breakdowns and named shareholders are removed. Main financial tables, total borrowings, aggregate shareholding, document links and available dates remain.

## Checks

- 69 offline tests pass in a clean Python 3.12 environment with declared dependencies: 48 scraper/contract tests and 21 ingestion tests.
- Independent scraper review found no remaining critical/medium issues after fixing malformed annual structures and invalid period dates.
- Independent ingestion review found empty financial arrays wrongly marked complete and block warnings discarded during validation failure. Both were fixed with failing-then-passing regression tests; review signed off.
- Existing eight-company fixtures preserve financial values, dates, source links, document URLs and unit maps. Prior Playwright main-page checks matched 701 financial cells, 93 attachment URLs and 5 ISO document date nodes. Those browser checks predate removal of peers; removing peers did not change the page parser.
- Live initial pilot: 10/10 complete Supabase JSON records, identities correct, all schema 1.0.0; RELIANCE,HDFCBANK,CARBORUNIV,SHILPAMED,MPHASIS,ATHERENERG,HESTERBIO,NAVKARURB,SBIN,TCS. Nine consolidated and Navkar standalone. Each JSON was checked for exact database roundtrip equality. Pilot took approximately 23 seconds including pacing and DB writes, and was explicitly verified before enabling the universe run.

## Runtime behavior

One advisory-locked sequential worker starts one company no faster than every 2 seconds, with progress checkpoints every 50. There is no additional batch cooldown. Failures/partial results get one retry after the first pass. Server backoff is preserved and pauses the run; explicit resume cannot ignore its deadline. Main-page errors never trigger standalone fallback.

Stored snapshots are one row per stock; failed refreshes preserve existing JSON and its timestamp. Pilot gate, attempts, last company start, state and error are durable. Progress is readable while the worker runs, counts unique remaining companies, and estimates time using measured processing durations rather than idle review time.

The initial universe is 2,563 active Dhan NSE equity stocks classified EQUITY_SHARE. 350 fund instruments and inactive rows are excluded. The full run's coverage is reported separately; pilot success does not establish universe-wide completeness.

## Cleanup and limits

The obsolete deployment was stopped; its three database tables were replaced by the JSON and control tables. The stock universe and unrelated database tables remain. The retired tracked application was deleted after explicit user authorization; no UI was implemented. Old backup JSON and chart storage were retired.

No skill or LLM is required for extraction: the Python function returns a dictionary and the CLI writes JSON directly. `company.schema.json` describes the stable shape; runtime validation enforces required types, usable annual data, calendar-aligned financial periods and finite JSON numbers.

Upstream changes/blocks, unavailable issuers, rare financial layouts and identifier differences may still require attention. Missing dates are not invented, short consolidated history is not mixed with standalone, and masked cells remain null. Public main-page coverage excludes premium/login sections and full announcement archives. A future weekly scheduler can call the same scripts; no recurring schedule exists now. CI remains an inactive template pending workflow permission.

Consolidated-first remains unconditional when financials exist. Freshness metadata flags annual data older than 18 calendar months and quarterly data older than 6 calendar months separately from capture completeness. Irregular duration labels (15m, 9m, etc.) retain their original label and now have correct month-end dates. Unexpected company pages pause the worker.
