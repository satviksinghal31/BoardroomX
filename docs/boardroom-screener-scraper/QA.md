# Company scraper and ingestion QA

## Current contract

Lean company JSON retains Screener company_id, ticker, profile (website/NSE/BSE codes and source company data), accounting view, source_url, scraped_at, financial tables, units and warnings. Internal/request/version metadata, calculated history/freshness, document_scope and unused features are excluded. Consolidated is retained whenever financials exist; missing consolidated financials allow standalone fallback. No peer or clicked financial-detail requests are made.

Documents use annual_reports, concalls, credit_ratings and announcements arrays. Concall rows group transcript, presentation and recording URLs by the source display month; duplicate months remain separate source rows. Missing links are null and AI summaries are excluded. Additional non-AI attachments are preserved. Dates and reporting-quarter associations are not invented.

## Verification

76 offline tests pass in Python 3.12 with declared dependencies. Regression coverage includes consolidated-first fallback, no extra requests, malformed responses, irregular duration periods, finite JSON, identity, financial/link preservation, conversion idempotency, duplicate concall months, AI-only rows, atomic output, advisory locking, durable pacing/retry/backoff and preservation of good data after failed refreshes. Independent scraper and ingestion reviews completed.

The ten-company pilot passed identity and exact JSON database roundtrip checks before the full run. The full initial universe is 2,563 active Dhan NSE equity stocks classified EQUITY_SHARE; inactive rows and 350 fund instruments were excluded. One sequential worker starts companies at least two seconds apart, checkpoints every 50, saves immediately and retries partial/failed companies once after the first pass.

## Initial coverage

The initial run and retry pass finished on 2026-10-10: 2,481 complete, 76 partial, 6 failed, 0 pending (96.8% complete). Every universe company has its stock row. 74 partial records lack a quarterly table in the selected page; DWARKESH and SGL lack balance_sheet, cash_flow and ratios. FELDVR, HEG, JISLDVREQS, MANBRO, SANGINITA and SILLYMONKS produced no usable company financial page at their current identifiers. These remain explicit unresolved records; unavailable data or identifier corrections are not guessed.

The lean conversion validates every stored JSON before writes, checks unchanged financial values and identity, verifies all non-AI attachment URLs, performs conditional batched updates and verifies exact database roundtrips. It does not change status, attempts, errors or fetch timestamps.

## Remaining limits

Capture completeness does not guarantee that upstream financials are current. History/freshness can be calculated from the source reporting dates when needed. Public main-page coverage excludes premium/login content, charts, pros/cons, peers, expanded financial rows, named shareholders, document downloads and full announcement archives. A call month is not automatically a reporting quarter. No UI or recurring scheduler has been implemented; weekly refresh can reuse the existing pilot/run commands. CI remains an inactive template pending workflow permission.
