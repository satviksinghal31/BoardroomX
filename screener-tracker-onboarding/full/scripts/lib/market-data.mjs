import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import YahooFinance from 'yahoo-finance2';

export const YAHOO_ALIASES = {
  APOLLOMICRO: 'APOLLO',
  ZOMATO: 'ETERNAL',
};

export const NIFTY_500_URL = 'https://archives.nseindia.com/content/indices/ind_nifty500list.csv';
export const DEFAULT_CACHE_DIR = join(process.cwd(), 'data', 'supertrend-research', 'cache');
export const DEFAULT_CHART_PERIOD1 = new Date('2021-01-01');

const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });

export function yahooSymbol(symbol, aliases = YAHOO_ALIASES) {
  return `${aliases[symbol] ?? symbol}.NS`;
}

export async function getNifty500Symbols({
  url = NIFTY_500_URL,
  fetchImpl = fetch,
} = {}) {
  const res = await fetchImpl(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/csv,*/*',
    },
  });
  if (!res.ok) throw new Error(`Nifty 500 fetch failed: ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const symbolIndex = headers.findIndex(h => h === 'symbol');
  if (symbolIndex < 0) throw new Error('Nifty 500 CSV did not contain a Symbol column');
  return lines.slice(1).map(line => line.split(',')[symbolIndex]?.trim()).filter(Boolean);
}

export async function fetchChart(symbol, {
  cacheDir = DEFAULT_CACHE_DIR,
  yahoo = yf,
  period1 = DEFAULT_CHART_PERIOD1,
  period2 = new Date(),
  interval = '1d',
  yahooSymbolFn = yahooSymbol,
} = {}) {
  const cachePath = join(cacheDir, `${symbol}.json`);
  if (existsSync(cachePath)) return JSON.parse(await readFile(cachePath, 'utf8'));

  const result = await yahoo.chart(yahooSymbolFn(symbol), {
    period1,
    period2,
    interval,
  });
  const rows = result.quotes
    .filter(r => Number.isFinite(r.close) && Number.isFinite(r.high) && Number.isFinite(r.low))
    .map(r => ({
      date: r.date.toISOString().slice(0, 10),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.adjclose ?? r.close,
      volume: r.volume ?? 0,
    }));
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, JSON.stringify(rows));
  return rows;
}
