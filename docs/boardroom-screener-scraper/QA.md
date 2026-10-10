# Company scraper and ingestion QA

## Current contract

Lean company JSON retains Screener company_id, ticker, profile (website/NSE/BSE codes and source company data), accounting view, source_url, scraped_at, financial tables, units and warnings. Internal/request/version metadata, calculated history/freshness, document_scope and unused features are excluded. Auto checks two usable annual years within 24 months and two consecutive usable quarters within 12 months (latest within six months). Recent consolidated is preferred; otherwise standalone is requested once. Usable partial standalone is retained; if standalone is absent/empty, available consolidated is retained with a warning. Neither view having usable annual or quarterly financials is an explicit failure. Operational errors do not trigger fallback. Explicit diagnostic views bypass recency checks. No peer or clicked financial-detail requests are made.

Documents use annual_reports, concalls, credit_ratings and announcements arrays. Concall rows group transcript, presentation and recording URLs by the source display month; duplicate months remain separate source rows. Missing links are null and AI summaries are excluded. Additional non-AI attachments are preserved. Dates and reporting-quarter associations are not invented.

## Verification

103 offline tests pass in Python 3.12 with declared dependencies. Regression coverage includes consolidated-first fallback, no extra requests, malformed responses, irregular duration periods, finite JSON, identity, financial/link preservation, conversion idempotency, duplicate concall months, AI-only rows, atomic output, advisory locking, durable pacing/retry/backoff and preservation of good data after failed refreshes. Independent scraper and ingestion reviews completed. New regression coverage includes calendar boundaries, two annual years, consecutive quarters, empty/TTM/future values, annual-only retention, standalone navigation labels and intentional view replacement in the runner.

The ten-company pilot passed identity and exact JSON database roundtrip checks before the full run. The full initial universe is 2,563 active Dhan NSE equity stocks classified EQUITY_SHARE; inactive rows and 350 fund instruments were excluded. One sequential worker starts companies at least two seconds apart, checkpoints every 50, saves immediately and retries partial/failed companies once after the first pass.

## Initial coverage

The initial run and retry pass finished on 2026-10-10: 2,481 complete, 76 partial, 6 failed, 0 pending (96.8% complete). Every universe company has its stock row. 74 partial records lack a quarterly table in the selected page; DWARKESH and SGL lack balance_sheet, cash_flow and ratios. FELDVR, HEG, JISLDVREQS, MANBRO, SANGINITA and SILLYMONKS produced no usable company financial page at their current identifiers. These remain explicit unresolved records; unavailable data or identifier corrections are not guessed.

The lean conversion validates every stored JSON before writes, checks unchanged financial values and identity, verifies all non-AI attachment URLs, performs conditional batched updates and verifies exact database roundtrips. It does not change status, attempts, errors or fetch timestamps.

## Remaining limits

Capture completeness does not guarantee that upstream financials are current. History/freshness can be calculated from the source reporting dates when needed. Public main-page coverage excludes premium/login content, charts, pros/cons, peers, expanded financial rows, named shareholders, document downloads and full announcement archives. A call month is not automatically a reporting quarter. No UI or recurring scheduler has been implemented; weekly refresh can reuse the existing pilot/run commands. CI remains an inactive template pending workflow permission.

## Targeted stale-view review — 10 October 2026

The 67 EQ partials comprise 65 missing quarterly tables and DWARKESH/SGL missing balance-sheet, cash-flow and ratio periods. Seven BE and two BZ partials were not part of the targeted 65-company check. All 65 standalone pages returned HTTP 200: 64 expose current annual and quarterly tables without parser warnings, with latest quarters June 2026. SHANKESH has four annual periods through March 2026 but no quarterly reporting columns; this is retained as partial data under the final policy.

Playwright checked both views for AUBANK, VSTIND, COLPAL and SHANKESH. Raw response and browser financial tables matched; an additional wait did not populate empty tables. The first three consolidated annual series end in March 2017/2010/2010, whereas standalone contains 13 quarters through June 2026. SHANKESH has no quarterly periods in either view. No additional endpoint is required for the other 64.

A view-label bug was also found: a standalone heading contains a link labelled View Consolidated. Accounting-view detection now excludes that navigation text, so selecting standalone correctly records view and fallback_reason. Full source financial values are preserved in targeted replay through the actual scraper and standard JSON validation.

This audit does not update Supabase, reset the universe, start a full batch or implement UI. Initial database coverage above is unchanged until a separately initiated refresh.

Final targeted replay through the updated scraper returns 64 complete standalone JSONs and one partial standalone JSON (SHANKESH), with at most two page requests each, correct fallback metadata and exact preservation of source financial values. Live final scraper runs on AUBANK, VSTIND and SHANKESH match the saved-page replay. An ingestion regression confirms valid standalone selection is not rejected merely because an older consolidated snapshot has more rows, including redirected standalone responses. Failed refreshes still preserve stored good JSON.
