import assert from 'node:assert/strict';
import test from 'node:test';

import { createQuarterlyResultsService } from '../quarterly_results.js';
import { registerQuarterlyResultsRoutes } from '../quarterly_results_routes.js';
import { todayIstDate } from '../scripts/lib/dhan-time.mjs';

function resultRow(overrides = {}) {
  return {
    symbol: 'ONGC',
    company_name: 'Oil & Natural Gas Corporation Limited',
    basis: 'consolidated',
    taxonomy: 'indas',
    reported_at: '2026-08-04T14:49:05.000Z',
    current_period: new Date(2026, 5, 30),
    previous_period: new Date(2026, 2, 31),
    prior_year_period: null,
    current_revenue: '2049873500000',
    previous_revenue: '1738052000000',
    prior_year_revenue: null,
    current_ebitda: '154853500000',
    previous_ebitda: '253561000000',
    prior_year_ebitda: null,
    current_profit: '65544400000',
    previous_profit: '136779000000',
    prior_year_profit: null,
    current_source: 'https://nsearchives.nseindia.com/corporate/xbrl/current.xml',
    previous_source: 'https://nsearchives.nseindia.com/corporate/xbrl/previous.xml',
    prior_year_source: null,
    ...overrides,
  };
}

function isPaginatedResultQuery(sql) {
  return /FROM sortable[\s\S]*LIMIT\s+\$\d+\s+OFFSET\s+\$\d+/i.test(sql);
}

test('paginated result query does not compute a window total', async () => {
  const calls = [];
  const service = createQuarterlyResultsService({
    dbPool: { async query(sql, params) {
      calls.push({ sql, params });
      if (/count\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: '0' }] };
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  await service.list({ quarter: '2026-06-30' }, { userId: 'user-1' });
  const resultCall = calls.find(({ sql }) => isPaginatedResultQuery(sql));

  assert.doesNotMatch(resultCall.sql, /count\(\*\)\s+OVER\s*\(\)|total_count/i);
});

test('service scopes current and historical rows to exact quarter dates', async () => {
  const calls = [];
  const service = createQuarterlyResultsService({
    dbPool: {
      async query(sql, params) {
        calls.push({ sql, params });
        if (/FROM quarterly_results[\s\S]*GROUP BY period_end/i.test(sql)) return { rows: [] };
        if (/reported_at AT TIME ZONE/i.test(sql)) return { rows: [] };
        if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
        return { rows: [resultRow()] };
      },
    },
  });

  const response = await service.list({ quarter: '2026-06-30' }, { userId: 'user-1' });
  const resultCall = calls.find(({ sql }) => isPaginatedResultQuery(sql));

  assert.equal(response.meta.activeQuarter, '2026-06-30');
  assert.equal(response.meta.activeQuarterLabel, 'June 2026');
  assert.deepEqual(resultCall.params.slice(0, 3), ['2026-06-30', '2026-03-31', '2025-06-30']);
  assert.doesNotMatch(resultCall.sql, /WITH eligible AS/i);
  assert.match(resultCall.sql, /period_end\s*=\s*\$1/i);
});

test('omitted quarter resolves newest processed period and returns independent metadata facets', async () => {
  const calls = [];
  const service = createQuarterlyResultsService({
    dbPool: {
      async query(sql, params) {
        calls.push({ sql, params });
        if (/GROUP BY period_end/i.test(sql)) return { rows: [
          { period_end: '2026-06-30', companies: '1949' },
          { period_end: '2026-03-31', companies: '1901' },
        ] };
        if (/reported_at AT TIME ZONE/i.test(sql)) return { rows: [
          { date: '2026-08-15', companies: '47' },
        ] };
        if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '14' }] };
        return { rows: [] };
      },
    },
  });

  const response = await service.list({}, { userId: 'user-1' });

  assert.deepEqual(response.meta, {
    activeQuarter: '2026-06-30',
    activeQuarterLabel: 'June 2026',
    quarters: [
      { periodEnd: '2026-06-30', label: 'June 2026', companies: 1949 },
      { periodEnd: '2026-03-31', label: 'March 2026', companies: 1901 },
    ],
    reportedDates: [{ date: '2026-08-15', label: '15 Aug 2026', companies: 47 }],
    watchlistCompanies: 14,
  });
  const dateFacet = calls.find(({ sql }) => /reported_at AT TIME ZONE/i.test(sql));
  assert.deepEqual(dateFacet.params, ['2026-06-30']);
  assert.match(dateFacet.sql, /AT TIME ZONE 'Asia\/Kolkata'/i);
  assert.doesNotMatch(dateFacet.sql, /watchlists|market_cap|ILIKE/i);
  const watchlistFacet = calls.find(({ sql }) => /FROM watchlists/i.test(sql));
  assert.deepEqual(watchlistFacet.params, ['user-1']);
});

test('omitted quarter preserves the empty processed-results error', async () => {
  const service = createQuarterlyResultsService({
    dbPool: { async query(sql) {
      if (/GROUP BY period_end/i.test(sql)) return { rows: [] };
      throw new Error('unexpected query');
    } },
  });

  await assert.rejects(
    () => service.list({}, { userId: 'user-1' }),
    /No processed quarterly results available/,
  );
});

test('one metadata snapshot keeps active quarter coherent with quarters across the exact TTL boundary', async () => {
  let clock = 1_000;
  const quarterSnapshots = [
    [
      { period_end: '2026-06-30', companies: '2' },
      { period_end: '2026-03-31', companies: '1' },
    ],
    [
      { period_end: '2026-09-30', companies: '1' },
      { period_end: '2026-06-30', companies: '2' },
    ],
  ];
  const calls = [];
  const service = createQuarterlyResultsService({
    now: () => clock,
    dbPool: { async query(sql, params) {
      calls.push({ sql, params });
      if (/GROUP BY period_end/i.test(sql)) return { rows: quarterSnapshots.shift() };
      if (/AS date,[\s\S]*AS companies/i.test(sql)) return { rows: [] };
      if (/count\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: '0' }] };
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  const first = await service.list({}, { userId: 'user-1' });
  clock += 59_999;
  const second = await service.list({}, { userId: 'user-2' });

  assert.equal(first.meta.activeQuarter, '2026-06-30');
  assert.equal(first.meta.quarters[0].periodEnd, '2026-06-30');
  assert.equal(second.meta.activeQuarter, '2026-06-30');
  assert.equal(second.meta.quarters[0].periodEnd, '2026-06-30');
  assert.equal(calls.filter(({ sql }) => /SELECT max\(period_end\)/i.test(sql)).length, 0);
  assert.equal(calls.filter(({ sql }) => /GROUP BY period_end/i.test(sql)).length, 1);
  assert.equal(calls.filter(({ sql }) => /AS date,[\s\S]*AS companies/i.test(sql)).length, 1);
  assert.equal(calls.filter(({ sql }) => isPaginatedResultQuery(sql)).length, 2);
  assert.equal(calls.filter(({ sql }) => /count\(\*\)::int AS total/i.test(sql)).length, 2);
  assert.deepEqual(
    calls.filter(({ sql }) => /FROM watchlists/i.test(sql)).map(({ params }) => params),
    [['user-1'], ['user-2']],
  );

  clock += 1;
  const third = await service.list({}, { userId: 'user-1' });

  assert.equal(third.meta.activeQuarter, '2026-09-30');
  assert.equal(third.meta.quarters[0].periodEnd, '2026-09-30');
  assert.equal(calls.filter(({ sql }) => /SELECT max\(period_end\)/i.test(sql)).length, 0);
  assert.equal(calls.filter(({ sql }) => /GROUP BY period_end/i.test(sql)).length, 2);
  assert.equal(calls.filter(({ sql }) => /AS date,[\s\S]*AS companies/i.test(sql)).length, 2);
  assert.equal(calls.filter(({ sql }) => isPaginatedResultQuery(sql)).length, 3);
  assert.equal(calls.filter(({ sql }) => /count\(\*\)::int AS total/i.test(sql)).length, 3);
  assert.equal(calls.filter(({ sql }) => /FROM watchlists/i.test(sql)).length, 3);
});

test('concurrent cold and expired requests share active-quarter, quarters, and same-quarter date queries', async () => {
  let clock = 10_000;
  const calls = [];
  const service = createQuarterlyResultsService({
    now: () => clock,
    dbPool: { async query(sql, params) {
      calls.push({ sql, params });
      if (/GROUP BY period_end/i.test(sql)) return { rows: [
        { period_end: '2026-06-30', companies: '1' },
      ] };
      if (/AS date,[\s\S]*AS companies/i.test(sql)) return { rows: [] };
      if (/count\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: '0' }] };
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  await Promise.all([
    service.list({}, { userId: 'user-1' }),
    service.list({}, { userId: 'user-2' }),
  ]);

  assert.equal(calls.filter(({ sql }) => /SELECT max\(period_end\)/i.test(sql)).length, 0);
  assert.equal(calls.filter(({ sql }) => /GROUP BY period_end/i.test(sql)).length, 1);
  assert.equal(calls.filter(({ sql }) => /AS date,[\s\S]*AS companies/i.test(sql)).length, 1);
  assert.equal(calls.filter(({ sql }) => isPaginatedResultQuery(sql)).length, 2);
  assert.equal(calls.filter(({ sql }) => /count\(\*\)::int AS total/i.test(sql)).length, 2);
  assert.deepEqual(
    calls.filter(({ sql }) => /FROM watchlists/i.test(sql)).map(({ params }) => params),
    [['user-1'], ['user-2']],
  );

  clock += 60_000;
  await Promise.all([
    service.list({}, { userId: 'user-1' }),
    service.list({}, { userId: 'user-2' }),
  ]);

  assert.equal(calls.filter(({ sql }) => /SELECT max\(period_end\)/i.test(sql)).length, 0);
  assert.equal(calls.filter(({ sql }) => /GROUP BY period_end/i.test(sql)).length, 2);
  assert.equal(calls.filter(({ sql }) => /AS date,[\s\S]*AS companies/i.test(sql)).length, 2);
  assert.equal(calls.filter(({ sql }) => isPaginatedResultQuery(sql)).length, 4);
  assert.equal(calls.filter(({ sql }) => /count\(\*\)::int AS total/i.test(sql)).length, 4);
  assert.equal(calls.filter(({ sql }) => /FROM watchlists/i.test(sql)).length, 4);
});

test('rejected metadata queries clear shared in-flight state and retry successfully', async () => {
  const attempts = { quarters: 0, dates: 0 };
  const service = createQuarterlyResultsService({
    now: () => 20_000,
    dbPool: { async query(sql) {
      if (/GROUP BY period_end/i.test(sql)) {
        attempts.quarters += 1;
        if (attempts.quarters === 1) throw new Error('quarters unavailable');
        return { rows: [{ period_end: '2026-06-30', companies: '1' }] };
      }
      if (/AS date,[\s\S]*AS companies/i.test(sql)) {
        attempts.dates += 1;
        if (attempts.dates === 1) throw new Error('dates unavailable');
        return { rows: [] };
      }
      if (/count\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: '0' }] };
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  const quarterFailures = await Promise.allSettled([
    service.list({}, { userId: 'user-1' }),
    service.list({}, { userId: 'user-2' }),
  ]);
  assert.deepEqual(quarterFailures.map(({ status }) => status), ['rejected', 'rejected']);
  assert.equal(attempts.quarters, 1);

  const dateFailures = await Promise.allSettled([
    service.list({}, { userId: 'user-1' }),
    service.list({}, { userId: 'user-2' }),
  ]);
  assert.deepEqual(dateFailures.map(({ status }) => status), ['rejected', 'rejected']);
  assert.equal(attempts.quarters, 2);
  assert.equal(attempts.dates, 1);

  await service.list({}, { userId: 'user-1' });
  assert.deepEqual(attempts, { quarters: 2, dates: 2 });
});

test('reported-date metadata cache is keyed by exact historical quarter', async () => {
  let clock = 5_000;
  const calls = [];
  const service = createQuarterlyResultsService({
    now: () => clock,
    dbPool: { async query(sql, params) {
      calls.push({ sql, params });
      if (/GROUP BY period_end/i.test(sql)) return { rows: [
        { period_end: '2026-06-30', companies: '1' },
        { period_end: '2026-03-31', companies: '1' },
      ] };
      if (/AS date,[\s\S]*AS companies/i.test(sql)) {
        return { rows: [{
          date: params[0] === '2026-06-30' ? '2026-08-15' : '2026-05-15',
          companies: '1',
        }] };
      }
      if (/count\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: '0' }] };
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  const latest = await service.list({}, { userId: 'user-1' });
  clock += 1;
  const historical = await service.list({ quarter: '2026-03-31' }, { userId: 'user-1' });
  clock += 1;
  const historicalAgain = await service.list({ quarter: '2026-03-31' }, { userId: 'user-1' });

  assert.deepEqual(latest.meta.reportedDates.map(({ date }) => date), ['2026-08-15']);
  assert.deepEqual(historical.meta.reportedDates.map(({ date }) => date), ['2026-05-15']);
  assert.deepEqual(historicalAgain.meta.reportedDates.map(({ date }) => date), ['2026-05-15']);
  assert.deepEqual(
    calls.filter(({ sql }) => /AS date,[\s\S]*AS companies/i.test(sql)).map(({ params }) => params[0]),
    ['2026-06-30', '2026-03-31'],
  );
});

test('unavailable explicit quarters bypass both completed and in-flight reporting-date caches', async () => {
  const dateFacetPeriods = [];
  const service = createQuarterlyResultsService({
    now: () => 30_000,
    dbPool: { async query(sql, params) {
      if (/GROUP BY period_end/i.test(sql)) return { rows: [
        { period_end: '2026-06-30', companies: '1' },
      ] };
      if (/AS date,[\s\S]*AS companies/i.test(sql)) {
        dateFacetPeriods.push(params[0]);
        return { rows: [] };
      }
      if (/count\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: '0' }] };
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  await Promise.all([
    service.list({ quarter: '2025-12-31' }, { userId: 'user-1' }),
    service.list({ quarter: '2025-12-31' }, { userId: 'user-2' }),
  ]);
  await service.list({ quarter: '2025-12-31' }, { userId: 'user-1' });

  assert.deepEqual(dateFacetPeriods, ['2025-12-31', '2025-12-31', '2025-12-31']);
});

test('reported-date cache evicts the oldest entry after 16 available quarters', async () => {
  const quarters = [
    '2022-03-31', '2022-06-30', '2022-09-30', '2022-12-31',
    '2023-03-31', '2023-06-30', '2023-09-30', '2023-12-31',
    '2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31',
    '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31',
    '2026-03-31',
  ];
  const dateFacetPeriods = [];
  const service = createQuarterlyResultsService({
    now: () => 30_000,
    dbPool: { async query(sql, params) {
      if (/GROUP BY period_end/i.test(sql)) return { rows: quarters.map((period_end) => ({
        period_end,
        companies: '1',
      })).reverse() };
      if (/AS date,[\s\S]*AS companies/i.test(sql)) {
        dateFacetPeriods.push(params[0]);
        return { rows: [] };
      }
      if (/count\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: '0' }] };
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  for (const quarter of quarters) {
    await service.list({ quarter }, { userId: 'user-1' });
  }
  await service.list({ quarter: quarters[0] }, { userId: 'user-1' });

  assert.equal(dateFacetPeriods.length, quarters.length + 1);
  assert.equal(dateFacetPeriods.filter((quarter) => quarter === quarters[0]).length, 2);
});

test('reported-date facets count only the consolidated-first current choice per symbol', async () => {
  const calls = [];
  const service = createQuarterlyResultsService({
    dbPool: { async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  await service.list({ quarter: '2026-06-30' }, { userId: 'user-1' });
  const facet = calls.find(({ sql }) => /AS date,[\s\S]*AS companies/i.test(sql));

  assert.match(facet.sql, /row_number\(\)\s+OVER\s*\([\s\S]*PARTITION BY symbol/i);
  assert.match(facet.sql, /CASE WHEN basis = 'consolidated' THEN 0 ELSE 1 END/i);
  assert.match(facet.sql, /reported_at DESC,[\s\S]*nse_seq_id DESC/i);
  assert.match(facet.sql, /choice_rank\s*=\s*1/i);
  assert.match(facet.sql, /FROM current_choice/i);
  assert.deepEqual(facet.params, ['2026-06-30']);
});

test('IST reporting-date contract converts timestamps before applying the calendar date', async () => {
  const calls = [];
  const service = createQuarterlyResultsService({
    dbPool: { async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  await service.list({ quarter: '2026-06-30', reported_date: '2026-08-16' }, { userId: 'user-1' });
  const result = calls.find(({ sql }) => isPaginatedResultQuery(sql));
  const facet = calls.find(({ sql }) => /AS date,[\s\S]*AS companies/i.test(sql));

  assert.match(result.sql, /\(current\.reported_at AT TIME ZONE 'Asia\/Kolkata'\)::date\s*=\s*\$\d+::date/i);
  assert.ok(result.params.includes('2026-08-16'));
  assert.match(facet.sql, /\(reported_at AT TIME ZONE 'Asia\/Kolkata'\)::date/i);
  assert.doesNotMatch(result.sql, /current\.reported_at::date/i);
  assert.equal(todayIstDate(new Date('2026-08-15T18:29:59.999Z')), '2026-08-15');
  assert.equal(todayIstDate(new Date('2026-08-15T18:30:00.000Z')), '2026-08-16');
});

test('an empty trusted-user watchlist returns zero results without falling back to All', async () => {
  let resultSql;
  const service = createQuarterlyResultsService({
    dbPool: { async query(sql) {
      if (isPaginatedResultQuery(sql)) resultSql = sql;
      if (/count\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: '0' }] };
      if (/FROM watchlists\s+WHERE/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  const response = await service.list(
    { quarter: '2026-06-30', watchlist: 'true' },
    { userId: 'empty-user' },
  );

  assert.match(resultSql, /JOIN watchlists AS watchlist/i);
  assert.deepEqual(response.items, []);
  assert.equal(response.pagination.total, 0);
  assert.equal(response.meta.watchlistCompanies, 0);
});

test('reported-date, watchlist, search, and custom market-cap filters combine with trusted parameters', async () => {
  const calls = [];
  const service = createQuarterlyResultsService({
    dbPool: {
      async query(sql, params) {
        calls.push({ sql, params });
        if (/FROM watchlists\s+WHERE/i.test(sql)) return { rows: [{ companies: '0' }] };
        return { rows: [] };
      },
    },
  });

  await service.list({
    quarter: '2026-06-30',
    reported_date: '2026-08-15',
    watchlist: 'true',
    market_cap_min: '50',
    market_cap_max: '500',
    q: 'bank',
  }, { userId: 'trusted-user' });
  const resultCall = calls.find(({ sql }) => isPaginatedResultQuery(sql));

  assert.match(resultCall.sql, /reported_at AT TIME ZONE 'Asia\/Kolkata'/i);
  assert.match(resultCall.sql, /JOIN watchlists AS watchlist[\s\S]*watchlist\.user_id\s*=\s*\$\d+/i);
  assert.match(resultCall.sql, /watchlist\.symbol\s*=\s*current\.symbol/i);
  assert.match(resultCall.sql, /universe\.market_cap\s*>=\s*\$\d+/i);
  assert.match(resultCall.sql, /universe\.market_cap\s*<=\s*\$\d+/i);
  assert.deepEqual(resultCall.params.slice(0, 5), [
    '2026-06-30', '2026-03-31', '2025-06-30', 'bank', '%bank%',
  ]);
  assert.ok(resultCall.params.includes('2026-08-15'));
  assert.ok(resultCall.params.includes('trusted-user'));
  assert.ok(resultCall.params.includes(500_000_000));
  assert.ok(resultCall.params.includes(5_000_000_000));
  assert.equal(resultCall.params.includes('attacker'), false);
});

test('present filter parameters cannot use empty values', async () => {
  const service = createQuarterlyResultsService({
    dbPool: { async query() { return { rows: [] }; } },
  });

  for (const params of [
    { quarter: '' },
    { reported_date: '' },
    { watchlist: '' },
    { market_cap_bucket: '' },
    { market_cap_min: '' },
    { market_cap_max: '' },
  ]) {
    await assert.rejects(
      () => service.list({ quarter: '2026-06-30', ...params }, { userId: 'user-1' }),
      (error) => error.statusCode === 400,
    );
  }
});

test('fixed market-cap buckets use non-overlapping rupee boundaries while All includes missing caps', async () => {
  async function resultQuery(params = {}) {
    let captured;
    const service = createQuarterlyResultsService({
      dbPool: { async query(sql, values) {
        if (isPaginatedResultQuery(sql)) captured = { sql, values };
        if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
        return { rows: [] };
      } },
    });
    await service.list({ quarter: '2026-06-30', ...params }, { userId: 'user-1' });
    return captured;
  }

  const all = await resultQuery();
  assert.doesNotMatch(all.sql, /universe\.market_cap\s*(?:<|>)/i);

  const cases = [
    ['under_50', /market_cap\s*>=\s*\$\d+[\s\S]*market_cap\s*<\s*\$\d+/i, [0, 500_000_000]],
    ['50_500', /market_cap\s*>=\s*\$\d+[\s\S]*market_cap\s*<\s*\$\d+/i, [500_000_000, 5_000_000_000]],
    ['500_5000', /market_cap\s*>=\s*\$\d+[\s\S]*market_cap\s*<\s*\$\d+/i, [5_000_000_000, 50_000_000_000]],
    ['5000_plus', /market_cap\s*>=\s*\$\d+/i, [50_000_000_000]],
  ];
  for (const [bucket, shape, boundaries] of cases) {
    const captured = await resultQuery({ market_cap_bucket: bucket });
    assert.match(captured.sql, shape);
    assert.doesNotMatch(captured.sql, /COALESCE\s*\(\s*universe\.market_cap/i);
    for (const boundary of boundaries) assert.ok(captured.values.includes(boundary));
  }
});

test('filter validation rejects invalid dates, values, ranges, and combinations with status 400', async () => {
  const service = createQuarterlyResultsService({
    dbPool: { async query() { return { rows: [] }; } },
  });
  const invalid = [
    { quarter: '2026-06-29' },
    { quarter: '2026-6-30' },
    { reported_date: '2026-02-30' },
    { reported_date: '15-08-2026' },
    { watchlist: 'false' },
    { market_cap_bucket: 'mega' },
    { market_cap_min: '-1' },
    { market_cap_max: 'NaN' },
    { market_cap_min: '501', market_cap_max: '500' },
    { market_cap_bucket: 'under_50', market_cap_min: '0' },
  ];
  for (const params of invalid) {
    await assert.rejects(
      () => service.list(params, { userId: 'user-1' }),
      (error) => error.statusCode === 400,
    );
  }
});

test('custom market-cap bounds reject overflow and excess decimal precision', async () => {
  const service = createQuarterlyResultsService({
    dbPool: { async query() { return { rows: [] }; } },
  });

  for (const params of [
    { market_cap_min: '100000000.01' },
    { market_cap_max: '1.001' },
  ]) {
    await assert.rejects(
      () => service.list({ quarter: '2026-06-30', ...params }, { userId: 'user-1' }),
      (error) => error.statusCode === 400,
    );
  }
});

test('two-decimal custom market-cap bounds convert to safe integer rupees', async () => {
  let resultParams;
  const service = createQuarterlyResultsService({
    dbPool: { async query(sql, params) {
      if (isPaginatedResultQuery(sql)) resultParams = params;
      if (/count\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: '0' }] };
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  await service.list(
    { quarter: '2026-06-30', market_cap_min: '50.25', market_cap_max: '500.75' },
    { userId: 'user-1' },
  );

  assert.ok(resultParams.includes(502_500_000));
  assert.ok(resultParams.includes(5_007_500_000));
});

test('pagination defaults to 25 and retains a maximum of 50', async () => {
  let resultParams;
  const service = createQuarterlyResultsService({
    dbPool: { async query(sql, params) {
      if (isPaginatedResultQuery(sql)) resultParams = params;
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  const response = await service.list({ quarter: '2026-06-30' }, { userId: 'user-1' });
  assert.equal(response.pagination.limit, 25);
  assert.ok(resultParams.includes(25));
  await assert.rejects(
    () => service.list({ quarter: '2026-06-30', limit: '51' }, { userId: 'user-1' }),
    (error) => error.statusCode === 400,
  );
});

test('pagination preserves the matching total when the requested page has no rows', async () => {
  const service = createQuarterlyResultsService({
    dbPool: { async query(sql) {
      if (/count\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: '63' }] };
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  const response = await service.list(
    { quarter: '2026-06-30', page: '4', limit: '25' },
    { userId: 'user-1' },
  );

  assert.deepEqual(response.pagination, { page: 4, limit: 25, total: 63, totalPages: 3 });
  assert.deepEqual(response.items, []);
});

test('pagination count query uses compact PostgreSQL placeholders', async () => {
  const calls = [];
  const service = createQuarterlyResultsService({
    dbPool: { async query(sql, params) {
      calls.push({ sql, params });
      if (/count\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: '0' }] };
      if (/FROM watchlists\s+WHERE/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  await service.list({
    quarter: '2026-06-30', q: 'bank', reported_date: '2026-08-15', watchlist: 'true',
  }, { userId: 'user-1' });
  const countCall = calls.find(({ sql }) => /count\(\*\)::int AS total/i.test(sql));
  const placeholders = [...countCall.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));

  assert.deepEqual(countCall.params.slice(0, 3), ['2026-06-30', 'bank', '%bank%']);
  assert.equal(Math.max(...placeholders), countCall.params.length);
  assert.deepEqual([...new Set(placeholders)].sort((a, b) => a - b),
    Array.from({ length: countCall.params.length }, (_, index) => index + 1));
});

test('service assembles exact same-basis periods and converts INR only in the response', async () => {
  let captured;
  const service = createQuarterlyResultsService({
    dbPool: {
      async query(sql, params) {
        if (isPaginatedResultQuery(sql)) {
          captured = { sql, params };
          return { rows: [resultRow()] };
        }
        if (/count\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: '1' }] };
        if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
        return { rows: [] };
      },
    },
  });

  const response = await service.list(
    { quarter: '2026-06-30', q: 'ongc', page: '1', limit: '50' },
    { userId: 'user-1' },
  );

  assert.match(captured.sql, /status\s*=\s*'processed'/i);
  assert.match(captured.sql, /superseded_by_seq_id\s+IS\s+NULL/i);
  assert.match(captured.sql, /previous\.basis\s*=\s*current\.basis/i);
  assert.match(captured.sql, /prior_year\.basis\s*=\s*current\.basis/i);
  assert.match(captured.sql, /CASE\s+WHEN\s+basis\s*=\s*'consolidated'\s+THEN\s+0/i);
  assert.deepEqual(captured.params.slice(0, 5), [
    '2026-06-30', '2026-03-31', '2025-06-30', 'ongc', '%ongc%',
  ]);
  assert.equal(captured.sql.includes('ongc'), false);

  assert.deepEqual(response.items[0], {
    symbol: 'ONGC',
    companyName: 'Oil & Natural Gas Corporation Limited',
    basis: 'consolidated',
    taxonomy: 'indas',
    reportedAt: '2026-08-04T14:49:05.000Z',
    periods: { current: '2026-06-30', previous: '2026-03-31', priorYear: null },
    metrics: {
      revenue: { current: 204987.4, previous: 173805.2, priorYear: null },
      calculatedEbitda: { current: 15485.4, previous: 25356.1, priorYear: null },
      netProfit: { current: 6554.4, previous: 13677.9, priorYear: null },
    },
    growth: {
      revenueQoq: 17.9, revenueYoy: null,
      ebitdaQoq: -38.9, ebitdaYoy: null,
      profitQoq: -52.1, profitYoy: null,
    },
    sources: {
      current: 'https://nsearchives.nseindia.com/corporate/xbrl/current.xml',
      previous: 'https://nsearchives.nseindia.com/corporate/xbrl/previous.xml',
      priorYear: null,
    },
    ebitdaFormula: 'Revenue from operations − materials − stock purchases − inventory changes − employee benefits − other expenses',
  });
  assert.deepEqual(response.pagination, { page: 1, limit: 50, total: 1, totalPages: 1 });
});

test('standalone and banking rows retain their selected basis and formula', async () => {
  const service = createQuarterlyResultsService({
    dbPool: { async query(sql) {
      if (isPaginatedResultQuery(sql)) return { rows: [resultRow({ basis: 'standalone', taxonomy: 'banking' })] };
      if (/FROM watchlists/i.test(sql)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });
  const item = (await service.list({ quarter: '2026-06-30' }, { userId: 'user-1' })).items[0];
  assert.equal(item.basis, 'standalone');
  assert.match(item.ebitdaFormula, /interest earned/i);
});

test('sort and pagination inputs are validated and null growth sorts last', async () => {
  let sql;
  const service = createQuarterlyResultsService({
    dbPool: { async query(value) {
      if (isPaginatedResultQuery(value)) sql = value;
      if (/FROM watchlists/i.test(value)) return { rows: [{ companies: '0' }] };
      return { rows: [] };
    } },
  });

  await assert.rejects(() => service.list({ sort: 'reported_at; DROP TABLE x' }), /sort/i);
  await assert.rejects(() => service.list({ order: 'sideways' }), /order/i);
  await assert.rejects(() => service.list({ page: '0' }), /page/i);
  await assert.rejects(() => service.list({ limit: '51' }), /limit/i);

  for (const sort of ['reported_at', 'revenue_yoy', 'profit_yoy']) {
    await service.list({ quarter: '2026-06-30', sort, order: 'asc' }, { userId: 'user-1' });
    assert.match(sql, new RegExp(
      `ORDER BY\\s+${sort}\\s+ASC\\s+NULLS LAST,\\s*reported_at DESC,\\s*symbol ASC`, 'i',
    ));
  }
});

test('route registers auth before the handler and maps input errors to 400', async () => {
  let route;
  const app = {
    get(path, ...handlers) { route = { path, handlers }; },
  };
  const auth = () => {};
  const service = {
    async list() {
      throw Object.assign(new Error('Invalid sort'), { statusCode: 400 });
    },
  };
  registerQuarterlyResultsRoutes(app, { auth, service });

  assert.equal(route.path, '/api/quarterly-results');
  assert.equal(route.handlers[0], auth);

  let status;
  let body;
  await route.handlers[1]({ query: {}, user: { id: 'user-1' } }, {
    status(value) { status = value; return this; },
    json(value) { body = value; },
    set() {},
  });
  assert.equal(status, 400);
  assert.deepEqual(body, { error: 'Invalid sort' });
});

test('route passes only the authenticated user identity to the service', async () => {
  let route;
  let received;
  const app = { get(_path, ...handlers) { route = handlers; } };
  const auth = () => {};
  const service = {
    async list(params, context) {
      received = { params, context };
      return { items: [] };
    },
  };
  registerQuarterlyResultsRoutes(app, { auth, service });

  await route[1]({ query: { userId: 'attacker', watchlist: 'true' }, user: { id: 'trusted-user' } }, {
    json() {},
    set() {},
  });

  assert.deepEqual(received, {
    params: { userId: 'attacker', watchlist: 'true' },
    context: { userId: 'trusted-user' },
  });
});

test('route does not expose unexpected database error details', async () => {
  let handler;
  const app = { get(_path, _auth, value) { handler = value; } };
  registerQuarterlyResultsRoutes(app, {
    auth() {},
    service: { async list() { throw new Error('relation quarterly_results_secret does not exist'); } },
  });
  let status;
  let body;
  await handler({ query: {}, user: { id: 'user-1' } }, {
    set() {},
    status(value) { status = value; return this; },
    json(value) { body = value; },
  });

  assert.equal(status, 500);
  assert.deepEqual(body, { error: 'Unable to load quarterly results' });
  assert.doesNotMatch(JSON.stringify(body), /quarterly_results_secret/i);
});
