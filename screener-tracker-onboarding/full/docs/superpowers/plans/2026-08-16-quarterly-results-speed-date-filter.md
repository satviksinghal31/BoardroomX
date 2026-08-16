# Quarterly Results Speed and Date Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make quarterly-result filtering materially faster for Indian users and simplify the date filter to seven recent reporting dates with explicit expansion.

**Architecture:** Keep financial rows uncached and add one bounded in-memory metadata cache inside the existing quarterly-results service. Keep the current single API and filter state, adding only local date-list expansion state. Move the Railway web/API replica from Virginia to Singapore after code verification; do not relocate or modify cron services.

**Tech Stack:** Node.js ES modules, Express, PostgreSQL/`pg`, vanilla JavaScript/CSS, Node test runner, Railway CLI.

---

### Task 1: Cache global quarterly metadata

**Files:**
- Modify: `quarterly_results.js`
- Test: `tests/quarterly-results-api.test.mjs`

- [ ] **Step 1: Write failing cache-contract tests**

Add tests using an injected clock and a query-recording fake pool. Assert that two unpinned requests inside 60 seconds execute active-quarter, quarter-facet, and date-facet SQL only once; result, total, and watchlist SQL still execute twice. Advance the clock beyond 60 seconds and assert metadata SQL executes again. Make a second user request and assert the watchlist-count SQL receives that second user ID.

```js
const service = createQuarterlyResultsService({ dbPool, now: () => now });
await service.list({}, { userId: 'user-1' });
await service.list({ market_cap_bucket: '5000_plus' }, { userId: 'user-2' });
assert.equal(metadataCalls.activeQuarter, 1);
assert.deepEqual(watchlistUserIds, ['user-1', 'user-2']);
now += 60_001;
await service.list({}, { userId: 'user-1' });
assert.equal(metadataCalls.activeQuarter, 2);
```

- [ ] **Step 2: Run focused backend tests and verify RED**

Run: `node --test tests/quarter-periods.test.mjs tests/quarterly-results-api.test.mjs`

Expected: FAIL because `now` is not consumed and metadata queries run on every call.

- [ ] **Step 3: Implement the bounded cache**

Add a 60-second service-local cache and an injected clock:

```js
export function createQuarterlyResultsService({ dbPool, now = Date.now }) {
  let newestQuarterCache = null;
  let quartersCache = null;
  const datesCache = new Map();
  const fresh = (entry) => entry && entry.expiresAt > now();
  // Cache only successful global metadata responses.
}
```

Resolve the newest quarter from cache when `quarter` is omitted. Cache available quarters globally and reported dates by exact quarter. Continue querying result rows, filtered count, and watchlist count on every request. Do not cache user identity, filters, financial rows, or errors.

- [ ] **Step 4: Run focused backend tests and verify GREEN**

Run: `node --test tests/quarter-periods.test.mjs tests/quarterly-results-api.test.mjs`

Expected: all backend quarterly tests PASS.

### Task 2: Put the date filter last and collapse it to seven dates

**Files:**
- Modify: `public/quarterly-results.html`
- Modify: `public/quarterly-results.js`
- Modify: `public/quarterly-results.css`
- Test: `tests/quarterly-results-page.test.mjs`

- [ ] **Step 1: Write failing layout and behavior tests**

Add assertions that the HTML section order is Watchlist → Market cap → Sorting → Reported date. Add executable helper/runtime tests for:

```js
visibleReportedDates(allDates, false, '').length === 7;
visibleReportedDates(allDates, true, '').length === allDates.length;
visibleReportedDates(allDates, false, '2026-07-01') includes the selected older date;
stateAfterQuarterChange(...) resets reportedDate and the runtime collapses date expansion;
```

Assert that the rendered control says `View more` when collapsed, `Show less` when expanded, and is absent for seven or fewer dates.

- [ ] **Step 2: Run focused frontend tests and verify RED**

Run: `node --test tests/quarterly-results-page.test.mjs`

Expected: FAIL because Reported date is first and all dates render without an expansion control.

- [ ] **Step 3: Implement minimal date-list state and markup**

Move the existing Reported date `<section>` after Sorting. Add module-local `reportedDatesExpanded = false`, a pure `visibleReportedDates(dates, expanded, selectedDate)` helper, and render only the latest seven sorted dates unless expanded. When an older selected date is outside those seven, append it to the collapsed visible set. Add:

```html
<button type="button" class="quarterly-date-more" data-toggle-reported-dates>
  View more
</button>
```

Toggle the state locally without requesting the API. Reset it on quarter-tag selection. Keep existing date selection, chips, clear behavior, and request cancellation unchanged.

- [ ] **Step 4: Run focused frontend tests and verify GREEN**

Run: `node --test tests/quarterly-results-page.test.mjs`

Expected: all frontend quarterly tests PASS.

### Task 3: Integrate and independently review

**Files:**
- Verify all files changed by Tasks 1–2

- [ ] **Step 1: Run static and focused checks**

Run:

```bash
node --check quarterly_results.js
node --check public/quarterly-results.js
node --test tests/quarter-periods.test.mjs tests/quarterly-results-api.test.mjs tests/quarterly-results-page.test.mjs
git diff --check
```

Expected: syntax clean, all focused tests PASS, no whitespace errors.

- [ ] **Step 2: Run the complete suite**

Run: `TZ=Asia/Kolkata npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 3: Review cache isolation and UI behavior**

Independent review must verify: no user-specific cache entries, no cached financial rows, no hidden selected date, correct quarter reset, safe DOM escaping, no authentication change, and no Critical/Important issue.

- [ ] **Step 4: Commit implementation**

```bash
git add quarterly_results.js public/quarterly-results.html public/quarterly-results.js public/quarterly-results.css tests/quarterly-results-api.test.mjs tests/quarterly-results-page.test.mjs
git commit -m "fix: speed quarterly filters and collapse dates"
```

### Task 4: Publish, relocate, and verify production

**Files:**
- No source changes expected.

- [ ] **Step 1: Push reviewed commits to the feature branch and fast-forward main**

Run `git push -u origin codex/quarterly-results-speed-date-filter`, refresh `origin/main`, confirm it is an ancestor of `HEAD`, then run `git push origin HEAD:main`. Never force-push.

- [ ] **Step 2: Wait for the Railway web deployment**

Verify `portfolio-tracker` deploys the new main commit successfully and the current production URL remains unchanged.

- [ ] **Step 3: Move only the web service to Singapore**

Preview the exact Railway scale command/plan, then set `portfolio-tracker` to one `southeast-asia` replica and zero `us-east` replicas. Confirm no cron service replica configuration changes.

- [ ] **Step 4: Verify live behavior and latency**

Check page and assets return 200, unauthenticated API returns 401, production UI source contains the seven-date/View-more implementation, and authenticated Railway HTTP telemetry materially improves against the 908–4,061 ms baseline. Use the signed-in browser if available; otherwise use authenticated HTTP telemetry generated by the user session and report that limitation explicitly.

- [ ] **Step 5: Verify cron health**

Confirm `quarterly-results` remains `*/5 * * * *` and at least one post-release run completes successfully without duplicate inserts or reprocessing.
