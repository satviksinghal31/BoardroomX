const DEFAULT_CAPITAL = 100000;
const DEFAULT_ATR_PERIOD = 10;
const DEFAULT_ST_FACTOR = 3;

function avg(values) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function sma(rows, period, key = 'close') {
  const out = Array(rows.length).fill(null);
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    sum += rows[i][key] ?? 0;
    if (i >= period) sum -= rows[i - period][key] ?? 0;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function atr(rows, period) {
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

export function addIndicators(rows, { atrPeriod = DEFAULT_ATR_PERIOD, stFactor = DEFAULT_ST_FACTOR } = {}) {
  const dma20 = sma(rows, 20);
  const dma21 = sma(rows, 21);
  const dma50 = sma(rows, 50);
  const dma100 = sma(rows, 100);
  const dma200 = sma(rows, 200);
  const dma250 = sma(rows, 250);
  const vol20 = sma(rows, 20, 'volume');
  const atr10 = atr(rows, atrPeriod);
  const atr14 = atr(rows, 14);

  const basicUpper = rows.map((r, i) => ((r.high + r.low) / 2) + stFactor * (atr10[i] ?? 0));
  const basicLower = rows.map((r, i) => ((r.high + r.low) / 2) - stFactor * (atr10[i] ?? 0));
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
    dma21: dma21[i],
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

export function crossedAbove(rows, key, lookback) {
  const end = rows.length - 1;
  const start = Math.max(1, end - lookback + 1);
  for (let i = start; i <= end; i++) {
    if (rows[i - 1]?.[key] && rows[i].close > rows[i][key] && rows[i - 1].close <= rows[i - 1][key]) {
      return { crossed: true, daysAgo: end - i, date: rows[i].date };
    }
  }
  return { crossed: false, daysAgo: null, date: null };
}

export function ret(rows, days) {
  const last = rows.at(-1);
  const prev = rows.at(-(days + 1));
  return last && prev ? (last.close / prev.close) - 1 : null;
}

export function maxDrawdown(equity, initialCapital = DEFAULT_CAPITAL) {
  let peak = equity[0] ?? initialCapital;
  let maxDd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    maxDd = Math.min(maxDd, (v / peak) - 1);
  }
  return maxDd;
}
