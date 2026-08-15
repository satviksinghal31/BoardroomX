# NSE Quarterly Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest exact current and comparison-quarter NSE XBRLs every five minutes, store the three required metrics once, and expose a minimal searchable and sortable Quarterly Results page.

**Architecture:** Add one `quarterly_results` table, one official-NSE source module, one taxonomy/metric module, one idempotent worker, one read service/API, and one static page. The five-minute cron discovers new current filings; symbol-filtered NSE history supplies only the previous-quarter and prior-year XBRLs. Page reads use one consistent consolidated-or-standalone basis and never call NSE.

**Tech Stack:** Node.js ESM, built-in `fetch`, PostgreSQL/Supabase, Express 5, Node test runner, vanilla HTML/CSS/JavaScript, Railway cron.

---

## File Structure

- Create `migrations/023_nse_quarterly_results.sql`: minimal table, constraints, indexes, grants, and RLS.
- Create `scripts/lib/quarter-periods.mjs`: quarter-end parsing and comparison-period resolution.
- Create `scripts/lib/nse-quarterly-xbrl.mjs`: exact XBRL fact extraction and taxonomy-specific metric mapping.
- Create `scripts/lib/nse-quarterly-source.mjs`: NSE cookie/session handling, paginated feed, symbol history, and XBRL download.
- Create `scripts/quarterly-results-worker.mjs`: database repository, discovery, history selection, claims, processing, revision handling, and retries.
- Create `scripts/quarterly-results-backfill.mjs`: one-time latest-quarter bootstrap using the production worker components.
- Create `quarterly_results.js`: database-backed read model, same-basis period assembly, growth, sorting, and pagination.
- Create `quarterly_results_routes.js`: authenticated Express route.
- Create `public/quarterly-results.html`: page shell and source banner.
- Create `public/quarterly-results.css`: responsive minimal result-table styling and accessible tooltip.
- Create `public/quarterly-results.js`: search, sorting, pagination, formatting, and rendering.
- Create `scripts/reconcile-quarterly-results.mjs`: five-company source reconciliation gate.
- Create `tests/fixtures/nse-quarterly/*.json|xml`: official response/XBRL fixtures with source URLs documented in fixture metadata.
- Create focused tests for periods, parsing, source client, worker, API, and page contract.
- Modify `scripts/run-cron.mjs`, `package.json`, `server.js`, and primary navigation HTML files.

## Task 1: Database Contract

**Files:**

- Create: `migrations/023_nse_quarterly_results.sql`
- Create: `tests/quarterly-migration.test.mjs`

- [ ] **Step 1: Write the failing migration contract test**

Read the SQL and assert that it defines only the approved table and columns, required checks, same-table revision reference, RLS, and indexes. The test must explicitly reject `company_name`, market-data fields, PDF fields, notification fields, and a company-level fetched flag.

```js
test('quarterly migration contains only the approved persistence contract', () => {
  const sql = readFileSync(new URL('../migrations/023_nse_quarterly_results.sql', import.meta.url), 'utf8');
  for (const column of [
    'nse_seq_id', 'symbol', 'period_end', 'basis', 'taxonomy',
    'source_xbrl_url', 'reported_at', 'status', 'revenue_inr',
    'calculated_ebitda_inr', 'net_profit_inr', 'ebitda_components_inr',
    'last_attempt_at', 'attempt_count', 'next_retry_at', 'error',
    'superseded_by_seq_id',
  ]) assert.match(sql, new RegExp(`\\b${column}\\b`));

  for (const rejected of ['company_name', 'pdf_url', 'market_cap', 'fetched_flag']) {
    assert.doesNotMatch(sql, new RegExp(`\\b${rejected}\\b`));
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/quarterly-migration.test.mjs`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Add the minimal migration**

Implement the table with:

```sql
CREATE TABLE public.quarterly_results (
  nse_seq_id text PRIMARY KEY,
  symbol text NOT NULL REFERENCES public.dhan_instruments(symbol),
  period_end date NOT NULL,
  basis text NOT NULL CHECK (basis IN ('consolidated', 'standalone')),
  taxonomy text NOT NULL CHECK (taxonomy IN ('indas', 'banking')),
  source_xbrl_url text NOT NULL,
  reported_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'processed', 'failed')),
  revenue_inr numeric,
  calculated_ebitda_inr numeric,
  net_profit_inr numeric,
  ebitda_components_inr jsonb,
  last_attempt_at timestamptz,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  next_retry_at timestamptz,
  error text,
  superseded_by_seq_id text REFERENCES public.quarterly_results(nse_seq_id),
  CHECK (superseded_by_seq_id IS NULL OR superseded_by_seq_id <> nse_seq_id)
);
```

Add only the two approved indexes, enable RLS, revoke browser access, and grant service-role access.

- [ ] **Step 4: Run the migration contract test**

Run: `node --test tests/quarterly-migration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add migrations/023_nse_quarterly_results.sql tests/quarterly-migration.test.mjs
git commit -m "feat: add quarterly results schema"
```

## Task 2: Quarter Resolution and Growth

**Files:**

- Create: `scripts/lib/quarter-periods.mjs`
- Create: `tests/quarter-periods.test.mjs`

- [ ] **Step 1: Write failing tests**

Cover NSE dates, year boundaries, leap-year quarter ends, invalid non-quarter dates, and growth nullability.

```js
assert.deepEqual(comparisonPeriods('2026-06-30'), {
  current: '2026-06-30', previous: '2026-03-31', priorYear: '2025-06-30',
});
assert.deepEqual(comparisonPeriods('2026-03-31'), {
  current: '2026-03-31', previous: '2025-12-31', priorYear: '2025-03-31',
});
assert.equal(growthPercent('65544400000', '115542100000'), -43.3);
assert.equal(growthPercent('10', '0'), null);
assert.throws(() => comparisonPeriods('2026-05-31'), /quarter end/i);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/quarter-periods.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement only the tested functions**

Export this exact public contract:

```text
parseNsePeriodEnd(value) -> canonical YYYY-MM-DD string
comparisonPeriods(periodEnd) -> { current, previous, priorYear }
growthPercent(current, comparison) -> one-decimal number or null
```

Use explicit March/June/September/December end-date validation; do not infer arbitrary dates.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/quarter-periods.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/quarter-periods.mjs tests/quarter-periods.test.mjs
git commit -m "feat: resolve quarterly comparison periods"
```

## Task 3: Exact XBRL Fact and Metric Parser

**Files:**

- Create: `scripts/lib/nse-quarterly-xbrl.mjs`
- Create: `tests/fixtures/nse-quarterly/sbi-jun-2026.xml`
- Create: `tests/fixtures/nse-quarterly/hindalco-jun-2026.xml`
- Create: `tests/fixtures/nse-quarterly/ongc-jun-2026.xml`
- Create: `tests/fixtures/nse-quarterly/sources.json`
- Create: `tests/quarterly-xbrl.test.mjs`

- [ ] **Step 1: Add immutable official fixtures and failing parser tests**

The fixture metadata records symbol, period, basis, NSE sequence ID, and exact NSE URL. Tests assert raw INR strings so JavaScript floating-point rounding cannot change stored facts.

Required regression values:

```js
assert.deepEqual(parseQuarterlyXbrl(sbiXml), {
  taxonomy: 'banking',
  revenueInr: '1362404900000',
  calculatedEbitdaInr: '713100000000',
  netProfitInr: '251208900000',
  componentsInr: {
    interest_earned: '1362404900000',
    employees_cost: '192186600000',
    other_operating_expenses: '399639500000',
    provisions: '57478800000',
  },
});

assert.equal(parseQuarterlyXbrl(hindalcoXml).calculatedEbitdaInr, '139320000000');
assert.equal(parseQuarterlyXbrl(ongcXml).netProfitInr, '65544400000');
```

Also test that one missing required EBITDA component yields `calculatedEbitdaInr: null` plus a named issue, never zero.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/quarterly-xbrl.test.mjs`

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement strict extraction and BigInt arithmetic**

Export this exact public contract:

```text
extractFact(xml, localName, contextRef = "OneD") -> decimal string or null
parseQuarterlyXbrl(xml) -> { taxonomy, revenueInr, calculatedEbitdaInr, netProfitInr, componentsInr, issues }
```

Requirements:

- read only facts with `contextRef="OneD"`;
- accept namespace prefixes but match exact local names;
- preserve numeric facts as integer decimal strings;
- calculate with `BigInt` and serialize results as decimal strings;
- return `issues: []` or exact missing-tag names;
- reject XML without a supported Ind AS or Banking identity.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/quarterly-xbrl.test.mjs`

Expected: PASS for SBI, Hindalco, ONGC, and missing-field fixtures.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/nse-quarterly-xbrl.mjs tests/fixtures/nse-quarterly tests/quarterly-xbrl.test.mjs
git commit -m "feat: parse NSE quarterly XBRL metrics"
```

## Task 4: NSE Integrated Filing Source Client

**Files:**

- Create: `scripts/lib/nse-quarterly-source.mjs`
- Create: `tests/fixtures/nse-quarterly/feed-page.json`
- Create: `tests/fixtures/nse-quarterly/sci-history.json`
- Create: `tests/quarterly-source.test.mjs`

- [ ] **Step 1: Write failing client-contract tests**

Inject `fetch` and assert:

- cookie warm-up occurs before API access;
- latest discovery sends `page` and `size`;
- history sends the exact `symbol` filter;
- `seq_Id`, `qe_Date`, basis, publication time, revision marker, and `xbrl` URL normalize correctly;
- HTTP and malformed JSON failures retain status and endpoint context.

```js
const history = await source.fetchHistory('SCI');
assert.equal(history.find(x => x.periodEnd === '2025-06-30').symbol, 'SCI');
assert.match(calls.at(-1).url, /symbol=SCI/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/quarterly-source.test.mjs`

Expected: FAIL because the source client does not exist.

- [ ] **Step 3: Implement the official NSE-only client**

Expose exactly three injected-fetch operations:

```text
fetchLatestPage({ page = 1, size = 200 }) -> normalized page
fetchHistory(symbol) -> normalized filing array
fetchXbrl(url) -> XML string
```

Use the verified endpoint:

```text
https://www.nseindia.com/api/integrated-filing-results
  ?index=equities
  &type=Integrated+Filing-+Financials
  &page=<one-based page>
  &size=<page size>
  [&symbol=<NSE symbol>]
```

Do not add any alternate host or fallback.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/quarterly-source.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/nse-quarterly-source.mjs tests/fixtures/nse-quarterly tests/quarterly-source.test.mjs
git commit -m "feat: add NSE integrated filing client"
```

## Task 5: Idempotent Repository and Worker

**Files:**

- Create: `scripts/quarterly-results-worker.mjs`
- Create: `tests/quarterly-worker.test.mjs`

- [ ] **Step 1: Write failing workflow tests against an in-memory repository double**

Cover:

- active-universe filtering;
- inserting unseen sequence IDs once;
- fetching only current, previous, and prior-year history rows;
- not fetching processed XBRLs again;
- stale processing recovery after 15 minutes;
- retry schedule at 5 and 15 minutes;
- terminal failure after three attempts;
- immediate terminal failure for unsupported taxonomy/identity;
- newer revision superseding the older same symbol/period/basis row;
- one failed filing not stopping other filings.

```js
await runQuarterlyResultsWorker({ source, repository, now });
await runQuarterlyResultsWorker({ source, repository, now });
assert.equal(source.xbrlCallsFor('183362'), 1);
assert.equal(repository.rowsFor('SCI', '2026-06-30').length, 1);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/quarterly-worker.test.mjs`

Expected: FAIL because the worker does not exist.

- [ ] **Step 3: Implement repository interface and orchestration**

Expose this exact worker contract:

```text
createQuarterlyRepository(pool) -> repository
discoverLatestFilings({ source, repository, pageSize = 200 }) -> discovery counts
processDueFilings({ source, repository, now = new Date() }) -> processing counts
runQuarterlyResultsWorker(options) -> combined discovery/processing counts
```

Production claims use one transaction with `FOR UPDATE SKIP LOCKED`. The repository accepts decimal strings and sends them to PostgreSQL as `numeric` parameters.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/quarterly-worker.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/quarterly-results-worker.mjs tests/quarterly-worker.test.mjs
git commit -m "feat: ingest quarterly filings idempotently"
```

## Task 6: Cron Registration and Latest-Quarter Bootstrap

**Files:**

- Create: `scripts/quarterly-results-backfill.mjs`
- Modify: `scripts/run-cron.mjs`
- Modify: `package.json`
- Modify: `tests/run-cron.test.mjs`
- Create: `tests/quarterly-backfill.test.mjs`

- [ ] **Step 1: Extend failing schedule and bootstrap tests**

Expect the cron registry to include:

```js
['quarterly-results', 'Every 5 minutes', '*/5 * * * *']
```

Test that bootstrap pagination stops as soon as `qe_Date` becomes older than the newest quarter found on page one, while each selected symbol history inserts only the three required period ends.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/run-cron.test.mjs tests/quarterly-backfill.test.mjs`

Expected: FAIL because the job and command are not registered.

- [ ] **Step 3: Add the production job and command**

Add scripts:

```json
{
  "cron:quarterly-results": "node scripts/run-cron.mjs quarterly-results",
  "backfill:quarterly-results": "node scripts/quarterly-results-backfill.mjs"
}
```

Pass the existing direct PostgreSQL pool into `runQuarterlyResultsWorker`. Reuse the existing advisory-lock and `scheduler_log` wrapper.

- [ ] **Step 4: Verify GREEN and cron regression**

Run:

```bash
node --test tests/run-cron.test.mjs tests/quarterly-backfill.test.mjs
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/quarterly-results-backfill.mjs scripts/run-cron.mjs package.json tests/run-cron.test.mjs tests/quarterly-backfill.test.mjs
git commit -m "feat: schedule quarterly results ingestion"
```

## Task 7: Same-Basis Read Model and API

**Files:**

- Create: `quarterly_results.js`
- Create: `quarterly_results_routes.js`
- Modify: `server.js`
- Create: `tests/quarterly-results-api.test.mjs`

- [ ] **Step 1: Write failing read-model tests**

Use a fake pool and route recorder. Cover:

- consolidated current selects consolidated history only;
- missing consolidated history returns null rather than standalone;
- standalone current selects standalone history;
- superseded and non-processed rows are excluded;
- INR-to-crore conversion happens only in the response;
- growth uses stored values;
- search is parameterized;
- sort whitelist rejects arbitrary SQL;
- null growth sorts last;
- stable tiebreaker is `reported_at DESC, symbol ASC`;
- page and limit validation;
- route requires auth.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/quarterly-results-api.test.mjs`

Expected: FAIL because the read service and route do not exist.

- [ ] **Step 3: Implement the read service and route**

Expose this exact read contract:

```text
createQuarterlyResultsService({ dbPool }).list(params) -> paginated response
registerQuarterlyResultsRoutes(app, { auth, service }) -> GET /api/quarterly-results
```

The response item contains:

```js
{
  symbol, companyName, basis, taxonomy, reportedAt,
  periods: { current, previous, priorYear },
  metrics: { revenue, calculatedEbitda, netProfit },
  growth: { revenueQoq, revenueYoy, ebitdaQoq, ebitdaYoy, profitQoq, profitYoy },
  sources: { current, previous, priorYear },
  ebitdaFormula,
}
```

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/quarterly-results-api.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add quarterly_results.js quarterly_results_routes.js server.js tests/quarterly-results-api.test.mjs
git commit -m "feat: expose quarterly results API"
```

## Task 8: Minimal Quarterly Results Page

**Files:**

- Create: `public/quarterly-results.html`
- Create: `public/quarterly-results.css`
- Create: `public/quarterly-results.js`
- Create: `tests/quarterly-results-page.test.mjs`

- [ ] **Step 1: Write failing page contract tests**

Assert:

- source banner names NSE API, NSE XBRL, historical XBRLs, and calculated EBITDA;
- search input exists;
- only the three approved sort options exist;
- result rendering includes current/previous/prior-year columns;
- each company includes its exact source link;
- calculated EBITDA has hover, focus, and tap-accessible explanation;
- frontend network code contains only the BoardroomX endpoint and no `nseindia.com` request;
- mobile table can scroll horizontally without clipping.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/quarterly-results-page.test.mjs`

Expected: FAIL because the page files do not exist.

- [ ] **Step 3: Implement the approved page**

Use `authGuard()` and `bxFetch()`. Debounce search by 250 ms, reset to page one on filter changes, and request only:

```text
/api/quarterly-results?q=...&sort=...&order=...&page=...&limit=50
```

Render `N/A` for null values and growth. Do not calculate financial values in the browser.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/quarterly-results-page.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/quarterly-results.html public/quarterly-results.css public/quarterly-results.js tests/quarterly-results-page.test.mjs
git commit -m "feat: add quarterly results page"
```

## Task 9: Navigation Integration

**Files:**

- Modify: `public/index.html`
- Modify: `public/annuals.html`
- Modify: `public/mutual-funds.html`
- Modify: `tests/quarterly-results-page.test.mjs`

- [ ] **Step 1: Add failing navigation assertions**

Assert that each primary page links to `/quarterly-results.html` with label `Quarterly Results`, and that the new page marks the tab active.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/quarterly-results-page.test.mjs`

Expected: FAIL because existing pages do not contain the tab.

- [ ] **Step 3: Add the navigation item without changing unrelated layout**

Use the existing header markup and responsive behavior.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/quarterly-results-page.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/annuals.html public/mutual-funds.html tests/quarterly-results-page.test.mjs
git commit -m "feat: link quarterly results navigation"
```

## Task 10: Five-Company Reconciliation Gate

**Files:**

- Create: `scripts/reconcile-quarterly-results.mjs`
- Create: `tests/quarterly-reconciliation.test.mjs`

- [ ] **Step 1: Write failing reconciliation tests**

The script accepts a database repository and source client, checks SBI, HINDALCO, ONGC, CASTROLIND, and RITES, and exits non-zero when any stored current/previous/prior-year value or source URL differs from parsing the referenced XBRL.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/quarterly-reconciliation.test.mjs`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement deterministic comparison output**

Print one line per symbol/period/metric with `PASS`, `MISSING`, or `MISMATCH`. Do not repair data in this command.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/quarterly-reconciliation.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/reconcile-quarterly-results.mjs tests/quarterly-reconciliation.test.mjs
git commit -m "test: add quarterly source reconciliation gate"
```

## Task 11: Local Verification

**Files:** none

- [ ] **Step 1: Run focused tests**

```bash
node --test \
  tests/quarterly-migration.test.mjs \
  tests/quarter-periods.test.mjs \
  tests/quarterly-xbrl.test.mjs \
  tests/quarterly-source.test.mjs \
  tests/quarterly-worker.test.mjs \
  tests/quarterly-backfill.test.mjs \
  tests/quarterly-results-api.test.mjs \
  tests/quarterly-results-page.test.mjs \
  tests/quarterly-reconciliation.test.mjs \
  tests/run-cron.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run full regression suite**

Run: `npm test`

Expected: all PASS with no new warnings.

- [ ] **Step 3: Run static checks**

```bash
git diff --check
node --check quarterly_results.js
node --check quarterly_results_routes.js
node --check scripts/quarterly-results-worker.mjs
node --check scripts/quarterly-results-backfill.mjs
node --check public/quarterly-results.js
```

Expected: all commands exit 0.

- [ ] **Step 4: Render and inspect desktop/mobile page**

Start the server, open `/quarterly-results.html`, and verify desktop and narrow mobile widths with Playwright screenshots. Confirm tooltip keyboard focus and no horizontal page overflow outside the result table.

## Task 12: Staging Migration and Live NSE Validation

**Files:** none

- [ ] **Step 1: Review current Supabase changelog and relevant RLS/migration documentation**

Required before database mutation by the Supabase workflow.

- [ ] **Step 2: Apply only migration 023 to staging**

Verify columns, checks, indexes, RLS, and grants with read-only catalog queries.

- [ ] **Step 3: Run the latest-quarter bootstrap**

Run: `npm run backfill:quarterly-results`

Expected: active-universe current filings plus only their required same-basis comparison filings are stored.

- [ ] **Step 4: Prove idempotency**

Run the bootstrap and cron again. Assert:

- row count unchanged;
- processed XBRL request count is zero;
- no duplicate `nse_seq_id` exists;
- scheduler log records success.

- [ ] **Step 5: Run five-company reconciliation**

Run: `node scripts/reconcile-quarterly-results.mjs`

Expected: every required available value and source reports PASS; any mismatch blocks deployment.

- [ ] **Step 6: Exercise the staging API and page**

Verify default ordering, search, both growth sorts, both sort directions, pagination, source links, consolidated selection, and `N/A` behavior.

## Task 13: Railway Deployment and Production Gates

**Files:** none

- [ ] **Step 1: Deploy the database-compatible web build**

Confirm the existing service health before and after deployment.

- [ ] **Step 2: Configure the Railway cron**

Command:

```text
npm run cron:quarterly-results
```

Schedule:

```text
*/5 * * * *
```

Use the existing Supabase variables; add no new secret.

- [ ] **Step 3: Run production smoke checks**

Verify:

- page loads through authenticated BoardroomX;
- API reads only the database;
- source links open official NSE XBRLs;
- SBI banking mapping matches the regression value;
- Hindalco and ONGC formulas match fixtures;
- duplicate cron run changes no processed rows;
- scheduler log shows the new job;
- no existing cron or application test regressed.

- [ ] **Step 4: Observe at least two scheduled five-minute runs**

Both must finish successfully or skip through the advisory lock. Any parse mismatch, duplicate write, unbounded retry, or mixed-basis comparison blocks go-live completion.

- [ ] **Step 5: Commit deployment documentation only if runtime configuration files changed**

Do not create configuration churn when Railway stores the schedule externally.
