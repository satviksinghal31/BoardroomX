import 'dotenv/config';
import pg from 'pg';

import { calendarDate, comparisonPeriods } from './lib/quarter-periods.mjs';
import { createNseQuarterlySource } from './lib/nse-quarterly-source.mjs';
import { parseQuarterlyXbrl } from './lib/nse-quarterly-xbrl.mjs';

export const RECONCILIATION_SYMBOLS = ['SBIN', 'HINDALCO', 'ONGC', 'CASTROLIND', 'RITES'];

function latest(filings) {
  return [...filings].sort((a, b) => (
    b.publishedAt.localeCompare(a.publishedAt) || b.nseSeqId.localeCompare(a.nseSeqId)
  ))[0] ?? null;
}

function display(value) {
  return value == null ? 'NULL' : String(value);
}

function storedValue(row, metric) {
  if (!row) return null;
  return {
    revenue: row.revenueInr,
    calculated_ebitda: row.calculatedEbitdaInr,
    net_profit: row.netProfitInr,
    source: row.sourceXbrlUrl,
  }[metric];
}

function expectedValue(parsed, filing, metric) {
  return {
    revenue: parsed.revenueInr,
    calculated_ebitda: parsed.calculatedEbitdaInr,
    net_profit: parsed.netProfitInr,
    source: filing.xbrlUrl,
  }[metric];
}

export async function reconcileQuarterlyResults({
  repository,
  source,
  symbols = RECONCILIATION_SYMBOLS,
  writeLine = console.log,
}) {
  const storedRows = await repository.getRowsForSymbols(symbols);
  const counts = { passed: 0, missing: 0, mismatched: 0 };
  const metrics = ['revenue', 'calculated_ebitda', 'net_profit', 'source'];

  for (const symbol of symbols) {
    const history = (await source.fetchHistory(symbol)).filter((filing) => filing.publishedAt);
    if (history.length === 0) throw new Error(`No timestamped NSE filing history for ${symbol}`);
    const newestPeriod = history.map((filing) => filing.periodEnd).sort().at(-1);
    const currentPeriodFilings = history.filter((filing) => filing.periodEnd === newestPeriod);
    const basis = currentPeriodFilings.some((filing) => filing.basis === 'consolidated')
      ? 'consolidated'
      : 'standalone';
    const periods = Object.values(comparisonPeriods(newestPeriod)).sort();

    for (const periodEnd of periods) {
      const expectedFiling = latest(history.filter((filing) => (
        filing.periodEnd === periodEnd && filing.basis === basis
      )));
      const stored = latest(storedRows.filter((row) => (
        row.symbol === symbol && row.periodEnd === periodEnd && row.basis === basis
      )).map((row) => ({ ...row, publishedAt: row.reportedAt ?? '', nseSeqId: row.nseSeqId })));
      const parsed = expectedFiling ? parseQuarterlyXbrl(await source.fetchXbrl(expectedFiling.xbrlUrl)) : null;

      for (const metric of metrics) {
        const expected = expectedFiling ? expectedValue(parsed, expectedFiling, metric) : null;
        const actual = storedValue(stored, metric);
        let status = 'PASS';
        if (!expectedFiling || !stored) status = 'MISSING';
        else if (display(expected) !== display(actual)) status = 'MISMATCH';

        if (status === 'PASS') counts.passed += 1;
        else if (status === 'MISSING') counts.missing += 1;
        else counts.mismatched += 1;
        writeLine(`${status} ${symbol} ${periodEnd} ${metric} expected=${display(expected)} actual=${display(actual)}`);
      }
    }
  }

  return { ...counts, ok: counts.missing === 0 && counts.mismatched === 0 };
}

export function createReconciliationRepository(pool) {
  return {
    async getRowsForSymbols(symbols) {
      const result = await pool.query(`
        SELECT nse_seq_id, symbol, period_end, basis, reported_at, source_xbrl_url,
               revenue_inr, calculated_ebitda_inr, net_profit_inr
        FROM quarterly_results
        WHERE symbol = ANY($1::text[])
          AND status = 'processed'
          AND superseded_by_seq_id IS NULL
      `, [symbols]);
      return result.rows.map((row) => ({
        nseSeqId: row.nse_seq_id,
        symbol: row.symbol,
        periodEnd: calendarDate(row.period_end),
        basis: row.basis,
        reportedAt: new Date(row.reported_at).toISOString(),
        sourceXbrlUrl: row.source_xbrl_url,
        revenueInr: row.revenue_inr == null ? null : String(row.revenue_inr),
        calculatedEbitdaInr: row.calculated_ebitda_inr == null ? null : String(row.calculated_ebitda_inr),
        netProfitInr: row.net_profit_inr == null ? null : String(row.net_profit_inr),
      }));
    },
  };
}

export async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is required');
  const { Pool } = pg;
  const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  try {
    const result = await reconcileQuarterlyResults({
      repository: createReconciliationRepository(pool),
      source: createNseQuarterlySource(),
    });
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`[quarterly-reconciliation] ${error.message}`);
    process.exitCode = 1;
  });
}
