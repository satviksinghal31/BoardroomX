import assert from 'node:assert/strict';
import test from 'node:test';

import {
  comparisonPeriods,
  growthPercent,
  parseNsePeriodEnd,
} from '../scripts/lib/quarter-periods.mjs';

test('resolves June quarter comparisons', () => {
  assert.deepEqual(comparisonPeriods('2026-06-30'), {
    current: '2026-06-30',
    previous: '2026-03-31',
    priorYear: '2025-06-30',
  });
});

test('resolves March quarter across the calendar-year boundary', () => {
  assert.deepEqual(comparisonPeriods('2026-03-31'), {
    current: '2026-03-31',
    previous: '2025-12-31',
    priorYear: '2025-03-31',
  });
});

test('parses NSE period-end text without timezone conversion', () => {
  assert.equal(parseNsePeriodEnd('30-JUN-2026'), '2026-06-30');
  assert.equal(parseNsePeriodEnd('31-MAR-2024'), '2024-03-31');
});

test('rejects dates that are not exact quarter ends', () => {
  assert.throws(() => comparisonPeriods('2026-05-31'), /quarter end/i);
  assert.throws(() => parseNsePeriodEnd('29-FEB-2024'), /quarter end/i);
});

test('calculates one-decimal growth from exact integer strings', () => {
  assert.equal(growthPercent('65544400000', '115542100000'), -43.3);
  assert.equal(growthPercent('125', '100'), 25.0);
});

test('returns null when a comparison value is zero or missing', () => {
  assert.equal(growthPercent('100', '0'), null);
  assert.equal(growthPercent(null, '100'), null);
  assert.equal(growthPercent('100', null), null);
});

