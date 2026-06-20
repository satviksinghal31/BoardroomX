import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isFreshLiveTick,
  isNseMarketOpenIst,
  todayIstDate,
} from '../scripts/lib/dhan-time.mjs';

test('isNseMarketOpenIst is true only during regular NSE session', () => {
  assert.equal(isNseMarketOpenIst(new Date('2026-06-22T03:44:00.000Z')), false);
  assert.equal(isNseMarketOpenIst(new Date('2026-06-22T03:45:00.000Z')), true);
  assert.equal(isNseMarketOpenIst(new Date('2026-06-22T10:00:00.000Z')), true);
  assert.equal(isNseMarketOpenIst(new Date('2026-06-22T10:01:00.000Z')), false);
});

test('isFreshLiveTick uses a 90 second freshness window by default', () => {
  const now = new Date('2026-06-22T05:00:00.000Z');

  assert.equal(isFreshLiveTick('2026-06-22T04:58:31.000Z', now), true);
  assert.equal(isFreshLiveTick('2026-06-22T04:58:29.000Z', now), false);
  assert.equal(isFreshLiveTick(null, now), false);
});

test('todayIstDate returns YYYY-MM-DD in Asia/Kolkata', () => {
  assert.equal(todayIstDate(new Date('2026-06-21T20:00:00.000Z')), '2026-06-22');
});
