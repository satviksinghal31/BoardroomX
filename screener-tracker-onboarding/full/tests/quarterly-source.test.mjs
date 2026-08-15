import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createNseQuarterlySource } from '../scripts/lib/nse-quarterly-source.mjs';

const fixture = async (name) => JSON.parse(await readFile(
  new URL(`./fixtures/nse-quarterly/${name}`, import.meta.url),
  'utf8',
));

function response({ status = 200, json, text = '', cookies = [] }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      getSetCookie: () => cookies,
      get: () => null,
    },
    async json() {
      if (json instanceof Error) throw json;
      return json;
    },
    async text() {
      return text;
    },
  };
}

test('warms NSE cookies before latest discovery and sends one-based pagination', async () => {
  const calls = [];
  const page = await fixture('feed-page.json');
  const source = createNseQuarterlySource({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: url.toString(), options });
      if (calls.length === 1) return response({ cookies: ['nsit=session-1; Path=/'] });
      return response({ json: page });
    },
  });

  const result = await source.fetchLatestPage({ page: 2, size: 3 });

  assert.equal(calls[0].url, 'https://www.nseindia.com/');
  assert.match(calls[1].url, /[?&]page=2(?:&|$)/);
  assert.match(calls[1].url, /[?&]size=3(?:&|$)/);
  assert.equal(calls[1].options.headers.Cookie, 'nsit=session-1');
  assert.equal(result.filings[0].nseSeqId, '187893');
  assert.equal(result.page, 2);
  assert.equal(result.totalCount, page.totalCount);
});

test('history uses the exact symbol filter and normalizes filing identity', async () => {
  const calls = [];
  const historyFixture = await fixture('sci-history.json');
  const source = createNseQuarterlySource({
    fetchImpl: async (url) => {
      calls.push(url.toString());
      if (calls.length === 1) return response({ cookies: [] });
      return response({ json: historyFixture });
    },
  });

  const history = await source.fetchHistory('SCI');
  const current = history.find((filing) => filing.nseSeqId === '183362');
  const priorYear = history.find((filing) => (
    filing.periodEnd === '2025-06-30' && filing.basis === 'consolidated'
  ));

  assert.match(calls.at(-1), /[?&]symbol=SCI(?:&|$)/);
  assert.equal(priorYear.symbol, 'SCI');
  assert.deepEqual(current, {
    nseSeqId: '183362',
    symbol: 'SCI',
    companyName: 'Shipping Corporation Of India Limited',
    periodEnd: '2026-06-30',
    basis: 'consolidated',
    publishedAt: '2026-08-06T14:09:05.000Z',
    typeSub: 'Original',
    revisedAt: null,
    revisionRemark: null,
    isRevision: false,
    xbrlUrl: 'https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_1709349_06082026073906_WEB.xml',
  });
});

test('fetchXbrl reads only an official NSE archive URL', async () => {
  const calls = [];
  const source = createNseQuarterlySource({
    fetchImpl: async (url) => {
      calls.push(url.toString());
      return response({ text: '<xbrli:xbrl />' });
    },
  });

  assert.equal(
    await source.fetchXbrl('https://nsearchives.nseindia.com/corporate/xbrl/example.xml'),
    '<xbrli:xbrl />',
  );
  assert.equal(calls.length, 1);
  await assert.rejects(() => source.fetchXbrl('https://example.com/result.xml'), /official NSE XBRL URL/i);
});

test('HTTP and malformed JSON errors retain status and endpoint context', async () => {
  const httpSource = createNseQuarterlySource({
    fetchImpl: async (url) => (
      url.toString() === 'https://www.nseindia.com/'
        ? response({ cookies: [] })
        : response({ status: 503, text: 'temporarily unavailable' })
    ),
  });
  await assert.rejects(
    () => httpSource.fetchLatestPage({ page: 1, size: 3 }),
    /integrated-filing-results.*503.*temporarily unavailable/i,
  );

  const malformedSource = createNseQuarterlySource({
    fetchImpl: async (url) => (
      url.toString() === 'https://www.nseindia.com/'
        ? response({ cookies: [] })
        : response({ status: 200, json: new SyntaxError('Unexpected token') })
    ),
  });
  await assert.rejects(
    () => malformedSource.fetchHistory('SCI'),
    /integrated-filing-results.*status 200.*malformed JSON.*Unexpected token/i,
  );
});

