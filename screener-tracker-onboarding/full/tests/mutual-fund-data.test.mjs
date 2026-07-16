import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const manifestUrl = new URL('../data/mutual-funds/fund-universe.json', import.meta.url);
const valueResearchFactsUrl = new URL('../data/mutual-funds/value-research/fund-facts.json', import.meta.url);
const publicValueResearchFactsUrl = new URL('../public/data/mutual-funds/fund-facts.json', import.meta.url);
const navSummaryUrl = new URL('../data/mutual-funds/nav-history/nav-history-summary.json', import.meta.url);
const publicNavSummaryUrl = new URL('../public/data/mutual-funds/nav-history/nav-history-summary.json', import.meta.url);
const execFileAsync = promisify(execFile);

test('fund universe contains only the three approved funds and benchmark proxy', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

  assert.equal(manifest.schema_version, '1.0');
  assert.equal(manifest.instruments.length, 4);
  assert.deepEqual(
    manifest.instruments.map(({ fund_key }) => fund_key),
    ['bandhan-small-cap', 'quant-small-cap', 'bank-of-india-small-cap', 'nippon-smallcap-250-proxy'],
  );

  const expected = [
    ['Bandhan Small Cap Fund - Direct Plan', 'fund', 'Bandhan Mutual Fund', '147946', '40564', 'https://www.valueresearchonline.com/funds/40564/bandhan-small-cap-fund-direct-plan/'],
    ['Quant Small Cap Fund - Direct Plan', 'fund', 'Quant Mutual Fund', '120828', '17366', 'https://www.valueresearchonline.com/funds/17366/quant-small-cap-fund-direct-plan/'],
    ['Bank of India Small Cap Fund - Direct Plan', 'fund', 'Bank of India Mutual Fund', '145678', '38283', 'https://www.valueresearchonline.com/funds/38283/bank-of-india-small-cap-fund-direct-plan/'],
  ];

  for (const [displayName, role, amc, mfapiCode, valueResearchId, canonicalUrl] of expected) {
    const instrument = manifest.instruments.find((entry) => entry.display_name === displayName);
    assert.ok(instrument, `missing ${displayName}`);
    assert.equal(instrument.role, role);
    assert.equal(instrument.amc, amc);
    assert.equal(instrument.plan, 'Direct');
    assert.equal(instrument.option, 'Growth');
    assert.equal(instrument.mfapi_scheme_code, mfapiCode);
    assert.deepEqual(instrument.source_identity, {
      provider: 'Value Research',
      fund_id: valueResearchId,
      canonical_url: canonicalUrl,
      displayed_scheme_name: displayName,
      displayed_nav_option: 'NAV-Growth',
    });
  }
});

test('fund universe enforces unique identifiers and the approved structural contract', async () => {
  const { instruments } = JSON.parse(await readFile(manifestUrl, 'utf8'));

  assert.equal(instruments.filter(({ role }) => role === 'fund').length, 3);
  assert.equal(instruments.filter(({ role }) => role === 'benchmark_proxy').length, 1);
  assert.equal(new Set(instruments.map(({ fund_key }) => fund_key)).size, instruments.length);
  assert.equal(new Set(instruments.map(({ mfapi_scheme_code }) => mfapi_scheme_code)).size, instruments.length);

  for (const instrument of instruments) {
    for (const field of ['fund_key', 'display_name', 'amc', 'plan', 'option', 'mfapi_scheme_code']) {
      assert.equal(typeof instrument[field], 'string', `${instrument.fund_key}.${field} must be a string`);
      assert.notEqual(instrument[field].trim(), '', `${instrument.fund_key}.${field} must not be empty`);
    }
    assert.ok(['fund', 'benchmark_proxy'].includes(instrument.role));
    assert.equal(instrument.plan, 'Direct');
    assert.equal(instrument.option, 'Growth');
    assert.equal(typeof instrument.source_identity, 'object');
    assert.equal(Array.isArray(instrument.source_identity), false);
    assert.ok(['Value Research', 'MFAPI'].includes(instrument.source_identity.provider));

    if (instrument.role === 'fund') {
      assert.match(instrument.source_identity.fund_id, /^\d+$/);
      const sourceUrl = new URL(instrument.source_identity.canonical_url);
      assert.equal(sourceUrl.protocol, 'https:');
      assert.equal(sourceUrl.hostname, 'www.valueresearchonline.com');
      assert.match(sourceUrl.pathname, new RegExp(`^/funds/${instrument.source_identity.fund_id}/`));
      assert.equal(typeof instrument.source_identity.displayed_scheme_name, 'string');
      assert.equal(instrument.source_identity.displayed_nav_option, 'NAV-Growth');
    } else {
      assert.equal(instrument.source_identity.mfapi_scheme_code, instrument.mfapi_scheme_code);
    }
  }
});

test('manifest records dated provider-level provenance and acquisition methods', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

  assert.equal(manifest.provenance.verified_at, '2026-07-12');
  assert.equal(manifest.provenance.sources.length, 2);
  const valueResearch = manifest.provenance.sources.find(({ provider }) => provider === 'Value Research');
  const mfapi = manifest.provenance.sources.find(({ provider }) => provider === 'MFAPI');
  assert.deepEqual(valueResearch.source_urls, [
    'https://www.valueresearchonline.com/funds/40564/bandhan-small-cap-fund-direct-plan/',
    'https://www.valueresearchonline.com/funds/17366/quant-small-cap-fund-direct-plan/',
    'https://www.valueresearchonline.com/funds/38283/bank-of-india-small-cap-fund-direct-plan/',
  ]);
  assert.deepEqual(mfapi.source_urls, ['https://api.mfapi.in/mf']);
  for (const source of [valueResearch, mfapi]) {
    assert.equal(typeof source.method_note, 'string');
    assert.notEqual(source.method_note.trim(), '');
  }
});

test('benchmark is explicitly a fund proxy and has no unverified Value Research identity', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const benchmark = manifest.instruments.find(({ role }) => role === 'benchmark_proxy');

  assert.ok(benchmark);
  assert.equal(benchmark.display_name, 'Nippon India Nifty Smallcap 250 Index Fund - Direct Plan');
  assert.equal(benchmark.amc, 'Nippon India Mutual Fund');
  assert.equal(benchmark.plan, 'Direct');
  assert.equal(benchmark.option, 'Growth');
  assert.equal(benchmark.mfapi_scheme_code, '148519');
  assert.equal(benchmark.source_identity.provider, 'MFAPI');
  assert.equal(benchmark.source_identity.mfapi_scheme_code, '148519');
  assert.equal(Object.hasOwn(benchmark.source_identity, 'value_research_fund_id'), false);
  assert.match(benchmark.proxy_description, /fund proxy/i);
  assert.match(benchmark.caveat, /not (?:the )?actual.*TRI/i);
});

test('MFAPI identifiers are labelled as MFAPI scheme codes, not official AMFI codes', async () => {
  const raw = await readFile(manifestUrl, 'utf8');
  assert.doesNotMatch(raw, /official_amfi|amfi_scheme_code/i);
});

test('Value Research facts are deterministic overview records for the three approved funds', async () => {
  const facts = JSON.parse(await readFile(valueResearchFactsUrl, 'utf8'));

  assert.equal(facts.schema_version, '1.0');
  assert.equal(facts.provider, 'Value Research');
  assert.equal(facts.records.length, 3);
  assert.deepEqual(
    facts.records.map((record) => record.identity.fund_key),
    ['bandhan-small-cap', 'quant-small-cap', 'bank-of-india-small-cap'],
  );

  for (const record of facts.records) {
    assert.equal(record.source.provider, 'Value Research');
    assert.equal(record.source.tabs_captured.length, 1);
    assert.equal(record.source.tabs_captured[0], 'overview');
    assert.match(record.source.raw_sha256[0], /^[a-f0-9]{64}$/);
    assert.match(record.source.canonical_sha256, /^[a-f0-9]{64}$/);
    assert.equal(record.quality.identity_match, true);
    assert.equal(record.quality.audit_ready, true);
    assert.equal(record.quality.holdings_completeness, 'unknown');
    assert.equal(record.portfolio.holdings_completeness, 'unknown');
    assert.equal(record.dates.nav_as_of, '2026-07-15');
    assert.equal(record.fund_details.nav.unit, 'INR');
    assert.equal(record.fund_details.aum.unit, 'Crore INR');
    assert.equal(record.costs_and_investment.expense_ratio.unit, 'Percent');
    assert.ok(record.performance.point_to_point.length >= 3);
    assert.ok(record.missing_fields.includes('portfolio.holdings'));
    assert.match(record.warnings.join(' '), /holdings completeness is unknown/i);
  }
});

test('public Value Research facts expose only compact UI-safe fields', async () => {
  const publicFacts = JSON.parse(await readFile(publicValueResearchFactsUrl, 'utf8'));

  assert.equal(publicFacts.provider, 'Value Research');
  assert.equal(publicFacts.funds.length, 3);
  assert.match(publicFacts.retrieval_note, /JSON-LD/i);
  for (const fund of publicFacts.funds) {
    assert.match(fund.fund_id, /^\d+$/);
    assert.equal(fund.nav.as_of, '2026-07-15');
    assert.equal(typeof fund.aum.parsed_value, 'number');
    assert.equal(typeof fund.expense_ratio.parsed_value, 'number');
    assert.equal(fund.portfolio_status, 'unknown');
    assert.equal(fund.manager, null);
    assert.equal(fund.turnover, null);
  }
});

test('Value Research parser is idempotent for the cached raw evidence', async () => {
  const beforePrivate = await readFile(valueResearchFactsUrl, 'utf8');
  const beforePublic = await readFile(publicValueResearchFactsUrl, 'utf8');

  await execFileAsync('python3', ['scripts/mutual-funds/parse_value_research.py'], {
    cwd: new URL('..', import.meta.url),
  });

  assert.equal(await readFile(valueResearchFactsUrl, 'utf8'), beforePrivate);
  assert.equal(await readFile(publicValueResearchFactsUrl, 'utf8'), beforePublic);
});

test('MFAPI NAV history is stored since inception for every approved instrument', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const summary = JSON.parse(await readFile(navSummaryUrl, 'utf8'));

  assert.equal(summary.schema_version, '1.0');
  assert.equal(summary.provider, 'MFAPI');
  assert.equal(summary.funds.length, manifest.instruments.length);

  for (const instrument of manifest.instruments) {
    const summaryRow = summary.funds.find((row) => row.fund_key === instrument.fund_key);
    assert.ok(summaryRow, `missing NAV summary for ${instrument.fund_key}`);
    assert.equal(summaryRow.mfapi_scheme_code, instrument.mfapi_scheme_code);
    assert.equal(summaryRow.status, 'SUCCESS');
    assert.match(summaryRow.first_nav_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(summaryRow.latest_nav_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(summaryRow.nav_count > 500, `${instrument.fund_key} should have meaningful NAV history`);
    assert.equal(summaryRow.duplicate_dates, 0);

    const historyUrl = new URL(`../data/mutual-funds/nav-history/${instrument.fund_key}.json`, import.meta.url);
    const history = JSON.parse(await readFile(historyUrl, 'utf8'));
    assert.equal(history.schema_version, '1.0');
    assert.equal(history.source.provider, 'MFAPI');
    assert.equal(history.identity.fund_key, instrument.fund_key);
    assert.equal(history.identity.mfapi_scheme_code, instrument.mfapi_scheme_code);
    assert.equal(history.nav_history.length, summaryRow.nav_count);
    assert.equal(history.quality.sorted_ascending, true);
    assert.equal(history.quality.duplicate_dates, 0);
    assert.equal(history.nav_history[0].date, summaryRow.first_nav_date);
    assert.equal(history.nav_history.at(-1).date, summaryRow.latest_nav_date);

    let previousDate = '';
    for (const point of history.nav_history) {
      assert.match(point.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(point.date > previousDate, `${instrument.fund_key} dates must be strictly ascending`);
      assert.equal(typeof point.nav, 'number');
      assert.ok(point.nav > 0, `${instrument.fund_key} NAV must be positive`);
      assert.match(point.nav_raw, /^\d+(\.\d+)?$/);
      previousDate = point.date;
    }
  }
});

test('public MFAPI NAV summary mirrors private summary without full series duplication', async () => {
  const privateSummary = JSON.parse(await readFile(navSummaryUrl, 'utf8'));
  const publicSummary = JSON.parse(await readFile(publicNavSummaryUrl, 'utf8'));

  assert.deepEqual(publicSummary, privateSummary);
  assert.doesNotMatch(await readFile(publicNavSummaryUrl, 'utf8'), /nav_history/);
});
