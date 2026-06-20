import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

import { addIndicators, crossedAbove, ret } from './lib/indicators.mjs';
import { fetchChart, getNifty500Symbols, yahooSymbol } from './lib/market-data.mjs';
import { simulateRollingPath, summarizeRollingResults } from './lib/rolling-simulator.mjs';

const DATA_DIR = join(process.cwd(), 'data', 'supertrend-research');
const CACHE_DIR = join(DATA_DIR, 'cache');
const JSON_REPORT = join(DATA_DIR, 'rolling-report.json');
const CSV_REPORT = join(DATA_DIR, 'rolling-summary.csv');

const STARTING_CAPITAL = 100000;
const HORIZONS = [21, 42, 63, 126];
const STRATEGIES = ['R1_ST_200DMA', 'R2_ST_DMA_STACK', 'R3_ST_DMA_STACK_ADD'];
const EXIT_MODES = ['same_close', 'next_open'];

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

const SEED_MOMENTUM = [
  'ZEEL',
  'CARTRADE',
  'MMTC',
  'NBCC',
  'IDFCFIRSTB',
  'AEGISLOG',
  'KPRMILL',
  'OLAELEC',
  'CUB',
  'TEJASNET',
  'LT',
  'TITAGARH',
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
  'KPIGREEN',
  'INOXWIND',
  'JSWENERGY',
  'TATAPOWER',
  'ABB',
  'COCHINSHIP',
  'MAZDOCK',
  'GRSE',
  'BDL',
  'ZENTEC',
  'RVNL',
  'BSE',
  'MCX',
  'ETERNAL',
  'TRENT',
];

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function pct(v) {
  return Number.isFinite(v) ? +(v * 100).toFixed(2) : null;
}

function latestState(symbol, rows) {
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const cross100 = crossedAbove(rows, 'dma100', 15);
  const cross200 = crossedAbove(rows, 'dma200', 15);
  const cross250 = crossedAbove(rows, 'dma250', 15);
  const score =
    (last.close > last.dma200 ? 20 : 0) +
    (last.close > last.dma250 ? 10 : 0) +
    (last.dma50 > last.dma200 ? 15 : 0) +
    (last.stDirection === -1 ? 15 : 0) +
    (cross100.crossed ? 15 : 0) +
    (cross200.crossed ? 25 : 0) +
    (cross250.crossed ? 10 : 0) +
    Math.max(-20, Math.min(30, (ret(rows, 63) ?? 0) * 100)) +
    (last.vol20 && last.volume > last.vol20 ? 5 : 0);

  return {
    symbol,
    yahoo: yahooSymbol(symbol),
    lastDate: last.date,
    close: +last.close.toFixed(2),
    dma21: last.dma21 ? +last.dma21.toFixed(2) : null,
    dma50: last.dma50 ? +last.dma50.toFixed(2) : null,
    dma100: last.dma100 ? +last.dma100.toFixed(2) : null,
    dma200: last.dma200 ? +last.dma200.toFixed(2) : null,
    dma250: last.dma250 ? +last.dma250.toFixed(2) : null,
    above200: last.close > last.dma200,
    above250: last.close > last.dma250,
    stGreen: last.stDirection === -1,
    stFlipGreenToday: prev?.stDirection === 1 && last.stDirection === -1,
    cross100,
    cross200,
    cross250,
    ret1m: pct(ret(rows, 21)),
    ret3m: pct(ret(rows, 63)),
    ret6m: pct(ret(rows, 126)),
    volVs20: last.vol20 ? +(last.volume / last.vol20).toFixed(2) : null,
    score: +score.toFixed(2),
  };
}

function chooseFinalUniverse(states) {
  const fresh = states
    .filter(s =>
      s.stGreen &&
      (s.cross100.crossed || s.cross200.crossed || s.cross250.crossed || s.stFlipGreenToday) &&
      (s.above200 || s.cross200.crossed || s.cross250.crossed)
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(s => s.symbol);
  return uniq([...MUST_HAVE, ...fresh]).slice(0, 18);
}

function rollingAnchors(rows, horizon) {
  const anchors = [];
  for (let i = 250; i + horizon < rows.length; i++) anchors.push(i);
  return anchors;
}

function toCsv(rows) {
  const headers = [
    'symbol',
    'strategyName',
    'exitMode',
    'horizonDays',
    'count',
    'noEntryRatePct',
    'winRatePct',
    'enteredCount',
    'enteredWinRatePct',
    'averageReturnPct',
    'averageEnteredReturnPct',
    'medianReturnPct',
    'medianEnteredReturnPct',
    'p5ReturnPct',
    'p5EnteredReturnPct',
    'p95ReturnPct',
    'p95EnteredReturnPct',
    'averageEndingValue',
    'averageMaxDrawdownPct',
    'averageEntries',
    'averageReEntries',
  ];
  const escape = value => {
    if (value == null) return '';
    const s = String(value);
    return s.includes(',') ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
  ].join('\n');
}

async function loadAnalyzedUniverse() {
  await mkdir(CACHE_DIR, { recursive: true });
  let nifty500 = [];
  try {
    nifty500 = await getNifty500Symbols();
  } catch (err) {
    console.warn(`Nifty 500 fetch failed, continuing with seed universe: ${err.message}`);
  }
  const symbols = uniq([...MUST_HAVE, ...SEED_MOMENTUM, ...nifty500]);
  const analyzed = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    try {
      const raw = await fetchChart(symbol, { cacheDir: CACHE_DIR });
      if (raw.length < 280) continue;
      const rows = addIndicators(raw).filter(r =>
        Number.isFinite(r.open) &&
        Number.isFinite(r.close) &&
        Number.isFinite(r.dma21) &&
        Number.isFinite(r.dma200) &&
        Number.isFinite(r.supertrend)
      );
      if (rows.length < 280) continue;
      analyzed.push({ symbol, rows, state: latestState(symbol, rows) });
      if ((i + 1) % 75 === 0) console.log(`Analyzed ${i + 1}/${symbols.length}`);
    } catch (err) {
      console.warn(`skip ${symbol}: ${err.message}`);
    }
  }
  return analyzed;
}

async function main() {
  const analyzed = await loadAnalyzedUniverse();
  const states = analyzed.map(a => a.state).sort((a, b) => b.score - a.score);
  const finalUniverse = chooseFinalUniverse(states);
  const bySymbol = new Map(analyzed.map(a => [a.symbol, a.rows]));
  const summaryRows = [];
  const samples = {};

  for (const symbol of finalUniverse) {
    const rows = bySymbol.get(symbol);
    if (!rows) continue;
    for (const strategyName of STRATEGIES) {
      for (const exitMode of EXIT_MODES) {
        for (const horizonDays of HORIZONS) {
          const results = rollingAnchors(rows, horizonDays).map(anchorIndex =>
            simulateRollingPath(rows, {
              anchorIndex,
              horizonDays,
              strategyName,
              exitMode,
              startingCapital: STARTING_CAPITAL,
            })
          );
          const summary = summarizeRollingResults(results);
          const row = { symbol, strategyName, exitMode, horizonDays, ...summary };
          summaryRows.push(row);
          const key = `${symbol}|${strategyName}|${exitMode}|${horizonDays}`;
          samples[key] = results.slice(-5);
        }
      }
    }
  }

  const currentSetups = states
    .filter(s => finalUniverse.includes(s.symbol))
    .sort((a, b) => b.score - a.score);

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'Yahoo Finance chart API via yahoo-finance2; NSE Nifty 500 constituent CSV when reachable',
    assumptions: {
      entryFill: 'next trading day open after Supertrend green signal',
      exitModes: {
        same_close: 'signal day close, approximating a near-close live exit decision',
        next_open: 'next trading day open after exit signal',
      },
      horizonsTradingDays: HORIZONS,
      startingCapital: STARTING_CAPITAL,
    },
    analyzedCount: analyzed.length,
    finalUniverse,
    currentSetups,
    summaries: summaryRows,
    recentSamplePaths: samples,
  };

  await writeFile(JSON_REPORT, JSON.stringify(report, null, 2));
  await writeFile(CSV_REPORT, toCsv(summaryRows));

  console.log('\nFinal rolling universe');
  console.log(finalUniverse.join(', '));

  console.log('\nCurrent setup snapshot');
  console.table(currentSetups.slice(0, 14).map(s => ({
    symbol: s.symbol,
    close: s.close,
    score: s.score,
    stGreen: s.stGreen,
    x100: s.cross100.crossed ? `${s.cross100.daysAgo}d` : '',
    x200: s.cross200.crossed ? `${s.cross200.daysAgo}d` : '',
    x250: s.cross250.crossed ? `${s.cross250.daysAgo}d` : '',
    ret1m: s.ret1m,
    ret3m: s.ret3m,
  })));

  console.log('\nBest 3M same-close rolling summaries by median return');
  console.table(summaryRows
    .filter(r => r.horizonDays === 63 && r.exitMode === 'same_close')
    .sort((a, b) => b.averageEnteredReturnPct - a.averageEnteredReturnPct)
    .slice(0, 20)
    .map(r => ({
      symbol: r.symbol,
      strategy: r.strategyName,
      count: r.count,
      noEntry: r.noEntryRatePct,
      entered: r.enteredCount,
      enteredWin: r.enteredWinRatePct,
      avgAll: r.averageReturnPct,
      avgEntered: r.averageEnteredReturnPct,
      medEntered: r.medianEnteredReturnPct,
      p5Entered: r.p5EnteredReturnPct,
      avgValue: r.averageEndingValue,
      dd: r.averageMaxDrawdownPct,
    })));

  console.log(`\nJSON report: ${JSON_REPORT}`);
  console.log(`CSV summary: ${CSV_REPORT}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
