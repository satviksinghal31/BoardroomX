const STRATEGIES = {
  R1_ST_200DMA: {
    initialFraction: 1,
    canEnter(row) {
      return row.close > row.dma200;
    },
  },
  R2_ST_DMA_STACK: {
    initialFraction: 1,
    canEnter(row, prev) {
      return row.close > row.dma100 && row.close > row.dma200 && row.dma50 > prev.dma50;
    },
  },
  R3_ST_DMA_STACK_ADD: {
    initialFraction: 0.5,
    canEnter(row, prev) {
      return row.close > row.dma100 && row.close > row.dma200 && row.dma50 > prev.dma50;
    },
  },
};

function round2(value) {
  return Number.isFinite(value) ? +value.toFixed(2) : null;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[index];
}

function supertrendGreenFlip(rows, i) {
  return rows[i - 1]?.stDirection === 1 && rows[i]?.stDirection === -1;
}

function supertrendRedFlip(rows, i) {
  return rows[i - 1]?.stDirection === -1 && rows[i]?.stDirection === 1;
}

function exitSignal(row, rows, i) {
  if (row.close < row.dma21) return 'dma21_breakdown';
  if (supertrendRedFlip(rows, i)) return 'supertrend_red';
  return null;
}

function computeMaxDrawdown(values) {
  let peak = values[0] ?? 0;
  let maxDrawdown = 0;
  for (const value of values) {
    if (value > peak) peak = value;
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, (value / peak) - 1);
  }
  return maxDrawdown;
}

export function simulateRollingPath(rows, options) {
  const {
    anchorIndex,
    horizonDays,
    strategyName,
    exitMode,
    startingCapital = 100000,
  } = options;
  const strategy = STRATEGIES[strategyName];
  if (!strategy) throw new Error(`Unknown strategy: ${strategyName}`);
  if (!['same_close', 'next_open'].includes(exitMode)) throw new Error(`Unknown exit mode: ${exitMode}`);

  const endIndex = Math.min(rows.length - 1, anchorIndex + horizonDays);
  let cash = startingCapital;
  let qty = 0;
  let weightedEntry = 0;
  let initialStop = null;
  let addStage = 0;
  let totalContributedCapital = 0;
  const events = [];
  const equity = [];

  function currentValue(row) {
    return cash + qty * row.close;
  }

  function buy(signalRow, fillRow, fraction, type, reason) {
    const amount = startingCapital * fraction;
    const spend = Math.min(cash, amount);
    if (spend <= 0 || !Number.isFinite(fillRow.open)) return;
    const addQty = spend / fillRow.open;
    weightedEntry = qty > 0 ? ((weightedEntry * qty) + spend) / (qty + addQty) : fillRow.open;
    qty += addQty;
    cash -= spend;
    totalContributedCapital += spend;
    initialStop ??= signalRow.supertrend ?? signalRow.dma21 ?? fillRow.open;
    events.push({
      type,
      reason,
      signalDate: signalRow.date,
      fillDate: fillRow.date,
      fillPrice: fillRow.open,
      capitalDeployed: round2(spend),
      qty: round2(addQty),
    });
  }

  function sell(signalRow, fillRow, fillPrice, reason) {
    if (qty <= 0) return;
    const proceeds = qty * fillPrice;
    cash += proceeds;
    events.push({
      type: 'exit',
      reason,
      signalDate: signalRow.date,
      fillDate: fillRow.date,
      fillPrice,
      proceeds: round2(proceeds),
    });
    qty = 0;
    weightedEntry = 0;
    initialStop = null;
    addStage = 0;
  }

  for (let i = anchorIndex + 1; i <= endIndex; i++) {
    const row = rows[i];
    const prev = rows[i - 1];

    if (qty > 0) {
      const reason = exitSignal(row, rows, i);
      if (reason) {
        if (exitMode === 'same_close') {
          sell(row, row, row.close, reason);
        } else if (i + 1 < rows.length) {
          sell(row, rows[i + 1], rows[i + 1].open, reason);
          i += 1;
        }
        equity.push(currentValue(row));
        continue;
      }

      if (strategyName === 'R3_ST_DMA_STACK_ADD') {
        const stopMovedUp = Number.isFinite(row.supertrend) && row.supertrend > initialStop;
        if (addStage === 0 && row.close >= weightedEntry * 1.05 && stopMovedUp) {
          buy(row, row, 0.25, 'add', 'plus_5_pct_stop_moved_up');
          addStage = 1;
        }
        if (addStage === 1 && row.close >= weightedEntry * 1.1 && row.dma21 > weightedEntry) {
          buy(row, row, 0.25, 'add', 'plus_10_pct_dma21_above_entry');
          addStage = 2;
        }
      }
    }

    if (qty === 0 && supertrendGreenFlip(rows, i) && strategy.canEnter(row, prev) && i + 1 < rows.length && i + 1 <= endIndex) {
      buy(row, rows[i + 1], strategy.initialFraction, 'entry', 'supertrend_green');
      i += 1;
    }

    equity.push(currentValue(row));
  }

  const last = rows[endIndex];
  const endingValue = qty > 0 ? cash + qty * last.close : cash;
  if (qty > 0) {
    events.push({
      type: 'mark_to_market',
      reason: 'horizon_end',
      signalDate: last.date,
      fillDate: last.date,
      fillPrice: last.close,
      value: round2(endingValue),
    });
  }

  const entered = events.some(e => e.type === 'entry');
  return {
    anchorDate: rows[anchorIndex]?.date,
    horizonEndDate: last?.date,
    strategyName,
    exitMode,
    entered,
    events,
    endingValue: round2(endingValue),
    returnPct: endingValue / startingCapital - 1,
    maxDrawdownPct: computeMaxDrawdown([startingCapital, ...equity, endingValue]),
    totalContributedCapital: round2(totalContributedCapital),
    entries: events.filter(e => e.type === 'entry').length,
    reEntries: Math.max(0, events.filter(e => e.type === 'entry').length - 1),
  };
}

export function summarizeRollingResults(results) {
  const returns = results.map(r => r.returnPct).filter(Number.isFinite).sort((a, b) => a - b);
  const enteredResults = results.filter(r => r.entered);
  const enteredReturns = enteredResults.map(r => r.returnPct).filter(Number.isFinite).sort((a, b) => a - b);
  const count = results.length;
  const noEntry = results.filter(r => !r.entered).length;
  const wins = results.filter(r => r.returnPct > 0).length;
  const enteredWins = enteredResults.filter(r => r.returnPct > 0).length;
  const exitReasons = {};
  for (const result of results) {
    const exits = result.events?.filter(e => e.type === 'exit') ?? [];
    if (!result.entered) {
      exitReasons.no_entry = (exitReasons.no_entry ?? 0) + 1;
    } else if (exits.length === 0) {
      exitReasons.horizon_end = (exitReasons.horizon_end ?? 0) + 1;
    } else {
      for (const exit of exits) exitReasons[exit.reason] = (exitReasons[exit.reason] ?? 0) + 1;
    }
  }

  const averageReturn = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const averageEnteredReturn = enteredReturns.length ? enteredReturns.reduce((a, b) => a + b, 0) / enteredReturns.length : 0;
  const averageEndingValue = results.length
    ? results.reduce((sum, result) => sum + result.endingValue, 0) / results.length
    : 0;
  const averageMaxDrawdown = results.length
    ? results.reduce((sum, result) => sum + (result.maxDrawdownPct ?? 0), 0) / results.length
    : 0;

  return {
    count,
    noEntryRatePct: round2(count ? (noEntry / count) * 100 : 0),
    winRatePct: round2(count ? (wins / count) * 100 : 0),
    enteredCount: enteredResults.length,
    enteredWinRatePct: round2(enteredResults.length ? (enteredWins / enteredResults.length) * 100 : 0),
    averageReturnPct: round2(averageReturn * 100),
    averageEnteredReturnPct: round2(averageEnteredReturn * 100),
    medianReturnPct: round2((percentile(returns, 50) ?? 0) * 100),
    medianEnteredReturnPct: round2((percentile(enteredReturns, 50) ?? 0) * 100),
    p5EnteredReturnPct: round2((percentile(enteredReturns, 5) ?? 0) * 100),
    p95EnteredReturnPct: round2((percentile(enteredReturns, 95) ?? 0) * 100),
    p5ReturnPct: round2((percentile(returns, 5) ?? 0) * 100),
    p95ReturnPct: round2((percentile(returns, 95) ?? 0) * 100),
    averageEndingValue: round2(averageEndingValue),
    averageMaxDrawdownPct: round2(averageMaxDrawdown * 100),
    averageEntries: round2(results.reduce((sum, result) => sum + (result.entries ?? 0), 0) / (count || 1)),
    averageReEntries: round2(results.reduce((sum, result) => sum + (result.reEntries ?? 0), 0) / (count || 1)),
    exitReasons,
  };
}
