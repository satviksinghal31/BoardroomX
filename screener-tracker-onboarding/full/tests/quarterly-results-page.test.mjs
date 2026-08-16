import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const readPublic = (name) => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

async function loadFrontendHelpers() {
  const js = await readPublic('quarterly-results.js');
  const context = {
    AbortController,
    URLSearchParams,
    authGuard() {},
    bxFetch() { throw new Error('Unexpected request'); },
    document: { addEventListener() {} },
    globalThis: null,
  };
  context.globalThis = context;
  vm.runInNewContext(`${js}\n;globalThis.__helpers = { initialState, requestParamsFor, stateAfterQuarterChange, stateAfterFilterRemoval, clearedState, filterChipsFor, emptyResultsMessage, toggleFilterPanel, shouldClearResultsOnFailure, marketCapValidationError };`, context);
  return context.__helpers;
}

async function loadFrontendRuntime() {
  const js = await readPublic('quarterly-results.js');
  const context = {
    AbortController,
    URLSearchParams,
    authGuard() {},
    document: { addEventListener() {} },
    fetchImpl: null,
    globalThis: null,
  };
  context.globalThis = context;
  context.bxFetch = (...args) => context.fetchImpl(...args);
  vm.runInNewContext(`${js}\n;globalThis.__runtime = {
    state,
    loadResults,
    renderMeta,
    requestParamsFor,
    stateAfterQuarterChange,
    setElements(next) { Object.assign(els, next); },
    setRendered(value) { hasRendered = value; },
  };`, context);
  return { context, runtime: context.__runtime };
}

function fakeElement(overrides = {}) {
  return {
    hidden: true,
    innerHTML: '',
    textContent: '',
    disabled: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function apiResponse(label) {
  return {
    ok: true,
    async json() {
      return {
        items: [],
        meta: {
          activeQuarter: '2026-06-30', activeQuarterLabel: label,
          quarters: [{ periodEnd: '2026-06-30', label, companies: 1 }],
          reportedDates: [], watchlistCompanies: 0,
        },
        pagination: { total: 0, page: 1, totalPages: 0 },
      };
    },
  };
}

test('quarterly page states its exact source and exposes only approved controls', async () => {
  const html = await readPublic('quarterly-results.html');
  assert.match(html, /NSE India Integrated Filing API/i);
  assert.match(html, /NSE XBRL/i);
  assert.match(html, /historical NSE XBRL/i);
  assert.match(html, /calculated EBITDA/i);
  assert.match(html, /id="quarterlySearch"/);
  const options = [...html.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(options, ['reported_at', 'revenue_yoy', 'profit_yoy', 'desc', 'asc']);
  assert.match(html, /id="quarterlyResults"/);
});

test('quarterly page provides the accessible quarter strip and single responsive filter panel', async () => {
  const html = await readPublic('quarterly-results.html');
  assert.match(html, /id="quarterlyHeading"/);
  assert.match(html, /id="quarterlyQuarters"/);
  assert.match(html, /id="quarterlyFilterToggle"[^>]*aria-expanded="false"[^>]*aria-controls="quarterlyFilters"/);
  assert.equal((html.match(/id="quarterlyFilters"/g) || []).length, 1);
  assert.match(html, /id="quarterlyFilterChips"/);
  assert.match(html, /id="quarterlyClearFilters"/);
});

test('search and applied chips live in the left results column instead of spanning the filter rail', async () => {
  const html = await readPublic('quarterly-results.html');
  const content = html.indexOf('<div class="quarterly-content">');
  const left = html.indexOf('<div class="quarterly-results-column">', content);
  const search = html.indexOf('id="quarterlySearch"', content);
  const chips = html.indexOf('id="quarterlyFilterChips"', content);
  const results = html.indexOf('id="quarterlyResults"', content);
  const filters = html.indexOf('id="quarterlyFilters"', content);
  assert.ok(content < left && left < search && search < chips && chips < results && results < filters);
});

test('frontend uses only the BoardroomX API and renders all three periods and sources', async () => {
  const js = await readPublic('quarterly-results.js');
  assert.match(js, /authGuard\(\)/);
  assert.match(js, /bxFetch\(`\/api\/quarterly-results\?/);
  assert.doesNotMatch(js, /nseindia\.com/i);
  assert.match(js, /periods\.current/);
  assert.match(js, /periods\.previous/);
  assert.match(js, /periods\.priorYear/);
  assert.match(js, /sources\.current/);
  assert.match(js, /N\/A/);
  assert.match(js, /250/);
});

test('frontend state and requests cover every approved filter with a 25 item page', async () => {
  const js = await readPublic('quarterly-results.js');
  for (const field of ['q', 'quarter', 'reportedDate', 'watchlist', 'marketCapBucket', 'marketCapMin', 'marketCapMax', 'sort', 'order', 'page']) {
    assert.match(js, new RegExp(`\\b${field}:`));
  }
  assert.match(js, /limit:\s*25/);
  for (const param of ['quarter', 'reported_date', 'watchlist', 'market_cap_bucket', 'market_cap_min', 'market_cap_max']) {
    assert.match(js, new RegExp(`params\\.set\\('${param}'`));
  }
});

test('state helpers serialize exact params and enforce quarter, chip, and Clear all transitions', async () => {
  const helpers = await loadFrontendHelpers();
  const populated = {
    ...helpers.initialState(),
    q: 'bank', quarter: '2026-06-30', reportedDate: '2026-08-15', watchlist: true,
    marketCapMin: '50', marketCapMax: '500', sort: 'profit_yoy', order: 'asc', page: 4,
  };
  assert.deepEqual(Object.fromEntries(helpers.requestParamsFor(populated)), {
    q: 'bank', sort: 'profit_yoy', order: 'asc', page: '4', limit: '25',
    quarter: '2026-06-30', reported_date: '2026-08-15', watchlist: 'true',
    market_cap_min: '50', market_cap_max: '500',
  });

  const changedQuarter = helpers.stateAfterQuarterChange(populated, '2026-03-31');
  assert.equal(changedQuarter.quarter, '2026-03-31');
  assert.equal(changedQuarter.reportedDate, '');
  assert.equal(changedQuarter.page, 1);
  assert.equal(changedQuarter.q, 'bank');
  assert.equal(changedQuarter.watchlist, true);

  const removedQuarter = helpers.stateAfterFilterRemoval(populated, 'quarter');
  assert.equal(removedQuarter.quarter, '');
  assert.equal(removedQuarter.reportedDate, '');
  assert.equal(removedQuarter.page, 1);
  assert.equal(removedQuarter.q, 'bank');
  const removedMarketCap = helpers.stateAfterFilterRemoval(populated, 'marketCap');
  assert.equal(removedMarketCap.marketCapBucket, '');
  assert.equal(removedMarketCap.marketCapMin, '');
  assert.equal(removedMarketCap.marketCapMax, '');
  assert.equal(removedMarketCap.reportedDate, '2026-08-15');
  const removedSearch = helpers.stateAfterFilterRemoval(populated, 'q');
  assert.equal(removedSearch.q, '');
  assert.equal(removedSearch.quarter, '2026-06-30');
  assert.equal(removedSearch.page, 1);
  const removedDate = helpers.stateAfterFilterRemoval(populated, 'reportedDate');
  assert.equal(removedDate.reportedDate, '');
  assert.equal(removedDate.quarter, '2026-06-30');
  const removedWatchlist = helpers.stateAfterFilterRemoval(populated, 'watchlist');
  assert.equal(removedWatchlist.watchlist, false);
  assert.equal(removedWatchlist.q, 'bank');
  const removedSorting = helpers.stateAfterFilterRemoval(populated, 'sorting');
  assert.equal(removedSorting.sort, 'reported_at');
  assert.equal(removedSorting.order, 'desc');
  assert.equal(removedSorting.reportedDate, '2026-08-15');

  assert.deepEqual(helpers.clearedState(), helpers.initialState());
});

test('selecting latest clears the quarter pin and follows a later metadata rollover', async () => {
  const { runtime } = await loadFrontendRuntime();
  const elements = {
    heading: fakeElement(), quarters: fakeElement(), reportedDates: fakeElement(),
    watchlistLabel: fakeElement(),
  };
  runtime.setElements(elements);
  const pinned = {
    ...runtime.state,
    quarter: '2026-03-31', reportedDate: '2026-08-15', page: 4, q: 'bank', watchlist: true,
  };
  const selectedLatest = runtime.stateAfterQuarterChange(pinned, '2026-06-30', '2026-06-30');
  assert.equal(selectedLatest.quarter, '');
  assert.equal(selectedLatest.reportedDate, '');
  assert.equal(selectedLatest.page, 1);
  assert.equal(selectedLatest.q, 'bank');
  assert.equal(selectedLatest.watchlist, true);
  assert.equal(runtime.requestParamsFor(selectedLatest).has('quarter'), false);

  Object.assign(runtime.state, selectedLatest);
  runtime.renderMeta({
    activeQuarter: '2026-09-30', activeQuarterLabel: 'September 2026', watchlistCompanies: 0,
    quarters: [
      { periodEnd: '2026-09-30', label: 'September 2026', companies: 10 },
      { periodEnd: '2026-06-30', label: 'June 2026', companies: 9 },
    ],
    reportedDates: [],
  });
  assert.equal(elements.heading.textContent, 'September 2026 quarterly results');
  assert.match(elements.quarters.innerHTML, /data-quarter="2026-09-30" aria-pressed="true"/);
  assert.doesNotMatch(elements.quarters.innerHTML, /data-quarter="2026-06-30" aria-pressed="true"/);
  const js = await readPublic('quarterly-results.js');
  assert.match(js, /stateAfterQuarterChange\(state, quarterButton\.dataset\.quarter, latestMeta\?\.quarters\?\.\[0\]\?\.periodEnd\)/);
  assert.match(js, /state\.quarter \|\| latestMeta\.quarters\?\.\[0\]\?\.periodEnd \|\| latestMeta\.activeQuarter/);
});

test('refreshes abort stale requests, preserve rendered cards, and expose retry feedback', async () => {
  const js = await readPublic('quarterly-results.js');
  assert.match(js, /new AbortController\(\)/);
  assert.match(js, /activeRequest\.abort\(\)/);
  assert.match(js, /sequence !== requestSequence/);
  assert.match(js, /signal:\s*controller\.signal/);
  assert.match(js, /if \(!hasRendered\) els\.results\.innerHTML/);
  assert.doesNotMatch(js, /els\.results\.innerHTML\s*=\s*'';\s*els\.error\.textContent/);
  assert.match(js, /data-retry-results/);
  assert.match(js, /aria-busy/);
});

test('loadResults aborts and invalidates stale responses while preserving rendered cards on refresh failure', async () => {
  const { context, runtime } = await loadFrontendRuntime();
  const elements = {
    error: fakeElement(), busy: fakeElement(), results: fakeElement(),
    heading: fakeElement(), quarters: fakeElement(), reportedDates: fakeElement(),
    watchlistLabel: fakeElement(), chips: fakeElement(), clearFilters: fakeElement(),
    count: fakeElement(), page: fakeElement(), previous: fakeElement(), next: fakeElement(),
  };
  runtime.setElements(elements);

  const first = deferred();
  let firstSignal;
  let calls = 0;
  context.fetchImpl = (_url, options) => {
    calls += 1;
    if (calls === 1) {
      firstSignal = options.signal;
      return first.promise;
    }
    return Promise.resolve(apiResponse('Second quarter'));
  };
  const firstLoad = runtime.loadResults();
  const secondLoad = runtime.loadResults();
  await secondLoad;
  assert.equal(firstSignal.aborted, true);
  assert.equal(elements.heading.textContent, 'Second quarter quarterly results');

  first.resolve(apiResponse('Stale first quarter'));
  await firstLoad;
  assert.equal(elements.heading.textContent, 'Second quarter quarterly results');

  runtime.setRendered(true);
  elements.results.innerHTML = '<article class="quarterly-card">Keep me</article>';
  context.fetchImpl = () => Promise.reject(new Error('Refresh failed'));
  await runtime.loadResults();
  assert.equal(elements.results.innerHTML, '<article class="quarterly-card">Keep me</article>');
  assert.match(elements.error.innerHTML, /Refresh failed[\s\S]*data-retry-results/);
  assert.equal(elements.error.hidden, false);
});

test('UI helpers keep chips immediate, distinguish empty watchlists, toggle mobile state, and preserve old cards', async () => {
  const helpers = await loadFrontendHelpers();
  const searched = { ...helpers.initialState(), q: 'tata' };
  assert.deepEqual(Array.from(helpers.filterChipsFor(searched), (chip) => [chip[0], chip[1]]), [['q', 'Search: tata']]);
  assert.equal(
    helpers.emptyResultsMessage({ ...searched, watchlist: true }, { watchlistCompanies: 0 }, { total: 0 }),
    'Your watchlist is empty. Add companies to see their quarterly results here.',
  );
  assert.equal(
    helpers.emptyResultsMessage({ ...searched, watchlist: true }, { watchlistCompanies: 14 }, { total: 0 }),
    'No watchlist companies match the selected filters.',
  );
  const emptyQuarterMeta = {
    activeQuarter: '2026-06-30', activeQuarterLabel: 'June 2026', watchlistCompanies: 0,
    quarters: [{ periodEnd: '2026-03-31', companies: 20 }],
  };
  assert.equal(
    helpers.emptyResultsMessage(helpers.initialState(), emptyQuarterMeta, { total: 0 }),
    'No results are available for June 2026.',
  );
  assert.equal(
    helpers.emptyResultsMessage(searched, emptyQuarterMeta, { total: 0 }),
    'No matching quarterly results.',
  );
  assert.equal(
    helpers.emptyResultsMessage({ ...helpers.initialState(), reportedDate: '2026-08-15' }, emptyQuarterMeta, { total: 0 }),
    'No matching quarterly results.',
  );
  assert.equal(
    helpers.emptyResultsMessage({ ...helpers.initialState(), marketCapBucket: 'under_50' }, emptyQuarterMeta, { total: 0 }),
    'No matching quarterly results.',
  );
  assert.equal(
    helpers.emptyResultsMessage({ ...helpers.initialState(), marketCapMin: '50' }, emptyQuarterMeta, { total: 0 }),
    'No matching quarterly results.',
  );
  assert.equal(
    helpers.emptyResultsMessage(helpers.initialState(), { ...emptyQuarterMeta, quarters: [{ periodEnd: '2026-06-30', companies: 1 }] }, { total: 0 }),
    'No matching quarterly results.',
  );
  const classes = new Set();
  const panel = {
    classList: {
      contains(name) { return classes.has(name); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
    },
  };
  const toggle = fakeElement();
  assert.equal(helpers.toggleFilterPanel(panel, toggle), true);
  assert.equal(classes.has('open'), true);
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  assert.equal(helpers.toggleFilterPanel(panel, toggle), false);
  assert.equal(classes.has('open'), false);
  assert.equal(toggle.attributes['aria-expanded'], 'false');
  assert.equal(helpers.shouldClearResultsOnFailure(false), true);
  assert.equal(helpers.shouldClearResultsOnFailure(true), false);

  const js = await readPublic('quarterly-results.js');
  assert.match(js, /state\.q = els\.search\.value\.trim\(\);\s*filterChanged\(\);/s);
  assert.match(js, /function filterChanged\(\)\s*\{[^}]*renderChips\(\);[^}]*loadResults\(\);/s);
  assert.match(js, /toggleFilterPanel\(els\.filters, els\.filterToggle\)/);
  assert.match(js, /shouldClearResultsOnFailure\(hasRendered\)/);
});

test('source and facet labels identify their exact data provenance and presentation', async () => {
  const [html, js] = await Promise.all([readPublic('quarterly-results.html'), readPublic('quarterly-results.js')]);
  assert.match(html, /Financial values and filing timestamps[^.]*NSE India Integrated Filing API and NSE XBRL/i);
  assert.match(html, /Market cap filters use the latest stored NSE EOD market-cap data/i);
  assert.match(html, /Watchlist filters use BoardroomX user state/i);
  assert.match(html, /> All market caps</);
  assert.match(js, /\$\{esc\(item\.label\)\} — \$\{Number\(item\.companies\)\.toLocaleString\('en-IN'\)\} companies/);
});

test('custom market-cap bounds match API precision and maximum before requests', async () => {
  const [html, helpers] = await Promise.all([readPublic('quarterly-results.html'), loadFrontendHelpers()]);
  const customInputs = [...html.matchAll(/id="quarterlyMarketCap(?:Min|Max)"[^>]+/g)].map((match) => match[0]);
  assert.equal(customInputs.length, 2);
  for (const input of customInputs) {
    assert.match(input, /min="0"/);
    assert.match(input, /max="100000000"/);
    assert.match(input, /step="0\.01"/);
  }
  assert.equal(helpers.marketCapValidationError('0', '100000000'), '');
  assert.equal(helpers.marketCapValidationError('50.25', ''), '');
  assert.match(helpers.marketCapValidationError('0.001', '50'), /2 decimal places/);
  assert.match(helpers.marketCapValidationError('0', '100000000.01'), /100,000,000/);
  assert.match(helpers.marketCapValidationError('-1', '50'), /0–100,000,000/);
  assert.match(helpers.marketCapValidationError('51', '50'), /minimum no greater than maximum/);
  assert.match(helpers.marketCapValidationError('', ''), /Enter at least one/);
});

test('local control synchronization clears stale reported-date and quarter selections before refresh succeeds', async () => {
  const js = await readPublic('quarterly-results.js');
  assert.match(js, /querySelectorAll\('\[name="quarterlyReportedDate"\]'\)[\s\S]*input\.checked = input\.value === state\.reportedDate/);
  assert.match(js, /latestMeta\.activeQuarter/);
  assert.match(js, /querySelectorAll\('\[data-quarter\]'\)[\s\S]*setAttribute\('aria-pressed'/);
  assert.match(js, /function filterChanged\(\)\s*\{[^}]*syncControls\(\);[^}]*renderChips\(\);/s);
});

test('metadata drives heading, quarter/date counts, watchlist count, chips, and validated custom caps', async () => {
  const [html, js] = await Promise.all([
    readPublic('quarterly-results.html'),
    readPublic('quarterly-results.js'),
  ]);
  assert.match(js, /activeQuarterLabel} quarterly results/);
  assert.match(js, /meta\.quarters/);
  assert.match(js, /meta\.reportedDates/);
  assert.match(js, /b\.date\.localeCompare\(a\.date\)/);
  assert.match(js, /item\.companies/);
  assert.match(js, /meta\.watchlistCompanies/);
  assert.match(js, /data-remove-filter/);
  assert.match(js, /clearAllFilters/);
  for (const label of ['All reporting dates', 'All companies', 'My watchlist', 'Under ₹50 Cr', '₹50–&lt;₹500 Cr', '₹500–&lt;₹5,000 Cr', '₹5,000 Cr and above', 'Custom min/max crore']) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /₹0–50 crore|₹50–500 crore|₹500–5,000 crore|₹5,000 crore and above/);
  assert.doesNotMatch(`${html}\n${js}`, /Industry|Turnaround|TTM PE|Qtr PE/i);
});

test('calculated EBITDA explanation is keyboard/tap accessible and tables scroll on mobile', async () => {
  const [html, css, js] = await Promise.all([
    readPublic('quarterly-results.html'),
    readPublic('quarterly-results.css'),
    readPublic('quarterly-results.js'),
  ]);
  assert.match(html, /data-ebitda-info/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(js, /aria-expanded/);
  assert.match(css, /\.quarterly-table-wrap[\s\S]*overflow-x:\s*auto/i);
  assert.match(css, /:hover[\s\S]*\.ebitda-tooltip|:focus/i);
});

test('filters use a sticky 280px desktop rail and the same panel becomes mobile-toggleable', async () => {
  const css = await readPublic('quarterly-results.css');
  assert.match(css, /\.quarterly-content\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+280px/s);
  assert.match(css, /\.quarterly-filters\s*\{[^}]*position:\s*sticky[^}]*top:/s);
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*\.quarterly-filters\s*\{[^}]*display:\s*none/s);
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*\.quarterly-filters\.open\s*\{[^}]*display:\s*block/s);
  assert.match(css, /\.quarterly-filter-toggle/);
});

test('primary pages link the Quarterly Results navigation tab', async () => {
  const [index, annuals, quarterly] = await Promise.all([
    readPublic('index.html'),
    readPublic('annuals.html'),
    readPublic('quarterly-results.html'),
  ]);
  for (const html of [index, annuals, quarterly]) {
    assert.match(html, /href="\/quarterly-results\.html"[^>]*>[\s\S]*?Quarterly Results/i);
  }
  assert.match(quarterly, /class="hdr-nav-item active" href="\/quarterly-results\.html"/);
});
