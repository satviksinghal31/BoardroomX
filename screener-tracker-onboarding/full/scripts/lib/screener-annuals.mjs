import { ScreenerScraperPro } from '../../node_modules/screener-scraper-pro/dist/index.js';

export const PARSER_VERSION = 'screener-annuals-v1';
const SOURCE = 'screener';

function toConsolidatedUrl(url) {
  return url.replace(/\/(consolidated\/)?$/, '/consolidated/');
}

function toNumber(value) {
  if (value == null || value === '' || value === '-' || value === '--') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const clean = String(value)
    .replace(/,/g, '')
    .replace(/%/g, '')
    .replace(/[^\d.-]/g, '');
  if (!clean || clean === '-' || clean === '.') return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMetric(table, names, period) {
  const data = table?.data ?? {};
  for (const name of names) {
    if (data[name]?.[period] != null) return data[name][period];
  }
  return null;
}

function rawForPeriod(table, period) {
  const out = {};
  for (const [metric, values] of Object.entries(table?.data ?? {})) {
    if (values?.[period] != null) out[metric] = values[period];
  }
  return out;
}

function periodYear(period) {
  const match = String(period ?? '').match(/(20\d{2}|19\d{2})/);
  return match ? Number(match[1]) : null;
}

function latestAnnualYearExpected(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 4 ? year : year - 1;
}

function tablePeriods(table) {
  return Array.isArray(table?.headers) ? table.headers.filter(Boolean) : [];
}

function annualRows(symbol, table, sourceUrl, isConsolidated) {
  return tablePeriods(table).map((period, index) => ({
    symbol,
    fiscal_year: period,
    period_order: index,
    sales: toNumber(getMetric(table, ['Sales'], period)),
    revenue: toNumber(getMetric(table, ['Revenue'], period)),
    expenses: toNumber(getMetric(table, ['Expenses'], period)),
    operating_profit: toNumber(getMetric(table, ['Operating Profit', 'Financing Profit'], period)),
    opm_percent: toNumber(getMetric(table, ['OPM %', 'Financing Margin %'], period)),
    other_income: toNumber(getMetric(table, ['Other Income'], period)),
    interest: toNumber(getMetric(table, ['Interest'], period)),
    depreciation: toNumber(getMetric(table, ['Depreciation'], period)),
    profit_before_tax: toNumber(getMetric(table, ['Profit before tax', 'Profit Before Tax'], period)),
    tax_percent: toNumber(getMetric(table, ['Tax %'], period)),
    net_profit: toNumber(getMetric(table, ['Net Profit'], period)),
    eps: toNumber(getMetric(table, ['EPS in Rs', 'EPS in Rs.'], period)),
    dividend_payout_percent: toNumber(getMetric(table, ['Dividend Payout %'], period)),
    raw_json: rawForPeriod(table, period),
    source: SOURCE,
    source_url: sourceUrl,
    is_consolidated: isConsolidated,
    parser_version: PARSER_VERSION,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

function ratioRows(symbol, table, sourceUrl) {
  return tablePeriods(table).map((period, index) => ({
    symbol,
    fiscal_year: period,
    period_order: index,
    roce_percent: toNumber(getMetric(table, ['ROCE %'], period)),
    roe_percent: toNumber(getMetric(table, ['ROE %'], period)),
    debt_to_equity: toNumber(getMetric(table, ['Debt to equity', 'Debt / Equity'], period)),
    book_value: toNumber(getMetric(table, ['Book value', 'Book Value'], period)),
    pe: toNumber(getMetric(table, ['P/E', 'PE'], period)),
    market_cap: toNumber(getMetric(table, ['Market Cap'], period)),
    working_capital_days: toNumber(getMetric(table, ['Working Capital Days'], period)),
    cash_conversion_cycle: toNumber(getMetric(table, ['Cash Conversion Cycle'], period)),
    inventory_days: toNumber(getMetric(table, ['Inventory Days'], period)),
    debtor_days: toNumber(getMetric(table, ['Debtor Days'], period)),
    raw_json: rawForPeriod(table, period),
    source: SOURCE,
    source_url: sourceUrl,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

function balanceSheetRows(symbol, table, sourceUrl) {
  return tablePeriods(table).map((period, index) => ({
    symbol,
    fiscal_year: period,
    period_order: index,
    equity_capital: toNumber(getMetric(table, ['Equity Capital'], period)),
    reserves: toNumber(getMetric(table, ['Reserves'], period)),
    borrowings: toNumber(getMetric(table, ['Borrowings'], period)),
    other_liabilities: toNumber(getMetric(table, ['Other Liabilities'], period)),
    total_liabilities: toNumber(getMetric(table, ['Total Liabilities'], period)),
    fixed_assets: toNumber(getMetric(table, ['Fixed Assets'], period)),
    cwip: toNumber(getMetric(table, ['CWIP'], period)),
    investments: toNumber(getMetric(table, ['Investments'], period)),
    other_assets: toNumber(getMetric(table, ['Other Assets'], period)),
    total_assets: toNumber(getMetric(table, ['Total Assets'], period)),
    raw_json: rawForPeriod(table, period),
    source: SOURCE,
    source_url: sourceUrl,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

function cashFlowRows(symbol, table, sourceUrl) {
  return tablePeriods(table).map((period, index) => ({
    symbol,
    fiscal_year: period,
    period_order: index,
    cash_from_operating_activity: toNumber(getMetric(table, ['Cash from Operating Activity', 'Cash from Operating Activities'], period)),
    cash_from_investing_activity: toNumber(getMetric(table, ['Cash from Investing Activity', 'Cash from Investing Activities'], period)),
    cash_from_financing_activity: toNumber(getMetric(table, ['Cash from Financing Activity', 'Cash from Financing Activities'], period)),
    net_cash_flow: toNumber(getMetric(table, ['Net Cash Flow'], period)),
    raw_json: rawForPeriod(table, period),
    source: SOURCE,
    source_url: sourceUrl,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

function shareholdingRows(symbol, table, sourceUrl) {
  return tablePeriods(table).map((period, index) => ({
    symbol,
    period,
    period_order: index,
    promoters_percent: toNumber(getMetric(table, ['Promoters', 'Promoter'], period)),
    fii_percent: toNumber(getMetric(table, ['FIIs', 'FII'], period)),
    dii_percent: toNumber(getMetric(table, ['DIIs', 'DII'], period)),
    public_percent: toNumber(getMetric(table, ['Public'], period)),
    government_percent: toNumber(getMetric(table, ['Government'], period)),
    others_percent: toNumber(getMetric(table, ['Others'], period)),
    pledged_percent: toNumber(getMetric(table, ['Pledged'], period)),
    number_of_shareholders: toNumber(getMetric(table, ['No. of Shareholders', 'Number of Shareholders'], period)),
    raw_json: rawForPeriod(table, period),
    source: SOURCE,
    source_url: sourceUrl,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

async function scrapeWithFallback(symbol) {
  const baseUrl = `https://www.screener.in/company/${symbol}/`;
  const consolidatedUrl = toConsolidatedUrl(baseUrl);
  try {
    const data = await ScreenerScraperPro(consolidatedUrl);
    if (tablePeriods(data?.profitLoss).length) {
      return { data, sourceUrl: consolidatedUrl, isConsolidated: true };
    }
  } catch {
    // Fall through to standalone.
  }
  const data = await ScreenerScraperPro(baseUrl);
  return { data, sourceUrl: baseUrl, isConsolidated: false };
}

function dedupeRows(rows, keys) {
  const map = new Map();
  for (const row of rows) {
    const id = keys.map(key => row[key] ?? '').join('|');
    if (!id.replace(/\|/g, '')) continue;
    map.set(id, row);
  }
  return [...map.values()];
}

async function upsertRows(supabase, table, rows, onConflict) {
  const keys = onConflict.split(',').map(key => key.trim());
  const cleanRows = dedupeRows(rows, keys);
  if (!cleanRows.length) return 0;
  const { error } = await supabase.from(table).upsert(cleanRows, { onConflict });
  if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  return cleanRows.length;
}

export async function fetchAndStoreScreenerAnnuals(symbol, supabase, opts = {}) {
  const sym = String(symbol ?? '').trim().toUpperCase();
  if (!sym) throw new Error('Missing symbol');

  const started = Date.now();
  const { data, sourceUrl, isConsolidated } = await scrapeWithFallback(sym);

  const fundamentals = annualRows(sym, data?.profitLoss, sourceUrl, isConsolidated);
  if (!fundamentals.length) {
    return {
      ok: false,
      symbol: sym,
      status: 'retry',
      message: 'No annual P&L rows found on Screener',
      rowsWritten: 0,
      durationMs: Date.now() - started,
      sourceUrl,
    };
  }

  const ratios = ratioRows(sym, data?.ratios, sourceUrl);
  const balanceSheet = balanceSheetRows(sym, data?.balanceSheet, sourceUrl);
  const cashFlows = cashFlowRows(sym, data?.cashFlow, sourceUrl);
  const shareholding = shareholdingRows(sym, data?.shareholding, sourceUrl);

  let rowsWritten = 0;
  rowsWritten += await upsertRows(supabase, 'annual_fundamentals', fundamentals, 'symbol,fiscal_year');
  rowsWritten += await upsertRows(supabase, 'annual_ratios', ratios, 'symbol,fiscal_year');
  rowsWritten += await upsertRows(supabase, 'annual_balance_sheet', balanceSheet, 'symbol,fiscal_year');
  rowsWritten += await upsertRows(supabase, 'annual_cash_flows', cashFlows, 'symbol,fiscal_year');
  rowsWritten += await upsertRows(supabase, 'shareholding_pattern', shareholding, 'symbol,period');

  const annualYears = fundamentals.map(r => periodYear(r.fiscal_year)).filter(Boolean);
  const latestYear = annualYears.length ? Math.max(...annualYears) : null;
  const expectedYear = opts.expectedLatestYear ?? latestAnnualYearExpected();
  const latestFyAvailable = latestYear != null && latestYear >= expectedYear;
  const latestPeriod = fundamentals.at(-1)?.fiscal_year ?? null;

  return {
    ok: true,
    symbol: sym,
    status: latestFyAvailable ? 'complete' : 'retry',
    message: latestFyAvailable
      ? `Stored ${fundamentals.length} annual periods`
      : `Stored ${fundamentals.length} annual periods; latest FY ${expectedYear} not available yet`,
    rowsWritten,
    durationMs: Date.now() - started,
    sourceUrl,
    isConsolidated,
    historyYearsCount: fundamentals.length,
    historyComplete: fundamentals.length >= 5,
    latestPeriod,
    latestFyAvailable,
    latestFyMissing: !latestFyAvailable,
  };
}

export function classifyScreenerError(err) {
  const msg = (err?.message || String(err)).toLowerCase();
  if (msg.includes('404') || msg.includes('not found')) return 'NOT_FOUND';
  if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('network') || msg.includes('fetch failed')) return 'NETWORK';
  if (msg.includes('parse') || msg.includes('cheerio')) return 'PARSE';
  return 'UNKNOWN';
}
