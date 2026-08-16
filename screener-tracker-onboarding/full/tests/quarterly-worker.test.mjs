import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createQuarterlyRepository,
  discoverLatestFilings,
  processDueFilings,
  runQuarterlyResultsWorker,
} from '../scripts/quarterly-results-worker.mjs';

test('PostgreSQL date values are normalized to ISO period dates', async () => {
  let claimSql = '';
  const client = {
    async query(sql) {
      if (/RETURNING result\.\*/.test(sql)) {
        claimSql = sql;
        return { rows: [{
          nse_seq_id: '102385', symbol: 'TCS', period_end: new Date(2025, 5, 30),
          basis: 'consolidated', taxonomy: 'indas', source_xbrl_url: 'https://nsearchives.nseindia.com/corporate/xbrl/example.xml',
          reported_at: new Date('2025-07-10T10:00:00.000Z'), status: 'processing',
          attempt_count: 1, next_retry_at: null, last_attempt_at: new Date('2026-08-16T00:00:00.000Z'),
          superseded_by_seq_id: null,
        }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const repository = createQuarterlyRepository({ connect: async () => client });

  const row = await repository.claimNextDue(new Date('2026-08-16T00:00:00.000Z'));
  assert.equal(row.periodEnd, '2025-06-30');
  assert.match(claimSql, /ORDER BY period_end DESC, reported_at DESC, nse_seq_id DESC/);
});

const INDAS_XML = `
  <xbrli:xbrl xmlns:in-capmkt-ent="http://www.sebi.gov.in/xbrl/IntegratedFinance_IndAS/2026/in-capmkt-ent">
    <xbrli:context id="OneD"><xbrli:period><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
    <in:NatureOfReportStandaloneConsolidated contextRef="OneD">Consolidated</in:NatureOfReportStandaloneConsolidated>
    <in:RevenueFromOperations contextRef="OneD">1000</in:RevenueFromOperations>
    <in:CostOfMaterialsConsumed contextRef="OneD">100</in:CostOfMaterialsConsumed>
    <in:PurchasesOfStockInTrade contextRef="OneD">100</in:PurchasesOfStockInTrade>
    <in:ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade contextRef="OneD">-10</in:ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade>
    <in:EmployeeBenefitExpense contextRef="OneD">100</in:EmployeeBenefitExpense>
    <in:OtherExpenses contextRef="OneD">200</in:OtherExpenses>
    <in:ProfitLossForPeriod contextRef="OneD">300</in:ProfitLossForPeriod>
  </xbrli:xbrl>`;

function filing({
  seq, symbol = 'SCI', periodEnd = '2026-06-30', basis = 'consolidated',
  publishedAt = '2026-08-06T14:09:05.000Z', taxonomy = 'INDAS',
} = {}) {
  return {
    nseSeqId: String(seq),
    symbol,
    companyName: symbol,
    periodEnd,
    basis,
    publishedAt,
    typeSub: 'Original',
    revisedAt: null,
    revisionRemark: null,
    isRevision: false,
    xbrlUrl: `https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_${taxonomy}_${seq}_WEB.xml`,
  };
}

class MemoryRepository {
  constructor({ activeSymbols = ['SCI'], rows = [] } = {}) {
    this.activeSymbols = activeSymbols;
    this.rows = new Map(rows.map((row) => [row.nseSeqId, {
      status: 'pending', attemptCount: 0, nextRetryAt: null, lastAttemptAt: null,
      supersededBySeqId: null, ...row,
    }]));
  }

  async getActiveSymbols() {
    return this.activeSymbols;
  }

  async getDiscoveryWatermark() {
    const values = [...this.rows.values()].map((row) => row.reportedAt).filter(Boolean).sort();
    return values.at(-1) ?? null;
  }

  async getExistingSeqIds(seqIds) {
    return seqIds.filter((seqId) => this.rows.has(seqId));
  }

  async insertFilings(filings) {
    const inserted = [];
    for (const item of filings) {
      if (this.rows.has(item.nseSeqId)) continue;
      const row = {
        ...item,
        status: 'pending',
        attemptCount: 0,
        nextRetryAt: null,
        lastAttemptAt: null,
        supersededBySeqId: null,
      };
      this.rows.set(item.nseSeqId, row);
      inserted.push(row);
    }
    return inserted;
  }

  async claimNextDue(now) {
    const staleBefore = new Date(now.getTime() - 15 * 60_000).toISOString();
    const due = [...this.rows.values()]
      .filter((row) => !row.supersededBySeqId)
      .filter((row) => (
        row.status === 'pending'
        || (row.status === 'retry' && row.nextRetryAt <= now.toISOString())
        || (row.status === 'processing' && row.lastAttemptAt <= staleBefore)
      ))
      .sort((a, b) => a.reportedAt.localeCompare(b.reportedAt))[0];
    if (!due) return null;
    due.status = 'processing';
    due.lastAttemptAt = now.toISOString();
    due.attemptCount += 1;
    return { ...due };
  }

  async markProcessed(nseSeqId, values, now) {
    const row = this.rows.get(nseSeqId);
    Object.assign(row, values, {
      status: 'processed',
      nextRetryAt: null,
      error: values.issues.length ? values.issues.join(', ') : null,
      lastAttemptAt: now.toISOString(),
    });
    for (const candidate of this.rows.values()) {
      if (
        candidate.nseSeqId !== row.nseSeqId
        && candidate.symbol === row.symbol
        && candidate.periodEnd === row.periodEnd
        && candidate.basis === row.basis
        && candidate.reportedAt < row.reportedAt
      ) candidate.supersededBySeqId = row.nseSeqId;
    }
  }

  async markRetry(nseSeqId, error, nextRetryAt, now) {
    Object.assign(this.rows.get(nseSeqId), {
      status: 'retry', error, nextRetryAt: nextRetryAt.toISOString(), lastAttemptAt: now.toISOString(),
    });
  }

  async markFailed(nseSeqId, error, now) {
    Object.assign(this.rows.get(nseSeqId), {
      status: 'failed', error, nextRetryAt: null, lastAttemptAt: now.toISOString(),
    });
  }
}

function sourceDouble({ latest = [], histories = {}, xbrl = {} } = {}) {
  const calls = { latest: 0, history: [], xbrl: new Map() };
  return {
    calls,
    async fetchLatestPage({ page, size }) {
      calls.latest += 1;
      const start = (page - 1) * size;
      return { filings: latest.slice(start, start + size), page, size, totalCount: latest.length };
    },
    async fetchHistory(symbol) {
      calls.history.push(symbol);
      const value = histories[symbol] ?? [];
      if (value instanceof Error) throw value;
      return value;
    },
    async fetchXbrl(url) {
      calls.xbrl.set(url, (calls.xbrl.get(url) ?? 0) + 1);
      const value = xbrl[url] ?? INDAS_XML;
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

test('discovery filters the universe and inserts only three same-basis periods once', async () => {
  const current = filing({ seq: 183362 });
  const previous = filing({ seq: 156444, periodEnd: '2026-03-31', publishedAt: '2026-05-08T15:45:15.000Z' });
  const priorYear = filing({ seq: 109689, periodEnd: '2025-06-30', publishedAt: '2025-08-08T14:03:58.000Z' });
  const irrelevant = filing({ seq: 141022, periodEnd: '2025-12-31' });
  const standalone = filing({ seq: 183360, basis: 'standalone' });
  const inactive = filing({ seq: 999999, symbol: 'INACTIVE' });
  const source = sourceDouble({
    latest: [current, inactive],
    histories: { SCI: [current, previous, priorYear, irrelevant, standalone] },
  });
  const repository = new MemoryRepository();

  const first = await discoverLatestFilings({ source, repository, pageSize: 2 });
  const second = await discoverLatestFilings({ source, repository, pageSize: 2 });

  assert.deepEqual(first, { discovered: 1, inserted: 3, rejected: 0 });
  assert.deepEqual(second, { discovered: 0, inserted: 0, rejected: 0 });
  assert.deepEqual([...repository.rows.keys()].sort(), ['109689', '156444', '183362']);
  assert.deepEqual(source.calls.history, ['SCI']);
});

test('active filings without an exact publication timestamp are rejected, not assumed', async () => {
  const invalid = { ...filing({ seq: 800 }), publishedAt: null };
  const repository = new MemoryRepository();
  const source = sourceDouble({ latest: [invalid] });

  const result = await discoverLatestFilings({ source, repository, pageSize: 10 });

  assert.deepEqual(result, { discovered: 0, inserted: 0, rejected: 1 });
  assert.equal(repository.rows.size, 0);
});

test('processed sequence IDs are never fetched twice', async () => {
  const current = filing({ seq: 183362 });
  const source = sourceDouble({ latest: [current], histories: { SCI: [current] } });
  const repository = new MemoryRepository();
  const now = new Date('2026-08-06T14:10:00.000Z');

  await runQuarterlyResultsWorker({ source, repository, now, pageSize: 10 });
  await runQuarterlyResultsWorker({ source, repository, now, pageSize: 10 });

  assert.equal(source.calls.xbrl.get(current.xbrlUrl), 1);
  assert.equal(repository.rows.get('183362').status, 'processed');
});

test('bootstrap processing supports bounded XBRL concurrency', async () => {
  const items = [filing({ seq: 701, symbol: 'SCI' }), filing({ seq: 702, symbol: 'TCS' })];
  const repository = new MemoryRepository({ rows: items.map((item) => ({
    ...item, taxonomy: 'indas', sourceXbrlUrl: item.xbrlUrl, reportedAt: item.publishedAt,
  })) });
  let active = 0;
  let maxActive = 0;
  const source = {
    async fetchXbrl() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return INDAS_XML;
    },
  };

  const result = await processDueFilings({
    source, repository, now: new Date('2026-08-06T14:10:00.000Z'), concurrency: 2,
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(result, { processed: 2, retried: 0, failed: 0 });
});

test('a history fetch failure does not strand the current filing without comparisons', async () => {
  const current = filing({ seq: 183362 });
  const repository = new MemoryRepository();
  const failingSource = sourceDouble({
    latest: [current],
    histories: { SCI: new Error('history unavailable') },
  });

  await assert.rejects(
    () => discoverLatestFilings({ source: failingSource, repository, pageSize: 10 }),
    /history unavailable/,
  );
  assert.equal(repository.rows.size, 0);

  const healthySource = sourceDouble({ latest: [current], histories: { SCI: [current] } });
  await discoverLatestFilings({ source: healthySource, repository, pageSize: 10 });
  assert.deepEqual([...repository.rows.keys()], ['183362']);
});

test('stale processing claims are recovered after fifteen minutes', async () => {
  const row = {
    ...filing({ seq: 1 }), taxonomy: 'indas', sourceXbrlUrl: filing({ seq: 1 }).xbrlUrl,
    reportedAt: '2026-08-06T14:00:00.000Z', status: 'processing', attemptCount: 0,
    lastAttemptAt: '2026-08-06T14:00:00.000Z',
  };
  const repository = new MemoryRepository({ rows: [row] });
  const source = sourceDouble();

  await processDueFilings({ source, repository, now: new Date('2026-08-06T14:16:00.000Z') });

  assert.equal(repository.rows.get('1').status, 'processed');
  assert.equal(repository.rows.get('1').attemptCount, 1);
});

test('temporary failures retry after five and fifteen minutes, then fail terminally', async () => {
  const item = filing({ seq: 2 });
  const row = {
    ...item, taxonomy: 'indas', sourceXbrlUrl: item.xbrlUrl, reportedAt: item.publishedAt,
  };
  const repository = new MemoryRepository({ rows: [row] });
  const source = sourceDouble({ xbrl: { [item.xbrlUrl]: new Error('NSE 503') } });

  await processDueFilings({ source, repository, now: new Date('2026-08-06T14:10:00.000Z') });
  assert.equal(repository.rows.get('2').nextRetryAt, '2026-08-06T14:15:00.000Z');

  await processDueFilings({ source, repository, now: new Date('2026-08-06T14:14:59.000Z') });
  assert.equal(repository.rows.get('2').attemptCount, 1);

  await processDueFilings({ source, repository, now: new Date('2026-08-06T14:15:00.000Z') });
  assert.equal(repository.rows.get('2').nextRetryAt, '2026-08-06T14:30:00.000Z');

  await processDueFilings({ source, repository, now: new Date('2026-08-06T14:30:00.000Z') });
  assert.equal(repository.rows.get('2').status, 'failed');
  assert.equal(repository.rows.get('2').attemptCount, 3);
});

test('unsupported XBRL identity fails immediately without retry', async () => {
  const item = filing({ seq: 3 });
  const row = {
    ...item, taxonomy: 'indas', sourceXbrlUrl: item.xbrlUrl, reportedAt: item.publishedAt,
  };
  const repository = new MemoryRepository({ rows: [row] });
  const source = sourceDouble({ xbrl: { [item.xbrlUrl]: '<xbrli:xbrl />' } });

  await processDueFilings({ source, repository, now: new Date('2026-08-06T14:10:00.000Z') });

  assert.equal(repository.rows.get('3').status, 'failed');
  assert.equal(repository.rows.get('3').attemptCount, 1);
  assert.equal(repository.rows.get('3').nextRetryAt, null);
});

test('an NSE archive 404 fails immediately without retry', async () => {
  const item = filing({ seq: 31 });
  const row = {
    ...item, taxonomy: 'indas', sourceXbrlUrl: item.xbrlUrl, reportedAt: item.publishedAt,
  };
  const missing = Object.assign(new Error('NSE archive returned 404'), { statusCode: 404 });
  const repository = new MemoryRepository({ rows: [row] });
  const source = sourceDouble({ xbrl: { [item.xbrlUrl]: missing } });

  await processDueFilings({ source, repository, now: new Date('2026-08-06T14:10:00.000Z') });

  assert.equal(repository.rows.get('31').status, 'failed');
  assert.equal(repository.rows.get('31').attemptCount, 1);
  assert.equal(repository.rows.get('31').nextRetryAt, null);
});

test('a newer processed revision supersedes the older same-basis row', async () => {
  const oldItem = filing({ seq: 4, publishedAt: '2026-08-06T14:00:00.000Z' });
  const newItem = filing({ seq: 5, publishedAt: '2026-08-06T15:00:00.000Z' });
  const repository = new MemoryRepository({ rows: [
    { ...oldItem, taxonomy: 'indas', sourceXbrlUrl: oldItem.xbrlUrl, reportedAt: oldItem.publishedAt, status: 'processed' },
    { ...newItem, taxonomy: 'indas', sourceXbrlUrl: newItem.xbrlUrl, reportedAt: newItem.publishedAt },
  ] });

  await processDueFilings({ source: sourceDouble(), repository, now: new Date('2026-08-06T15:01:00.000Z') });

  assert.equal(repository.rows.get('4').supersededBySeqId, '5');
  assert.equal(repository.rows.get('5').status, 'processed');
});

test('one failed filing does not stop another due filing', async () => {
  const failed = filing({ seq: 6, publishedAt: '2026-08-06T14:00:00.000Z' });
  const healthy = filing({ seq: 7, publishedAt: '2026-08-06T14:01:00.000Z' });
  const repository = new MemoryRepository({ rows: [
    { ...failed, taxonomy: 'indas', sourceXbrlUrl: failed.xbrlUrl, reportedAt: failed.publishedAt },
    { ...healthy, taxonomy: 'indas', sourceXbrlUrl: healthy.xbrlUrl, reportedAt: healthy.publishedAt },
  ] });
  const source = sourceDouble({ xbrl: { [failed.xbrlUrl]: new Error('timeout') } });

  const result = await processDueFilings({
    source, repository, now: new Date('2026-08-06T14:10:00.000Z'),
  });

  assert.deepEqual(result, { processed: 1, retried: 1, failed: 0 });
  assert.equal(repository.rows.get('6').status, 'retry');
  assert.equal(repository.rows.get('7').status, 'processed');
});
