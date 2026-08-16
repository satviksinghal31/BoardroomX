// One-off Railway Cron runner.
//
// Usage:
//   node scripts/run-cron.mjs events-cron
//   node scripts/run-cron.mjs eod-market-cap

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

import { runEventsCron } from '../nse_events_cron.js';
import { runEodMarketCap } from './eod-market-cap.mjs';
import { main as runScreenerAnnualsWorker } from './screener-worker.mjs';
import { runDhanInstrumentSync } from './dhan-instrument-sync.mjs';
import { runDhanEodUpdate } from './dhan-eod-update.mjs';
import { createNseQuarterlySource } from './lib/nse-quarterly-source.mjs';
import { observePoolErrors } from './lib/pg-pool.mjs';
import { createQuarterlyRepository, runQuarterlyResultsWorker } from './quarterly-results-worker.mjs';

const HARD_TIMEOUT_MS = 10 * 60 * 1000;

export const JOB_DEFS = {
  'events-cron': {
    scheduleIst: '08:00, 20:00 IST',
    cronUtc: '30 2,14 * * *',
    times: [{ h: 8, m: 0 }, { h: 20, m: 0 }],
  },
  'eod-market-cap': {
    scheduleIst: '18:30 IST',
    cronUtc: '0 13 * * *',
    times: [{ h: 18, m: 30 }],
  },
  'screener-annuals': {
    scheduleIst: 'Every minute',
    cronUtc: '* * * * *',
    times: [],
  },
  'quarterly-results': {
    scheduleIst: 'Every 5 minutes',
    cronUtc: '*/5 * * * *',
    times: [],
  },
  'dhan-instrument-sync': {
    scheduleIst: '07:30 IST',
    cronUtc: '0 2 * * *',
    times: [{ h: 7, m: 30 }],
  },
  'dhan-eod-update': {
    scheduleIst: '16:00 IST',
    cronUtc: '30 10 * * *',
    times: [{ h: 16, m: 0 }],
  },
};

export function nextIstRunIso(times, now = new Date()) {
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  let best = null;

  for (const { h, m } of times) {
    const candidateIst = new Date(istNow);
    candidateIst.setHours(h, m, 0, 0);
    if (candidateIst <= istNow) candidateIst.setDate(candidateIst.getDate() + 1);

    const offsetMs = candidateIst.getTime() - istNow.getTime();
    const candidateUtc = new Date(now.getTime() + offsetMs);
    if (!best || candidateUtc < best) best = candidateUtc;
  }

  return best.toISOString();
}

export function getCronJobs(now = new Date()) {
  return Object.entries(JOB_DEFS).map(([job, def]) => ({
    job,
    next_run: def.times.length ? nextIstRunIso(def.times, now) : null,
    schedule_ist: def.scheduleIst,
    cron_utc: def.cronUtc,
  }));
}

export function formatTerminalMessage(_job, result, elapsedMs) {
  const { _retryMs, _retryReason, ...publicResult } = result ?? {};
  return `completed in ${(elapsedMs / 1000).toFixed(1)}s - ${JSON.stringify(publicResult)}`;
}

export function isJobDisabled(job, env = process.env) {
  const disabled = String(env.DISABLE_JOBS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (disabled.includes('*') || disabled.includes(job)) return true;
  const envName = `DISABLE_JOB_${job.toUpperCase().replaceAll('-', '_')}`;
  return /^(1|true|yes)$/i.test(String(env[envName] ?? ''));
}

export async function withAdvisoryLock(pool, job, fn) {
  const lock = await pool.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [job]);
  if (!lock.rows?.[0]?.locked) return { status: 'skipped', reason: 'lock_held' };

  try {
    return { status: 'ran', result: await fn() };
  } finally {
    await pool.query('SELECT pg_advisory_unlock(hashtext($1)) AS unlocked', [job]);
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function createSupabaseClient() {
  return createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function createPool() {
  const { Pool } = pg;
  return observePoolErrors(new Pool({
    connectionString: requireEnv('SUPABASE_DB_URL'),
    ssl: { rejectUnauthorized: false },
    max: 1,
  }));
}

async function writeLog(supabase, job, status, message) {
  const { error } = await supabase
    .from('scheduler_log')
    .insert({ job, status, message, ts: new Date().toISOString() });
  if (error) throw new Error(`scheduler_log insert failed: ${error.message}`);
}

async function runWithTimeout(fn, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`hard timeout after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function runJob(job) {
  if (!JOB_DEFS[job]) {
    throw new Error(`Unknown job "${job}". Expected one of: ${Object.keys(JOB_DEFS).join(', ')}`);
  }

  if (isJobDisabled(job)) {
    console.warn(`[${job}] disabled by environment`);
    return { exitCode: 0, result: { status: 'disabled' } };
  }

  const supabase = createSupabaseClient();
  const pool = createPool();
  const startedAt = Date.now();

  try {
    await writeLog(supabase, job, 'started', 'started');

    const lockedRun = await withAdvisoryLock(pool, job, async () => {
      if (job === 'events-cron') return runEventsCron(supabase);
      if (job === 'screener-annuals') {
        const exitCode = await runScreenerAnnualsWorker();
        if (exitCode !== 0) throw new Error(`screener-annuals worker exited ${exitCode}`);
        return { exitCode };
      }
      if (job === 'quarterly-results') {
        return runQuarterlyResultsWorker({
          source: createNseQuarterlySource(),
          repository: createQuarterlyRepository(pool),
        });
      }
      if (job === 'dhan-instrument-sync') return runDhanInstrumentSync({ supabase });
      if (job === 'dhan-eod-update') return runDhanEodUpdate({ supabase });
      return runEodMarketCap({ supabase });
    });

    if (lockedRun.status === 'skipped') {
      await writeLog(supabase, job, 'skipped', lockedRun.reason);
      return { exitCode: 0, result: lockedRun };
    }

    const message = formatTerminalMessage(job, lockedRun.result, Date.now() - startedAt);
    await writeLog(supabase, job, 'ok', message);
    return { exitCode: 0, result: lockedRun.result };
  } catch (err) {
    await writeLog(supabase, job, 'error', err.message).catch(logErr => {
      console.error(`[${job}] failed to write error log: ${logErr.message}`);
    });
    return { exitCode: 1, error: err };
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function main(argv = process.argv) {
  const job = argv[2];
  if (!job) {
    console.error(`Usage: node scripts/run-cron.mjs <${Object.keys(JOB_DEFS).join('|')}>`);
    return 1;
  }

  const { exitCode, result, error } = await runWithTimeout(() => runJob(job), HARD_TIMEOUT_MS);
  if (error) console.error(`[${job}] error: ${error.message}`);
  else console.log(`[${job}] ${JSON.stringify(result)}`);
  return exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
