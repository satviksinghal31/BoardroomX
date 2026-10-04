# TCS — Playwright-only dry run

Company: Tata Consultancy Services Ltd (TCS), consolidated Screener page.

This was an actual Node.js JavaScript script using Playwright 1.61.0 and local Chromium. No Python, no screener-scraper-pro, no paid browser API, no AI/OCR reading numbers, and no database writes. Files capture actual rendered page data and images.

| Section | Result |
|---|---|
| Overview | All 19 display fields populated |
| Quarterly | 13 periods, 11 rows |
| P&L | 13 periods including TTM, 12 rows, 4 growth cards |
| Balance sheet | 12 periods, 10 rows |
| Cash flows | 12 periods, 6 rows |
| Ratios | 12 periods, 6 rows; 24 blank cells retained as null |
| Shareholding | Quarterly: 12 periods / 6 rows. Yearly: 11 periods / 6 rows |
| Charts | Real 1/3/5/Max PNGs captured; selected ranges and plotted data confirmed |
| Browser errors | None on the corrected run |
| Local elapsed time | 10.54 seconds, including deliberate two-second request spacing |

The Max chart was visually inspected. Chart date ranges were independently confirmed from rendered datasets: 1y starts 2025-10-06, 3y starts 2023-10-06, 5y starts 2021-10-08, Max starts 2005-04-01. All end 2026-10-01, the source's current last trading date.

## Gaps found before production

1. Generic h1 matching failed because TCS has two headings. Fixed by targeting #top h1. Section-specific readers are needed; generic scroll/read-all logic is insufficient.
2. Locked JSON v2 financial shape works, but its source metadata still hardcodes the old package name/version. Exact schema validation therefore fails two metadata constraints. Update collector metadata explicitly if Playwright is adopted; do not describe this as a full existing-contract pass.
3. The default 1-year chart is loaded automatically, then the draft clicked 1Yr again. Remove the redundant chart request in the worker.
4. Two-second pacing is a gap between requests, not the time budget for an entire company. Wait for each chart response and actual plotted data before capture. This run used response readiness, not a blind scrolling delay.
5. This validates one company's collection path on the local machine. It does not test Railway's browser setup, consolidated-to-standalone fallback, run/retry/restart behavior, or DB/image-storage persistence. Those belong to the worker implementation.

## Proposed runtime flow

Frontend Start button -> our Express POST /api/screener/runs -> save fixed DB run and company entries -> a background JavaScript worker inside the Node.js server starts/resumes -> Playwright opens local Chromium on Railway -> read displayed overview/tables directly into JSON -> select and capture charts -> section QA -> upload images to Supabase Storage -> save JSON and successful item outcome together -> frontend polls our DB-backed progress API -> company-detail API reads saved JSON and image references.

Playwright is an installed Node.js library controlling Chromium in our server container, not an external API service. It has normal code methods such as chromium.launch(), page.goto(), reading page elements and taking screenshots. The HTTP API is ours, between frontend and server. Screener's chart data requests occur naturally when its chart is loaded.

Use one browser reused across companies, one company at a time. Closing the user's browser does not affect this separate Railway browser. If the server restarts, saved DB progress lets the worker resume. Chromium must be bundled in the Railway container; the current cleanup-only deployment does not include it yet.

Collection passed. Production worker and contract metadata transition have not been implemented.
