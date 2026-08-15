import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bootstrapLatestQuarterFilings } from '../scripts/quarterly-results-backfill.mjs';

function filing(seq, symbol, periodEnd) {
  return {
    nseSeqId: String(seq), symbol, companyName: symbol, periodEnd,
    basis: 'consolidated', publishedAt: `2026-08-${String(20 - seq).padStart(2, '0')}T12:00:00.000Z`,
    typeSub: 'Original', revisedAt: null, revisionRemark: null, isRevision: false,
    xbrlUrl: `https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_${seq}_WEB.xml`,
  };
}

class RepositoryDouble {
  constructor() {
    this.rows = new Map();
  }

  async getActiveSymbols() { return ['A', 'B']; }
  async getExistingSeqIds(ids) { return ids.filter((id) => this.rows.has(id)); }
  async insertFilings(rows) {
    const inserted = [];
    for (const row of rows) {
      if (this.rows.has(row.nseSeqId)) continue;
      this.rows.set(row.nseSeqId, row);
      inserted.push(row);
    }
    return inserted;
  }
}

test('bootstrap scans the full publication-ordered feed and retains only its newest quarter', async () => {
  const pages = [
    [filing(1, 'A', '2026-06-30'), filing(2, 'A', '2026-03-31')],
    [filing(3, 'B', '2026-06-30'), filing(4, 'INACTIVE', '2026-06-30')],
    [filing(5, 'B', '2026-03-31'), filing(6, 'A', '2025-12-31')],
  ];
  const histories = {
    A: [filing(1, 'A', '2026-06-30'), filing(11, 'A', '2026-03-31'), filing(12, 'A', '2025-06-30')],
    B: [filing(3, 'B', '2026-06-30'), filing(13, 'B', '2026-03-31'), filing(14, 'B', '2025-06-30')],
  };
  const fetchedPages = [];
  const historyCalls = [];
  const source = {
    async fetchLatestPage({ page, size }) {
      fetchedPages.push(page);
      return { filings: pages[page - 1] ?? [], page, size, totalCount: 6 };
    },
    async fetchHistory(symbol) {
      historyCalls.push(symbol);
      return histories[symbol];
    },
  };
  const repository = new RepositoryDouble();

  const result = await bootstrapLatestQuarterFilings({ source, repository, pageSize: 2 });

  assert.deepEqual(fetchedPages, [1, 2, 3]);
  assert.deepEqual(historyCalls.sort(), ['A', 'B']);
  assert.deepEqual(result, {
    latestPeriod: '2026-06-30',
    pagesFetched: 3,
    discovery: { discovered: 2, inserted: 6, rejected: 0 },
  });
  assert.deepEqual(
    [...repository.rows.values()].map((row) => row.periodEnd).sort(),
    ['2025-06-30', '2025-06-30', '2026-03-31', '2026-03-31', '2026-06-30', '2026-06-30'],
  );
});

test('package scripts expose the Railway cron and one-time bootstrap commands', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['cron:quarterly-results'], 'node scripts/run-cron.mjs quarterly-results');
  assert.equal(pkg.scripts['backfill:quarterly-results'], 'node scripts/quarterly-results-backfill.mjs');
});

