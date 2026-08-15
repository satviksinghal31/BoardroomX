import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createReconciliationRepository,
  reconcileQuarterlyResults,
} from '../scripts/reconcile-quarterly-results.mjs';

test('reconciliation repository preserves PostgreSQL calendar dates in IST', async () => {
  const repository = createReconciliationRepository({
    async query() {
      return { rows: [{
        nse_seq_id: '1', symbol: 'SCI', period_end: new Date(2025, 5, 30),
        basis: 'consolidated', reported_at: new Date('2025-08-08T14:00:00.000Z'),
        source_xbrl_url: 'https://nsearchives.nseindia.com/corporate/xbrl/1.xml',
        revenue_inr: '1000', calculated_ebitda_inr: '510', net_profit_inr: '300',
      }] };
    },
  });

  const rows = await repository.getRowsForSymbols(['SCI']);
  assert.equal(rows[0].periodEnd, '2025-06-30');
});

const xml = ({ revenue = 1000, profit = 300 } = {}) => `
  <xbrli:xbrl xmlns:in-capmkt-ent="http://www.sebi.gov.in/xbrl/IntegratedFinance_IndAS/2026/in-capmkt-ent">
    <in:RevenueFromOperations contextRef="OneD">${revenue}</in:RevenueFromOperations>
    <in:CostOfMaterialsConsumed contextRef="OneD">100</in:CostOfMaterialsConsumed>
    <in:PurchasesOfStockInTrade contextRef="OneD">100</in:PurchasesOfStockInTrade>
    <in:ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade contextRef="OneD">-10</in:ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade>
    <in:EmployeeBenefitExpense contextRef="OneD">100</in:EmployeeBenefitExpense>
    <in:OtherExpenses contextRef="OneD">200</in:OtherExpenses>
    <in:ProfitLossForPeriod contextRef="OneD">${profit}</in:ProfitLossForPeriod>
  </xbrli:xbrl>`;

function filing(seq, periodEnd, publishedAt) {
  return {
    nseSeqId: String(seq), symbol: 'SCI', periodEnd, basis: 'consolidated', publishedAt,
    xbrlUrl: `https://nsearchives.nseindia.com/corporate/xbrl/${seq}.xml`,
  };
}

const filings = [
  filing(3, '2026-06-30', '2026-08-06T14:00:00.000Z'),
  filing(2, '2026-03-31', '2026-05-08T14:00:00.000Z'),
  filing(1, '2025-06-30', '2025-08-08T14:00:00.000Z'),
];

function storedRows(overrides = {}) {
  return filings.map((item) => ({
    nseSeqId: item.nseSeqId,
    symbol: item.symbol,
    periodEnd: item.periodEnd,
    basis: item.basis,
    sourceXbrlUrl: item.xbrlUrl,
    revenueInr: '1000',
    calculatedEbitdaInr: '510',
    netProfitInr: '300',
    ...overrides[item.nseSeqId],
  }));
}

test('reconciliation reports deterministic PASS lines for exact stored NSE facts', async () => {
  const lines = [];
  const result = await reconcileQuarterlyResults({
    symbols: ['SCI'],
    repository: { async getRowsForSymbols() { return storedRows(); } },
    source: {
      async fetchHistory() { return filings; },
      async fetchXbrl() { return xml(); },
    },
    writeLine: (line) => lines.push(line),
  });

  assert.deepEqual(result, { passed: 12, missing: 0, mismatched: 0, ok: true });
  assert.equal(lines.length, 12);
  assert.equal(lines[0], 'PASS SCI 2025-06-30 revenue expected=1000 actual=1000');
  assert.equal(lines.at(-1), `PASS SCI 2026-06-30 source expected=${filings[0].xbrlUrl} actual=${filings[0].xbrlUrl}`);
});

test('reconciliation blocks a metric mismatch and a missing stored period', async () => {
  const rows = storedRows({ 3: { netProfitInr: '301' } }).filter((row) => row.nseSeqId !== '2');
  const lines = [];
  const result = await reconcileQuarterlyResults({
    symbols: ['SCI'],
    repository: { async getRowsForSymbols() { return rows; } },
    source: {
      async fetchHistory() { return filings; },
      async fetchXbrl() { return xml(); },
    },
    writeLine: (line) => lines.push(line),
  });

  assert.equal(result.ok, false);
  assert.equal(result.mismatched, 1);
  assert.equal(result.missing, 4);
  assert.equal(lines.some((line) => line === 'MISMATCH SCI 2026-06-30 net_profit expected=300 actual=301'), true);
  assert.equal(lines.some((line) => line.startsWith('MISSING SCI 2026-03-31 revenue')), true);
});
