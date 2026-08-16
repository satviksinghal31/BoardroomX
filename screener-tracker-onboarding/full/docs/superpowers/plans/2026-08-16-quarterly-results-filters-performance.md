# Quarterly Results Filters and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the quarterly-results page fast and quarter-specific, with prior-quarter tags plus accurate reporting-date, watchlist, and NSE market-cap filters.

**Architecture:** Keep the existing authenticated endpoint and replace its all-period materialized query with an exact-quarter indexed query. Return quarter/date/watchlist facets with the paginated rows, and let the static frontend render a responsive right-side filter panel using one shared state object and cancellable requests.

**Tech Stack:** Node.js ESM, Express, PostgreSQL/Supabase, browser JavaScript, HTML/CSS, Node test runner, Railway.

---

## File map and ownership

- `quarterly_results.js`: input validation, quarter/date helpers, indexed SQL, filter facets, response shaping.
- `quarterly_results_routes.js`: pass authenticated user identity into the service without accepting a client user ID.
- `tests/quarterly-results-api.test.mjs`: backend contract and SQL-structure tests.
- `public/quarterly-results.html`: quarter heading/tags, results column, filter panel markup.
- `public/quarterly-results.js`: filter state, request parameters, rendering, chips, cancellation and preserved-result loading.
- `public/quarterly-results.css`: two-column layout, sticky filters, tags/chips and mobile panel.
- `tests/quarterly-results-page.test.mjs`: frontend contract and interaction-source tests.

Backend and frontend tasks can run in parallel because they edit disjoint files and share the response contract already fixed in the approved design.

### Task 1: Backend quarter contract and indexed query

**Files:**

- Modify: `quarterly_results.js`
- Modify: `quarterly_results_routes.js`
- Test: `tests/quarterly-results-api.test.mjs`

- [ ] **Step 1: Add failing quarter and route-identity tests**

Add tests that require:

```js
const response = await service.list({ quarter: '2026-06-30' }, { userId: 'user-1' });
assert.equal(response.meta.activeQuarter, '2026-06-30');
assert.equal(response.meta.activeQuarterLabel, 'June 2026');
assert.deepEqual(captured.params.slice(0, 3), ['2026-06-30', '2026-03-31', '2025-06-30']);
assert.doesNotMatch(captured.sql, /WITH eligible AS/i);
assert.match(captured.sql, /period_end\s*=\s*\$1/i);
```

Update the route test so `req.user.id` is passed as trusted service context and no query-string user ID is used.

- [ ] **Step 2: Run the backend tests and verify RED**

Run:

```bash
node --test tests/quarterly-results-api.test.mjs
```

Expected: failure because the current service has no `meta`, quarter input, or route user context and still uses the materialized eligible CTE.

- [ ] **Step 3: Implement quarter helpers and the indexed exact-period query**

Add pure validation/helpers equivalent to:

```js
function quarterDates(periodEnd) {
  const [year, month] = periodEnd.split('-').map(Number);
  const previous = month === 3
    ? `${year - 1}-12-31`
    : `${year}-${String(month - 3).padStart(2, '0')}-${month === 6 ? '31' : '30'}`;
  return { current: periodEnd, previous, priorYear: `${year - 1}-${String(month).padStart(2, '0')}-${periodEnd.slice(8)}` };
}
```

Validate exact quarter-end dates through the existing quarter-period utilities. Resolve the newest processed period when `quarter` is omitted. Query only current rows at `$1`, and use direct indexed lateral lookups at `$2` and `$3` for same-symbol, same-basis historical rows. Preserve consolidated-first selection, revision ordering, null growth rules and response arithmetic.

- [ ] **Step 4: Run the backend tests and verify GREEN**

Run:

```bash
node --test tests/quarterly-results-api.test.mjs
```

Expected: all backend tests pass.

- [ ] **Step 5: Add failing filter and facet tests**

Add focused tests for:

```js
await service.list({ reported_date: '2026-08-15', watchlist: 'true' }, { userId: 'user-1' });
assert.match(captured.sql, /AT TIME ZONE 'Asia\/Kolkata'/i);
assert.match(captured.sql, /watchlists/i);
assert.ok(captured.params.includes('user-1'));
```

Also require:

- Daily counts are returned in `meta.reportedDates` and are not constrained by watchlist/search/market-cap filters.
- Available quarter tags are newest first with distinct company counts.
- `meta.watchlistCompanies` is user-specific.
- Fixed market-cap buckets use non-overlapping rupee boundaries.
- Custom min/max values are expressed in crore at the API and converted to rupees once.
- Missing market cap stays under All and is excluded by any range.
- Fixed bucket plus custom bounds returns 400.
- Invalid quarter/date/watchlist/numeric values return 400.
- Page defaults to 25 while the server maximum remains 50.

- [ ] **Step 6: Run filter tests and verify RED**

Run:

```bash
node --test tests/quarterly-results-api.test.mjs
```

Expected: new filter/facet assertions fail because they are not implemented.

- [ ] **Step 7: Implement validated filters and metadata**

Use an allow-list:

```js
const MARKET_CAP_BUCKETS = {
  under_50: [0, 50_00_00_000],
  '50_500': [50_00_00_000, 500_00_00_000],
  '500_5000': [500_00_00_000, 5000_00_00_000],
  '5000_plus': [5000_00_00_000, null],
};
```

Build predicates only from validated values; never interpolate user input. Join `watchlists` only when active using `req.user.id`. Run small metadata queries and the paginated result query with `Promise.all` after the active quarter is resolved. Return the exact approved `meta`, `items`, and `pagination` contract.

- [ ] **Step 8: Run backend tests and commit**

Run:

```bash
node --test tests/quarterly-results-api.test.mjs
```

Expected: all backend tests pass.

Commit:

```bash
git add quarterly_results.js quarterly_results_routes.js tests/quarterly-results-api.test.mjs
git commit -m "feat: add fast quarterly results filters"
```

### Task 2: Frontend quarter navigation and filter panel

**Files:**

- Modify: `public/quarterly-results.html`
- Modify: `public/quarterly-results.js`
- Modify: `public/quarterly-results.css`
- Test: `tests/quarterly-results-page.test.mjs`

- [ ] **Step 1: Add failing structural UI tests**

Require:

```js
assert.match(html, /id="quarterlyHeading"/);
assert.match(html, /id="quarterlyQuarters"/);
assert.match(html, /id="quarterlyFilters"/);
assert.match(html, /Reported date/i);
assert.match(html, /Watchlist/i);
assert.match(html, /Market cap/i);
assert.doesNotMatch(html, /Industry|TTM PE|Qtr PE|Turnaround/i);
```

Require CSS for a desktop results/filter grid, sticky filter panel, active quarter/filter chips, and a mobile filter toggle/panel.

- [ ] **Step 2: Run page tests and verify RED**

Run:

```bash
node --test tests/quarterly-results-page.test.mjs
```

Expected: failure because the filter panel, tags and dynamic heading are absent.

- [ ] **Step 3: Implement the semantic page structure and responsive styles**

Keep search in the results column. Add:

```html
<h1 id="quarterlyHeading">Quarterly results</h1>
<nav id="quarterlyQuarters" class="quarterly-quarters" aria-label="Reporting quarters"></nav>
<button id="quarterlyFilterToggle" class="quarterly-filter-toggle" type="button" aria-expanded="false" aria-controls="quarterlyFilters">Filters</button>
<aside id="quarterlyFilters" class="quarterly-filters" aria-label="Quarterly result filters"></aside>
```

On desktop, use `minmax(0, 1fr) 280px`; make the aside sticky below the header. On mobile, show the toggle and collapse the aside without duplicating controls.

- [ ] **Step 4: Run page tests and verify GREEN for structure**

Run:

```bash
node --test tests/quarterly-results-page.test.mjs
```

Expected: structural tests pass.

- [ ] **Step 5: Add failing interaction-source tests**

Require the frontend source to contain:

- State for `quarter`, `reportedDate`, `watchlist`, `marketCapBucket`, `marketCapMin`, `marketCapMax`, existing search/sort/order/page, and `limit: 25`.
- Query serialization to the approved parameter names.
- Dynamic `June 2026 quarterly results` heading from API metadata.
- Quarter tags with selected state and exact-quarter loading.
- Reporting dates with stable counts.
- `All companies` and `My watchlist — N`.
- Fixed market-cap options and custom min/max.
- Removable chips and Clear all.
- `AbortController` and a request sequence guard.
- Existing results are not cleared during refresh.
- Quarter change clears only date and page; Clear all restores every default.

- [ ] **Step 6: Run page tests and verify RED**

Run:

```bash
node --test tests/quarterly-results-page.test.mjs
```

Expected: interaction assertions fail because the current script only supports search/sort/order/page.

- [ ] **Step 7: Implement state, rendering and cancellable loading**

Keep one state object and one request builder. Abort the previous controller before starting another request. Set `aria-busy` and a compact busy class while leaving existing cards visible. Render metadata before results, then render cards and pagination. On failure, retain the previous cards and show the inline retryable error.

Date and market-cap options are radio groups. Custom bounds apply together only after validation. Applied filters render as buttons whose remove actions reset exactly one field. Clear all resets the newest-quarter default by clearing `state.quarter` so the API resolves it again.

- [ ] **Step 8: Run page tests and commit**

Run:

```bash
node --test tests/quarterly-results-page.test.mjs
```

Expected: all page tests pass.

Commit:

```bash
git add public/quarterly-results.html public/quarterly-results.js public/quarterly-results.css tests/quarterly-results-page.test.mjs
git commit -m "feat: add quarterly results filter panel"
```

### Task 3: Integrated contract and regression verification

**Files:**

- Modify only if a verified integration defect is found.
- Test: `tests/quarterly-results-api.test.mjs`
- Test: `tests/quarterly-results-page.test.mjs`

- [ ] **Step 1: Verify backend/frontend parameter and response names match**

Check exact names: `quarter`, `reported_date`, `watchlist`, `market_cap_bucket`, `market_cap_min`, `market_cap_max`, `activeQuarter`, `activeQuarterLabel`, `quarters`, `reportedDates`, and `watchlistCompanies`.

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --test tests/quarterly-results-api.test.mjs tests/quarterly-results-page.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 3: Run the full suite**

Run:

```bash
TZ=Asia/Kolkata npm test
```

Expected: zero failures.

- [ ] **Step 4: Verify source and syntax**

Run:

```bash
node --check quarterly_results.js
node --check quarterly_results_routes.js
node --check public/quarterly-results.js
git diff --check origin/main...HEAD
```

Expected: every command exits zero.

### Task 4: Production-data performance and correctness gate

**Files:**

- No source changes unless the measured query differs from the tested contract.

- [ ] **Step 1: Execute `EXPLAIN (ANALYZE, BUFFERS)` for the generated default query against production data**

Expected:

- Exact current/previous/prior-year dates.
- Existing `quarterly_results_symbol_period_basis_idx` used for history.
- No materialized all-period eligible CTE rescanned per company.
- Target execution below 500 ms; expected approximately 45 ms from the validated prototype.

- [ ] **Step 2: Reconcile filters directly in SQL**

For at least three IST reporting dates, compare API facet counts to distinct processed symbols. Verify all four fixed market-cap boundaries and the signed-in user's watchlist intersection.

- [ ] **Step 3: Run an authenticated local or production-like API smoke test**

Verify default quarter, one prior-quarter tag, one date, watchlist, every fixed market-cap bucket, one custom range, search, and all three sorts.

### Task 5: Independent review, push and deployment

**Files:**

- Modify only to resolve review findings.

- [ ] **Step 1: Run independent specification compliance review**

Compare implementation line-by-line with `docs/superpowers/specs/2026-08-16-quarterly-results-filters-performance-design.md`. Fix and re-review every missing or extra behavior.

- [ ] **Step 2: Run independent code-quality and security review**

Check SQL parameterization, authenticated watchlist ownership, date/timezone boundaries, response races, accessibility and maintainability. Fix and re-review all Critical or Important findings.

- [ ] **Step 3: Re-run every verification gate**

Run focused tests, full tests, syntax checks, diff checks, production-data EXPLAIN and smoke tests with fresh output.

- [ ] **Step 4: Push the feature branch and open a pull request**

Push `codex/quarterly-results-filters`, create the PR, wait for checks/review, resolve findings, and merge only when green.

- [ ] **Step 5: Deploy and verify Railway production**

Verify the new `portfolio-tracker` deployment reaches SUCCESS, then check the public page, authenticated filtered API calls, Railway health, and two unaffected quarterly cron runs. Report the production URL only after those checks pass.
