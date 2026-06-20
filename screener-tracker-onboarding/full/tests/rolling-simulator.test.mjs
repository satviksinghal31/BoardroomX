import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  simulateRollingPath,
  summarizeRollingResults,
} from '../scripts/lib/rolling-simulator.mjs';

function row(day, overrides = {}) {
  const close = overrides.close ?? 100;
  return {
    date: `2026-01-${String(day).padStart(2, '0')}`,
    open: overrides.open ?? close,
    high: overrides.high ?? close,
    low: overrides.low ?? close,
    close,
    volume: 1000000,
    dma21: overrides.dma21 ?? 90,
    dma50: overrides.dma50 ?? 95,
    dma100: overrides.dma100 ?? 90,
    dma200: overrides.dma200 ?? 85,
    dma250: overrides.dma250 ?? 80,
    supertrend: overrides.supertrend ?? 90,
    stDirection: overrides.stDirection ?? 1,
  };
}

test('enters at next open after a valid red-to-green Supertrend signal', () => {
  const rows = [
    row(1, { close: 98, stDirection: 1 }),
    row(2, { close: 105, stDirection: -1 }),
    row(3, { open: 107, close: 110, stDirection: -1 }),
    row(4, { close: 112, stDirection: -1 }),
  ];

  const result = simulateRollingPath(rows, {
    anchorIndex: 0,
    horizonDays: 3,
    strategyName: 'R1_ST_200DMA',
    exitMode: 'same_close',
    startingCapital: 100000,
  });

  assert.equal(result.events[0].type, 'entry');
  assert.equal(result.events[0].signalDate, '2026-01-02');
  assert.equal(result.events[0].fillDate, '2026-01-03');
  assert.equal(result.events[0].fillPrice, 107);
});

test('same_close exit fills on signal close while next_open fills next open', () => {
  const rows = [
    row(1, { close: 98, stDirection: 1 }),
    row(2, { close: 105, stDirection: -1 }),
    row(3, { open: 106, close: 108, stDirection: -1, dma21: 100 }),
    row(4, { open: 109, close: 99, stDirection: -1, dma21: 100 }),
    row(5, { open: 96, close: 97, stDirection: -1, dma21: 100 }),
  ];

  const sameClose = simulateRollingPath(rows, {
    anchorIndex: 0,
    horizonDays: 4,
    strategyName: 'R1_ST_200DMA',
    exitMode: 'same_close',
    startingCapital: 100000,
  });
  const nextOpen = simulateRollingPath(rows, {
    anchorIndex: 0,
    horizonDays: 4,
    strategyName: 'R1_ST_200DMA',
    exitMode: 'next_open',
    startingCapital: 100000,
  });

  assert.equal(sameClose.events.at(-1).type, 'exit');
  assert.equal(sameClose.events.at(-1).fillDate, '2026-01-04');
  assert.equal(sameClose.events.at(-1).fillPrice, 99);
  assert.equal(nextOpen.events.at(-1).fillDate, '2026-01-05');
  assert.equal(nextOpen.events.at(-1).fillPrice, 96);
});

test('re-enters only after a fresh red-to-green flip after an exit', () => {
  const rows = [
    row(1, { close: 98, stDirection: 1 }),
    row(2, { close: 105, stDirection: -1 }),
    row(3, { open: 106, close: 108, stDirection: -1, dma21: 100 }),
    row(4, { close: 99, stDirection: -1, dma21: 100 }),
    row(5, { open: 100, close: 112, stDirection: -1, dma21: 100 }),
    row(6, { close: 98, stDirection: 1, dma21: 100 }),
    row(7, { close: 115, stDirection: -1, dma21: 105 }),
    row(8, { open: 116, close: 118, stDirection: -1, dma21: 106 }),
  ];

  const result = simulateRollingPath(rows, {
    anchorIndex: 0,
    horizonDays: 7,
    strategyName: 'R1_ST_200DMA',
    exitMode: 'same_close',
    startingCapital: 100000,
  });

  assert.deepEqual(
    result.events.filter(e => e.type === 'entry').map(e => e.fillDate),
    ['2026-01-03', '2026-01-08'],
  );
});

test('R3 averages up only after profitable progress and never above total capital', () => {
  const rows = [
    row(1, { close: 98, stDirection: 1, dma50: 90 }),
    row(2, { close: 105, stDirection: -1, dma50: 91 }),
    row(3, { open: 100, close: 104, stDirection: -1, dma21: 95, dma50: 92, supertrend: 90 }),
    row(4, { close: 106, stDirection: -1, dma21: 98, dma50: 93, supertrend: 96 }),
    row(5, { close: 112, stDirection: -1, dma21: 103, dma50: 94, supertrend: 101 }),
    row(6, { close: 115, stDirection: -1, dma21: 105, dma50: 95, supertrend: 104 }),
  ];

  const result = simulateRollingPath(rows, {
    anchorIndex: 0,
    horizonDays: 5,
    strategyName: 'R3_ST_DMA_STACK_ADD',
    exitMode: 'same_close',
    startingCapital: 100000,
  });

  const adds = result.events.filter(e => e.type === 'add');
  assert.equal(result.events[0].capitalDeployed, 50000);
  assert.equal(adds.length, 2);
  assert.equal(result.totalContributedCapital, 100000);
  assert.ok(result.endingValue > 109000);
});

test('summarizeRollingResults reports no-entry rate and percentile outcomes', () => {
  const summary = summarizeRollingResults([
    { returnPct: 0.1, endingValue: 110000, maxDrawdownPct: -0.02, entered: true, events: [{ type: 'exit', reason: 'dma21_breakdown' }] },
    { returnPct: -0.05, endingValue: 95000, maxDrawdownPct: -0.08, entered: true, events: [{ type: 'exit', reason: 'supertrend_red' }] },
    { returnPct: 0, endingValue: 100000, maxDrawdownPct: 0, entered: false, events: [] },
  ]);

  assert.equal(summary.count, 3);
  assert.equal(summary.noEntryRatePct, 33.33);
  assert.equal(summary.winRatePct, 33.33);
  assert.equal(summary.enteredWinRatePct, 50);
  assert.equal(summary.averageEnteredReturnPct, 2.5);
  assert.equal(summary.averageEndingValue, 101666.67);
  assert.deepEqual(summary.exitReasons, {
    dma21_breakdown: 1,
    supertrend_red: 1,
    no_entry: 1,
  });
});
