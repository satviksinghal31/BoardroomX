import assert from 'node:assert/strict';
import test from 'node:test';

import { createQuarterlyResultsService } from '../quarterly_results.js';
import { registerQuarterlyResultsRoutes } from '../quarterly_results_routes.js';

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
    total_count: '1',
    ...overrides,
  };
}

test('service assembles exact same-basis periods and converts INR only in the response', async () => {
  let captured;
  const service = createQuarterlyResultsService({
    dbPool: {
      async query(sql, params) {
        captured = { sql, params };
        return { rows: [resultRow()] };
      },
    },
  });

  const response = await service.list({ q: 'ongc', page: '1', limit: '50' });

  assert.match(captured.sql, /status\s*=\s*'processed'/i);
  assert.match(captured.sql, /superseded_by_seq_id\s+IS\s+NULL/i);
  assert.match(captured.sql, /previous\.basis\s*=\s*current\.basis/i);
  assert.match(captured.sql, /prior_year\.basis\s*=\s*current\.basis/i);
  assert.match(captured.sql, /CASE\s+WHEN\s+basis\s*=\s*'consolidated'\s+THEN\s+0/i);
  assert.deepEqual(captured.params.slice(0, 2), ['ongc', '%ongc%']);
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
    dbPool: { async query() { return { rows: [resultRow({ basis: 'standalone', taxonomy: 'banking' })] }; } },
  });
  const item = (await service.list({})).items[0];
  assert.equal(item.basis, 'standalone');
  assert.match(item.ebitdaFormula, /interest earned/i);
});

test('sort and pagination inputs are validated and null growth sorts last', async () => {
  let sql;
  const service = createQuarterlyResultsService({
    dbPool: { async query(value) { sql = value; return { rows: [] }; } },
  });

  await assert.rejects(() => service.list({ sort: 'reported_at; DROP TABLE x' }), /sort/i);
  await assert.rejects(() => service.list({ order: 'sideways' }), /order/i);
  await assert.rejects(() => service.list({ page: '0' }), /page/i);
  await assert.rejects(() => service.list({ limit: '51' }), /limit/i);

  await service.list({ sort: 'profit_yoy', order: 'asc' });
  assert.match(sql, /ORDER BY\s+profit_yoy\s+ASC\s+NULLS LAST,\s*reported_at DESC,\s*symbol ASC/i);
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
  await route.handlers[1]({ query: {} }, {
    status(value) { status = value; return this; },
    json(value) { body = value; },
    set() {},
  });
  assert.equal(status, 400);
  assert.deepEqual(body, { error: 'Invalid sort' });
});
