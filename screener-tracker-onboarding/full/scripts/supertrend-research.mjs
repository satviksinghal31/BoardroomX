import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });

const DATA_DIR = join(process.cwd(), 'data', 'supertrend-research');
const CACHE_DIR = join(DATA_DIR, 'cache');
const REPORT_PATH = join(DATA_DIR, 'report.json');

const YEARS = [1, 2, 3, 4];
const CAPITAL = 100000;
const ATR_PERIOD = 10;
const ST_FACTOR = 3;

const MUST_HAVE = [
  'BAJFINANCE',
  'LAURUSLABS',
  'APARINDS',
  'PGEL',
  'TDPOWERSYS',
  'PREMIERENE',
  'HFCL',
  'RELIANCE',
  'APOLLOMICRO',
  'GENUSPOWER',
];

const EXTRA_SEEDS = [
  'TARIL',
  'TRANSRAILL',
  'BALUFORGE',
  'ACUTAAS',
  'SAILIFE',
  'BEL',
  'HAL',
  'BHEL',
  'SIEMENS',
  'CGPOWER',
  'KAYNES',
  'DIXON',
  'POLYCAB',
  'SUZLON',
  'KPI',
  'KPIGREEN',
  'INOXWIND',
  'JSWENERGY',
  'NTPC',
  'POWERGRID',
  'TATAPOWER',
  'ABB',
  'HINDZINC',
  'VEDL',
  'COCHINSHIP',
  'MAZDOCK',
  'GRSE',
  'BDL',
  'ZENTEC',
  'IDEAFORGE',
  'RVNL',
  'IRFC',
  'IRCTC',
  'CDSL',
  'BSE',
  'MCX',
  'PAYTM',
  'ZOMATO',
  'DMART',
  'TRENT',
  'TITAN',
  'HDFCBANK',
  'ICICIBANK',
  'SBIN',
  'AXISBANK',
  'INFY',
  'TCS',
  'HCLTECH',
  'LT',
  'ULTRACEMCO',
  'AMBUJACEM',
  'ADANIENT',
  'ADANIPORTS',
];

const YAHOO_ALIASES = {
  APOLLOMICRO: 'APOLLO',
  ZOMATO: 'ETERNAL',
};

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function yahooSymbol(symbol) {
  return `${YAHOO_ALIASES[symbol] ?? symbol}.NS`;
}

function fmtPct(v) {
  return Number.isFinite(v) ? +(v * 100).toFixed(2) : null;
}

function avg(values) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function sma(rows, period, key = 'close') {
  const out = Array(rows.length).fill(null);
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    sum += rows[i][key] ?? 0;
    if (i >= period) sum -= rows[i - period][key] ?? 0;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function atr(rows, period) {
  const tr = rows.map((r, i) => {
    if (i === 0) return r.high - r.low;
    const prevClose = rows[i - 1].close;
    return Math.max(r.high - r.low, Math.abs(r.high - prevClose), Math.abs(r.low - prevClose));
  });
  const out = Array(rows.length).fill(null);
  let value = null;
  for (let i = 0; i < rows.length; i++) {
    if (i === period - 1) {
      value = avg(tr.slice(0, period));
    } else if (i >= period) {
      value = ((value * (period - 1)) + tr[i]) / period;
    }
    if (i >= period - 1) out[i] = value;
  }
  return out;
}

function addIndicators(rows) {
  const dma20 = sma(rows, 20);
  const dma50 = sma(rows, 50);
  const dma100 = sma(rows, 100);
  const dma200 = sma(rows, 200);
  const dma250 = sma(rows, 250);
  const vol20 = sma(rows, 20, 'volume');
  const atr10 = atr(rows, ATR_PERIOD);
  const atr14 = atr(rows, 14);

  const basicUpper = rows.map((r, i) => ((r.high + r.low) / 2) + ST_FACTOR * (atr10[i] ?? 0));
  const basicLower = rows.map((r, i) => ((r.high + r.low) / 2) - ST_FACTOR * (atr10[i] ?? 0));
  const finalUpper = Array(rows.length).fill(null);
  const finalLower = Array(rows.length).fill(null);
  const supertrend = Array(rows.length).fill(null);
  const direction = Array(rows.length).fill(null);

  for (let i = 0; i < rows.length; i++) {
    if (!atr10[i]) continue;
    if (i === 0 || !finalUpper[i - 1]) {
      finalUpper[i] = basicUpper[i];
      finalLower[i] = basicLower[i];
      direction[i] = 1;
      supertrend[i] = finalUpper[i];
      continue;
    }
    finalUpper[i] = basicUpper[i] < finalUpper[i - 1] || rows[i - 1].close > finalUpper[i - 1]
      ? basicUpper[i]
      : finalUpper[i - 1];
    finalLower[i] = basicLower[i] > finalLower[i - 1] || rows[i - 1].close < finalLower[i - 1]
      ? basicLower[i]
      : finalLower[i - 1];

    if (supertrend[i - 1] === finalUpper[i - 1]) {
      direction[i] = rows[i].close <= finalUpper[i] ? 1 : -1;
    } else {
      direction[i] = rows[i].close >= finalLower[i] ? -1 : 1;
    }
    supertrend[i] = direction[i] === -1 ? finalLower[i] : finalUpper[i];
  }

  return rows.map((row, i) => ({
    ...row,
    dma20: dma20[i],
    dma50: dma50[i],
    dma100: dma100[i],
    dma200: dma200[i],
    dma250: dma250[i],
    vol20: vol20[i],
    atr14: atr14[i],
    supertrend: supertrend[i],
    stDirection: direction[i],
  }));
}

function crossedAbove(rows, key, lookback) {
  const end = rows.length - 1;
  const start = Math.max(1, end - lookback + 1);
  for (let i = start; i <= end; i++) {
    if (rows[i - 1]?.[key] && rows[i].close > rows[i][key] && rows[i - 1].close <= rows[i - 1][key]) {
      return { crossed: true, daysAgo: end - i, date: rows[i].date };
    }
  }
  return { crossed: false, daysAgo: null, date: null };
}

function ret(rows, days) {
  const last = rows.at(-1);
  const prev = rows.at(-(days + 1));
  return last && prev ? (last.close / prev.close) - 1 : null;
}

function maxDrawdown(equity) {
  let peak = equity[0] ?? CAPITAL;
  let maxDd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    maxDd = Math.min(maxDd, (v / peak) - 1);
  }
  return maxDd;
}

function backtest(rows, years, strategyName) {
  const cutoff = new Date(rows.at(-1).date);
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const data = rows.filter(r => new Date(r.date) >= cutoff);
  let cash = CAPITAL;
  let qty = 0;
  let entry = null;
  let risk = null;
  let partialTaken = false;
  let adds = 0;
  const trades = [];
  const equity = [];

  function buy(row, fraction, reason) {
    const spend = cash * fraction;
    if (spend <= 0 || !row.close) return;
    const addQty = spend / row.close;
    cash -= spend;
    qty += addQty;
    entry = entry ? ((entry * (qty - addQty)) + spend) / qty : row.close;
    risk = risk ?? Math.max(row.close - (row.supertrend ?? row.close * 0.93), row.atr14 ?? row.close * 0.03);
    trades.push({ date: row.date, side: 'buy', price: row.close, reason });
  }

  function sell(row, fraction, reason) {
    if (qty <= 0) return;
    const sellQty = qty * fraction;
    cash += sellQty * row.close;
    qty -= sellQty;
    trades.push({ date: row.date, side: 'sell', price: row.close, reason });
    if (qty < 1e-8) {
      qty = 0;
      entry = null;
      risk = null;
      partialTaken = false;
      adds = 0;
    }
  }

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const prev = data[i - 1];
    if (!row.dma200 || !row.supertrend) {
      equity.push(cash + qty * row.close);
      continue;
    }
    const stGreenFlip = prev.stDirection === 1 && row.stDirection === -1;
    const stRedFlip = prev.stDirection === -1 && row.stDirection === 1;
    const above200 = row.close > row.dma200;
    const above50 = row.close > row.dma50 && row.dma50 > row.dma200;
    const freshHigh = i > 20 && row.close > Math.max(...data.slice(i - 20, i).map(r => r.high));
    const pullbackHeld = row.stDirection === -1 && row.close > row.dma20 && prev.low <= prev.dma20;

    if (qty === 0) {
      if (strategyName === 'ST_EMA_FILTER' && stGreenFlip && above200) buy(row, 0.98, 'supertrend_green_above_200dma');
      if (strategyName === 'ST_MOMENTUM_PYRAMID' && stGreenFlip && above50) buy(row, 0.5, 'starter_green_50_over_200');
      if (strategyName === 'ST_PULLBACK' && pullbackHeld && above200) buy(row, 0.6, 'pullback_to_20dma_in_green_trend');
    } else {
      const profitR = risk ? (row.close - entry) / risk : 0;
      if (strategyName === 'ST_MOMENTUM_PYRAMID') {
        if (adds === 0 && freshHigh && row.close > entry * 1.03) {
          buy(row, 0.5, 'add_on_20d_breakout');
          adds += 1;
        } else if (adds === 1 && row.close > entry + (row.atr14 ?? 0)) {
          buy(row, 0.5, 'add_on_atr_strength');
          adds += 1;
        }
        if (!partialTaken && profitR >= 2) {
          sell(row, 0.4, 'partial_2r');
          partialTaken = true;
        }
      }
      if (strategyName === 'ST_PULLBACK' && !partialTaken && profitR >= 2) {
        sell(row, 1 / 3, 'partial_2r');
        partialTaken = true;
      }
      const exit =
        stRedFlip ||
        (strategyName === 'ST_MOMENTUM_PYRAMID' && row.close < row.dma50) ||
        (strategyName === 'ST_PULLBACK' && row.close < row.dma50);
      if (exit) sell(row, 1, stRedFlip ? 'supertrend_red' : 'dma50_breakdown');
    }
    equity.push(cash + qty * row.close);
  }

  if (qty > 0) {
    cash += qty * data.at(-1).close;
    trades.push({ date: data.at(-1).date, side: 'sell', price: data.at(-1).close, reason: 'mark_to_market_close' });
  }

  const finalEquity = cash;
  const totalReturn = (finalEquity / CAPITAL) - 1;
  const cagr = Math.pow(finalEquity / CAPITAL, 1 / years) - 1;
  const completed = [];
  let openBuy = null;
  for (const t of trades) {
    if (t.side === 'buy' && !openBuy) openBuy = t;
    if (t.side === 'sell' && openBuy) {
      completed.push((t.price / openBuy.price) - 1);
      openBuy = null;
    }
  }
  const wins = completed.filter(v => v > 0);
  const losses = completed.filter(v => v <= 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  return {
    years,
    strategyName,
    totalReturn: fmtPct(totalReturn),
    cagr: fmtPct(cagr),
    maxDrawdown: fmtPct(maxDrawdown(equity)),
    trades: completed.length,
    winRate: completed.length ? fmtPct(wins.length / completed.length) : null,
    profitFactor: grossLoss ? +(grossWin / grossLoss).toFixed(2) : null,
    lastTrade: trades.at(-1) ?? null,
  };
}

async function getNifty500Symbols() {
  const url = 'https://archives.nseindia.com/content/indices/ind_nifty500list.csv';
  const res = await fetch(url, {
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

async function fetchChart(symbol) {
  const cachePath = join(CACHE_DIR, `${symbol}.json`);
  if (existsSync(cachePath)) return JSON.parse(await readFile(cachePath, 'utf8'));
  const result = await yf.chart(yahooSymbol(symbol), {
    period1: new Date('2021-01-01'),
    period2: new Date(),
    interval: '1d',
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
  await writeFile(cachePath, JSON.stringify(rows));
  return rows;
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  const nifty500 = await getNifty500Symbols();
  const universe = uniq([...MUST_HAVE, ...EXTRA_SEEDS, ...nifty500]);
  console.log(`Universe: ${universe.length} symbols`);

  const analyses = [];
  for (let i = 0; i < universe.length; i++) {
    const symbol = universe[i];
    try {
      const raw = await fetchChart(symbol);
      if (raw.length < 260) continue;
      const rows = addIndicators(raw);
      const last = rows.at(-1);
      const prev = rows.at(-2);
      const c100 = crossedAbove(rows, 'dma100', 15);
      const c200 = crossedAbove(rows, 'dma200', 15);
      const c250 = crossedAbove(rows, 'dma250', 15);
      const score =
        (last.close > last.dma200 ? 20 : 0) +
        (last.dma50 > last.dma200 ? 15 : 0) +
        (last.stDirection === -1 ? 15 : 0) +
        (c100.crossed ? 15 : 0) +
        (c200.crossed ? 25 : 0) +
        (c250.crossed ? 10 : 0) +
        Math.max(-20, Math.min(30, (ret(rows, 63) ?? 0) * 100)) +
        (last.volume > (last.vol20 ?? Infinity) ? 5 : 0);

      analyses.push({
        symbol,
        yahoo: yahooSymbol(symbol),
        lastDate: last.date,
        close: +last.close.toFixed(2),
        dma20: last.dma20 ? +last.dma20.toFixed(2) : null,
        dma50: last.dma50 ? +last.dma50.toFixed(2) : null,
        dma100: last.dma100 ? +last.dma100.toFixed(2) : null,
        dma200: last.dma200 ? +last.dma200.toFixed(2) : null,
        dma250: last.dma250 ? +last.dma250.toFixed(2) : null,
        above100: last.close > last.dma100,
        above200: last.close > last.dma200,
        above250: last.close > last.dma250,
        cross100: c100,
        cross200: c200,
        cross250: c250,
        stGreen: last.stDirection === -1,
        stFlipGreenToday: prev.stDirection === 1 && last.stDirection === -1,
        ret1m: fmtPct(ret(rows, 21)),
        ret3m: fmtPct(ret(rows, 63)),
        ret6m: fmtPct(ret(rows, 126)),
        volVs20: last.vol20 ? +(last.volume / last.vol20).toFixed(2) : null,
        score: +score.toFixed(2),
        rows,
      });
      if ((i + 1) % 50 === 0) console.log(`Fetched/analyzed ${i + 1}/${universe.length}`);
    } catch (err) {
      console.warn(`skip ${symbol}: ${err.message}`);
    }
  }

  const byScore = [...analyses].sort((a, b) => b.score - a.score);
  const mandatory = analyses.filter(a => MUST_HAVE.includes(a.symbol));
  const freshMomentum = byScore.filter(a =>
    a.stGreen &&
    (a.cross100.crossed || a.cross200.crossed || a.cross250.crossed || a.stFlipGreenToday) &&
    (a.above200 || a.cross200.crossed || a.cross250.crossed)
  ).slice(0, 30);
  const finalUniverse = uniq([
    ...MUST_HAVE.slice(0, 4),
    ...MUST_HAVE.slice(4),
    ...freshMomentum.map(a => a.symbol),
  ]).slice(0, 12);

  const strategyNames = ['ST_EMA_FILTER', 'ST_MOMENTUM_PYRAMID', 'ST_PULLBACK'];
  const backtests = [];
  for (const symbol of finalUniverse) {
    const analysis = analyses.find(a => a.symbol === symbol);
    if (!analysis) continue;
    for (const strategyName of strategyNames) {
      for (const years of YEARS) {
        backtests.push({ symbol, ...backtest(analysis.rows, years, strategyName) });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'Yahoo Finance chart API via yahoo-finance2; NSE Nifty 500 constituent CSV',
    requiredSymbols: MUST_HAVE,
    universeCount: universe.length,
    analyzedCount: analyses.length,
    mandatory: mandatory.map(({ rows, ...a }) => a),
    freshMomentum: freshMomentum.map(({ rows, ...a }) => a),
    finalUniverse,
    backtests,
  };
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('\nTop fresh momentum candidates');
  console.table(report.freshMomentum.slice(0, 12).map(a => ({
    symbol: a.symbol,
    close: a.close,
    score: a.score,
    stGreen: a.stGreen,
    cross100: a.cross100.crossed ? `${a.cross100.daysAgo}d` : '',
    cross200: a.cross200.crossed ? `${a.cross200.daysAgo}d` : '',
    cross250: a.cross250.crossed ? `${a.cross250.daysAgo}d` : '',
    ret1m: a.ret1m,
    ret3m: a.ret3m,
    volVs20: a.volVs20,
  })));

  console.log('\nFinal backtest universe');
  console.log(finalUniverse.join(', '));

  console.log('\nBest 4-year strategy rows by CAGR');
  console.table(backtests
    .filter(r => r.years === 4)
    .sort((a, b) => (b.cagr ?? -999) - (a.cagr ?? -999))
    .slice(0, 15)
    .map(({ symbol, strategyName, totalReturn, cagr, maxDrawdown, trades, winRate, profitFactor }) => ({
      symbol,
      strategyName,
      totalReturn,
      cagr,
      maxDrawdown,
      trades,
      winRate,
      profitFactor,
    })));

  console.log(`\nReport written: ${REPORT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
