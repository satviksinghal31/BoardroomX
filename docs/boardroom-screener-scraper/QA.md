# Release QA — 9 October 2026

Release: `scrapers/boardroom_screener_scraper.py`, parser 2.1.0. Single-company fetcher; batch integration is intentionally deferred.

Three independent agents reviewed data correctness, resilience and operations. Findings were reproduced before fixing. Final independent signoffs: data 7/7, resilience 12/12, operations 3/3. With the existing 18 regression tests, all **40 tests pass** in a clean Python 3.12 virtual environment using only declared dependencies. Python 3.9 also passed the agents' local checks. An inactive CI template covers Python 3.9/3.12/3.13. The existing GitHub OAuth credential lacks workflow scope, so GitHub Actions could not be enabled; only local checks are confirmed.

Fixed QA findings: unbounded Retry-After waits (controlled abort beyond 60s); challenge pages wrongly triggering fallback; non-atomic refresh writes; malformed holder attributes/URLs aborting financial extraction; ragged growth rows; invalid financial periods qualifying as usable; schedule units failing to inherit lakh units (annual and quarterly); repeated optional server outage requests. A 503 optional-service simulation now makes four requests versus the prior 79; healthy full Reliance makes 27 paced requests. Atomic write, replace, serialization and fsync failure scenarios preserve previous snapshots.

Earlier exploratory live/browser sample: RELIANCE, HDFCBANK, CARBORUNIV, SHILPAMED, 526299/MPHASIS, ATHERENERG, HESTERBIO and 531494/NAVKARURB. Observed market caps ranged approximately ₹96.5 crore–₹15.8 lakh crore; size labels are illustrative, not AMFI classifications. Saved fixtures reproduce their base tables. Independent browser comparisons had zero mismatches in 4,905 financial cells and 829 headline/growth/peer checks. The sample was selected for variation, not statistically random.

Final renamed release live fetch: Reliance consolidated completed with zero warnings. Final Playwright validation matched 701 financial cells and all 93 attachment anchors, confirmed borrowing and named-promoter expansions, and fetched Navkar with real standalone fallback. These checks confirm agreement with displayed Screener data, not audited filing accuracy. Fixtures add synthetic bank/NBFC labels, negative amounts, non-March years, half-year headers, missing/locked values and operational failure scenarios.

Benchmark inspection covered MaticAlgos/screener-scraper, VishwaGauravIn/screener-scraper-pro, Na1neeth/openscreener, mayur1064/screenercli and sahiljani/screener-india. Same-fixture parser checks exposed document/detail/source-link gaps in our original implementation and differing null/history/peer behavior in competitors. Those observed gaps are fixed. This is competitive coverage for this scope, not proof of a universal best-in-class ranking or a speed leaderboard.

## Remaining gaps and decisions

| Gap | Recommendation |
|---|---|
| Site HTML/internal endpoint changes, blocks or outages | Unavoidable upstream dependency. Preserve last-good data and alert on warnings/failures in the future caller. Small production monitoring is worthwhile. |
| Per-call pacing; no aggregate limit across processes | Add shared rate control when implementing batch ingestion. Do not parallelize now. |
| Full enrichment costs many calls | Daily summary refresh plus less frequent full detail refresh may be sufficient. Choose cadence in ingestion, using the same fetcher. |
| Optional failures produce partial successful JSON | Inspect warnings/status; retain previously stored optional data. Do not blindly overwrite database sections with unavailable results. |
| No strict overall call deadline | Current request timeouts/retry limits are sufficient for single-company use. Add caller job deadline when batching; no scheduler here. |
| Premium/login sections, full announcement archive, document contents | Outside public fetch scope. Preserve links/availability; authenticated ingestion is a separate requirement. |
| Short consolidated history | Intentional: consolidated wins even if standalone is longer. Warn; never splice views. |
| Rare issuer structures and new field labels | Existing generic preservation helps, but eight issuers cannot establish universal correctness. Add fixtures when real drift occurs. |
| lxml optional-parser equivalence not separately certified | Clean release tests use stdlib parser; keep lxml optional. No reason to make it mandatory. |

No proxy rotation, browser production runtime, cache framework, queue, distributed worker or database integration was added. This fetcher is ready for reviewed single-company use, subject to the upstream limits above; no scraper can promise flawless daily availability.
