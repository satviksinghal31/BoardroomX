import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRow } from '../nse_events_cron.js';

test('buildRow creates unique_key from normalized natural identity', () => {
  const row = buildRow({
    symbol: ' advait ',
    company: ' Advait   Energy Transitions Limited ',
    purpose: ' Financial   Results/Dividend ',
    bm_desc: ' To consider  and approve the financial results ',
    date: '27-May-2026',
  });

  assert.equal(row.unique_key, 'ADVAIT|Financial Results/Dividend|To consider and approve the financial results|2026-05-27');
  assert.equal(row.symbol, 'ADVAIT');
  assert.equal(row.company, 'Advait Energy Transitions Limited');
  assert.equal(row.purpose, 'Financial Results/Dividend');
  assert.equal(row.bm_desc, 'To consider and approve the financial results');
  assert.equal(row.date, '27-May-2026');
});

test('buildRow keeps unknown date formats visible while still trimming them', () => {
  const row = buildRow({
    symbol: 'ABCOTS',
    purpose: 'Financial Results',
    bm_desc: 'Results',
    date: ' May 27, 2026 ',
  });

  assert.equal(row.unique_key, 'ABCOTS|Financial Results|Results|May 27, 2026');
  assert.equal(row.date, 'May 27, 2026');
});

test('buildRow canonicalizes numeric dates with basic day and month safeguards', () => {
  assert.equal(buildRow({
    symbol: 'ABCOTS',
    purpose: 'Financial Results',
    bm_desc: 'Results',
    date: '27-05-2026',
  }).unique_key, 'ABCOTS|Financial Results|Results|2026-05-27');

  assert.equal(buildRow({
    symbol: 'ABCOTS',
    purpose: 'Financial Results',
    bm_desc: 'Results',
    date: '05-27-2026',
  }).unique_key, 'ABCOTS|Financial Results|Results|2026-05-27');

  assert.equal(buildRow({
    symbol: 'ABCOTS',
    purpose: 'Financial Results',
    bm_desc: 'Results',
    date: '2026/05/27',
  }).unique_key, 'ABCOTS|Financial Results|Results|2026-05-27');
});

test('buildRow leaves impossible numeric dates raw instead of guessing', () => {
  assert.equal(buildRow({
    symbol: 'ABCOTS',
    purpose: 'Financial Results',
    bm_desc: 'Results',
    date: '13-27-2026',
  }).unique_key, 'ABCOTS|Financial Results|Results|13-27-2026');

  assert.equal(buildRow({
    symbol: 'ABCOTS',
    purpose: 'Financial Results',
    bm_desc: 'Results',
    date: '31-04-2026',
  }).unique_key, 'ABCOTS|Financial Results|Results|31-04-2026');
});
