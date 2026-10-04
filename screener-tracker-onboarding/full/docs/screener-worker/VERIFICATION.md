# Phase 1 verification

## Automated checks

`npm test`: worker pass order, maximum two attempts, final counts, upload failure, DB failure, manual interruption, JSON section checks, legitimate blanks, bank rows, missing charts, pacing, API response/duplicate Start and removal of retired routes.

`BROWSER_QA=1 npm test`: also checks the actual Workers page in Chromium using a fake DB/worker. One Start request, disabled button, final N/N, bottom failure drawer, navigation collapse, mobile width and no browser script errors. No Screener or Dhan requests in automated tests. Local Playwright Chromium must be installed; the Railway Docker image already includes it.

## Controlled real checks completed

| No. | Check | Result |
|---|---|---|
| 1 | Real sequential batch: LAURUSLABS, SBIN, TCS | 3/3 successful; full JSON stored with v3 metadata. |
| 2 | Four chart images per company | Public PNG URLs readable; four distinct images per company; visually checked TCS price/volume screenshot. Collector matches selected range response to canvas data before capture. |
| 3 | Bank format | SBIN Revenue/Financing Profit rows and ROE-only ratios accepted. |
| 4 | Duplicate concurrent DB Start | One batch created; other request returns 409. |
| 5 | First failure then exhausted retry | Awaiting retry at attempts 1 does not increase Processed; final failure at attempts 2 increases it once; Completed with failures, N/N. |
| 6 | Failed refresh | Prior successful TCS JSON unchanged. |
| 7 | Interrupted batch and startup | Running becomes Not completed; no automatic scraping; manual Start creates fresh batch with zero progress. |
| 8 | UI | Desktop/mobile, slim collapsed rail, progress, disabled Start and bottom failure drawer passed. |
| 9 | Railway production Start → finish | TCS + SBIN completed 2/2; duplicate Start 409; saved v3 JSON and eight readable PNG URLs; live UI Completed with Start enabled. See deployment-qa.json. |
| 10 | Dependencies | npm audit reports zero vulnerabilities after validator patch. |

## Manual acceptance cases

| No. | Action | Expected |
|---|---|---|
| 1 | Start with `{}` | Active DB universe frozen; no Dhan API calls; UI shows fixed total. |
| 2 | Close tab during Running | Railway continues; reopen reads saved progress. |
| 3 | Start from a second tab / repeat POST | 409; no second running batch. |
| 4 | Missing source section or bad/empty page | First failure waits until retry pass; second failure goes to manual review. |
| 5 | Missing individual value / short listed history | Source null preserved; populated sections pass. |
| 6 | Break chart upload | Company cannot become Successful. |
| 7 | Break DB write | No invented progress; batch stops. A startup after an unrecorded hard stop marks it Not completed. |
| 8 | Restart Railway mid-run | No automatic resume; status Not completed; next manual Start uses a fresh list. |
| 9 | Successful finish | Processed equals total; successful + failed equals total. |
| 10 | Rate limit | Shared pacer waits for Retry-After or 60 seconds before another data request. |

For production controlled QA, `POST /api/screener/runs` may receive `{"symbols":["TCS","SBIN"]}` (maximum 20 active DB-listed symbols). The user-facing button always sends `{}` for all companies. No full scrape is automatically triggered by deployment.

No universal accuracy guarantee: these checks verify source capture, flow and persistence. Changes to Screener's page can require selector updates. Public source sections genuinely absent are recorded as failed; unused images from failed attempts are not automatically cleaned in phase 1.
