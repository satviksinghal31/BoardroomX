import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatTerminalMessage,
  getCronJobs,
  nextIstRunIso,
  withAdvisoryLock,
} from '../scripts/run-cron.mjs';

test('nextIstRunIso returns the next matching IST slot as a UTC ISO timestamp', () => {
  const now = new Date('2026-05-27T01:00:00.000Z'); // 06:30 IST
  assert.equal(nextIstRunIso([{ h: 8, m: 0 }, { h: 20, m: 0 }], now), '2026-05-27T02:30:00.000Z');

  const afterLastSlot = new Date('2026-05-27T15:30:00.000Z'); // 21:00 IST
  assert.equal(nextIstRunIso([{ h: 8, m: 0 }, { h: 20, m: 0 }], afterLastSlot), '2026-05-28T02:30:00.000Z');
});

test('getCronJobs exposes the Railway Cron schedules used by God Mode', () => {
  const jobs = getCronJobs(new Date('2026-05-27T01:00:00.000Z'));
  assert.deepEqual(
    jobs.map(j => [j.job, j.schedule_ist, j.cron_utc]),
    [
      ['events-cron', '08:00, 20:00 IST', '30 2,14 * * *'],
      ['eod-market-cap', '18:30 IST', '0 13 * * *'],
      ['screener-annuals', 'Every minute', '* * * * *'],
      ['dhan-instrument-sync', '07:30 IST', '0 2 * * *'],
      ['dhan-eod-update', '16:00 IST', '30 10 * * *'],
    ],
  );
  assert.equal(jobs[0].next_run, '2026-05-27T02:30:00.000Z');
  assert.equal(jobs[1].next_run, '2026-05-27T13:00:00.000Z');
  assert.equal(jobs[2].next_run, null);
  assert.equal(jobs[3].next_run, '2026-05-27T02:00:00.000Z');
  assert.equal(jobs[4].next_run, '2026-05-27T10:30:00.000Z');
});

test('formatTerminalMessage strips internal retry metadata from logged results', () => {
  assert.equal(
    formatTerminalMessage('events-cron', { fetched: 20, upserted: 12, new: 3, dup: 9 }, 1234),
    'completed in 1.2s - {"fetched":20,"upserted":12,"new":3,"dup":9}',
  );

  assert.equal(
    formatTerminalMessage('eod-market-cap', { updated: 0, total: 0, _retryMs: 900000, _retryReason: 'no_bhavcopy' }, 250),
    'completed in 0.3s - {"updated":0,"total":0}',
  );
});

test('withAdvisoryLock returns skipped without running job when lock is held', async () => {
  let ran = false;
  const fakePool = {
    async query(sql) {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: false }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  const result = await withAdvisoryLock(fakePool, 'events-cron', async () => {
    ran = true;
  });

  assert.equal(ran, false);
  assert.deepEqual(result, { status: 'skipped', reason: 'lock_held' });
});

test('withAdvisoryLock unlocks after a successful job run', async () => {
  const queries = [];
  const fakePool = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  const result = await withAdvisoryLock(fakePool, 'events-cron', async () => ({ ok: true }));

  assert.deepEqual(result, { status: 'ran', result: { ok: true } });
  assert.equal(queries.some(sql => sql.includes('pg_advisory_unlock')), true);
});
