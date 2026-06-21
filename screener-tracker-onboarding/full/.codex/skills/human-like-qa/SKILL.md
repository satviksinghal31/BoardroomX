---
name: human-like-qa
description: Use when asked to QA a web app, reproduce a user issue, test production like a real user, create journey-based acceptance checks, or explain why automated QA missed a UI problem.
---

# Human-Like QA

Use this skill to validate the product as a user would, not only as an API or unit-test suite would.

## Core Rule

Do not call a browser-based workflow "passed" unless you have exercised it in a real browser or clearly stated that browser validation was blocked.

## Workflow

1. Identify the user goal, target environment, and primary journeys.
2. Test the first-screen experience first: load time, skeletons, empty states, visible errors, console errors, and broken network calls.
3. Perform realistic actions: search, click, select, navigate tabs, resize viewport, refresh, and retry failed states.
4. Verify UI rendering, not just data existence. For charts, tables, images, maps, and canvases, confirm the visual surface is non-empty and correctly framed.
5. Cross-check the UI against the backing API or database when possible. Treat mismatches as findings.
6. Cover desktop and mobile viewports for responsive products.
7. Capture evidence: exact URL, steps, screenshots when available, console errors, failed request URLs/statuses, and timing notes.
8. Convert every escaped bug into a durable guard: browser smoke test, contract test, visual assertion, or explicit manual QA checklist item.
9. Report with this shape: Findings, Evidence, Coverage, Gaps, Next Guards.

## Required Checks For Data-Driven UI

- Initial page is not stuck on skeletons.
- Authenticated and unauthenticated states are both understandable.
- Main user action has visible loading, success, empty, and error states.
- Search/select flows load the requested entity, not stale data from the previous entity.
- Expensive pages batch or parallelize data fetches instead of doing one request/query per visible row.
- The UI clearly explains when data is unavailable instead of rendering a blank panel.

## Stop Conditions

- If auth credentials/session are unavailable, test public surfaces and API contracts, then report that authenticated browser QA is blocked.
- If production data is missing, verify whether the UI fails gracefully and whether a backfill/sync job is required.
- If a test only checks source code text, label it as a contract check, not human-like QA.
