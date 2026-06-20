// One-symbol Screener annuals worker.
//
// Intended Railway cron cadence: once per minute.
// Behavior: seed missing Dhan universe symbols, take advisory lock, process one
// eligible queue row, write annual financials, update status, exit.

import 'dotenv/config';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import {
  PARSER_VERSION,
  classifyScreenerError,
  fetchAndStoreScreenerAnnuals,
} from './lib/screener-annuals.mjs';

const HARD_TIMEOUT_MS = 55_000;
const LOCK_KEY = 'boardroomx-screener-annuals-worker';
const MAX_FAILURE_ATTEMPTS = 3;

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
  return new Pool({
    connectionString: requireEnv('SUPABASE_DB_URL'),
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
}

async function withTimeout(fn, timeoutMs) {
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

async function seedQueue(client) {
  await client.query(`
    UPDATE screener_fetch_queue
    SET status = 'retry',
        next_attempt_at = now(),
        last_error = COALESCE(last_error, 'Recovered stale fetching row'),
        updated_at = now()
    WHERE status = 'fetching'
      AND last_attempt_at < now() - interval '10 minutes'
  `);

  const result = await client.query(`
    INSERT INTO screener_fetch_queue (symbol, company_name, status, priority, created_at, updated_at)
    SELECT u.symbol, u.company_name, 'pending', 0, now(), now()
    FROM market_universe u
    WHERE u.is_active IS DISTINCT FROM false
    ON CONFLICT (symbol) DO UPDATE
      SET company_name = COALESCE(EXCLUDED.company_name, screener_fetch_queue.company_name),
          updated_at = screener_fetch_queue.updated_at
  `);
  return result.rowCount ?? 0;
}

async function claimNextSymbol(client) {
  await client.query('BEGIN');
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [LOCK_KEY]);
    if (!lock.rows?.[0]?.locked) {
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'lock_held' };
    }

    const claim = await client.query(`
      UPDATE screener_fetch_queue q
      SET status = 'fetching',
          attempts = attempts + 1,
          last_attempt_at = now(),
          last_error = null,
          updated_at = now()
      WHERE q.symbol = (
        SELECT symbol
        FROM screener_fetch_queue
        WHERE status IN ('pending', 'retry')
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY priority DESC, next_attempt_at NULLS FIRST, updated_at ASC, symbol ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING q.symbol, q.attempts
    `);

    await client.query('COMMIT');
    if (!claim.rows.length) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
      return { skipped: true, reason: 'nothing_eligible' };
    }
    return { symbol: claim.rows[0].symbol, attempts: claim.rows[0].attempts };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => {});
    throw err;
  }
}

async function updateQueueSuccess(client, result) {
  const nextAttemptSql = result.latestFyMissing ? "now() + interval '24 hours'" : 'NULL';
  await client.query(`
    UPDATE screener_fetch_queue
    SET status = $2,
        last_success_at = now(),
        next_attempt_at = ${nextAttemptSql},
        last_error = null,
        history_years_count = $3,
        history_complete = $4,
        latest_period = $5,
        latest_fy_available = $6,
        latest_fy_missing = $7,
        source_url = $8,
        updated_at = now()
    WHERE symbol = $1
  `, [
    result.symbol,
    result.status,
    result.historyYearsCount ?? 0,
    !!result.historyComplete,
    result.latestPeriod ?? null,
    !!result.latestFyAvailable,
    !!result.latestFyMissing,
    result.sourceUrl ?? null,
  ]);
}

async function updateQueueFailure(client, symbol, err) {
  const code = classifyScreenerError(err);
  const attemptsRes = await client.query(
    'SELECT attempts FROM screener_fetch_queue WHERE symbol = $1',
    [symbol],
  );
  const attempts = attemptsRes.rows?.[0]?.attempts ?? 1;
  const status = code === 'NOT_FOUND'
    ? 'skipped'
    : attempts >= MAX_FAILURE_ATTEMPTS
      ? 'failed'
      : 'retry';
  const nextAttemptSql = status === 'retry' ? "now() + interval '6 hours'" : 'NULL';
  await client.query(`
    UPDATE screener_fetch_queue
    SET status = $2,
        next_attempt_at = ${nextAttemptSql},
        last_error = $3,
        updated_at = now()
    WHERE symbol = $1
  `, [symbol, status, `${code}: ${err?.message || err}`.slice(0, 1000)]);
}

async function insertRun(client, payload) {
  await client.query(`
    INSERT INTO screener_fetch_runs
      (symbol, started_at, finished_at, status, message, duration_ms, rows_written, parser_version)
    VALUES ($1, to_timestamp($2 / 1000.0), now(), $3, $4, $5, $6, $7)
  `, [
    payload.symbol ?? null,
    payload.startedAt,
    payload.status,
    payload.message ?? null,
    payload.durationMs ?? 0,
    payload.rowsWritten ?? 0,
    PARSER_VERSION,
  ]);
}

async function runOnce() {
  const startedAt = Date.now();
  const pool = createPool();
  const supabase = createSupabaseClient();
  let client;
  let claimed;

  try {
    client = await pool.connect();
    await seedQueue(client);
    claimed = await claimNextSymbol(client);

    if (claimed.skipped) {
      await insertRun(client, {
        startedAt,
        status: 'skipped',
        message: claimed.reason,
        durationMs: Date.now() - startedAt,
      });
      return { status: 'skipped', reason: claimed.reason };
    }

    try {
      const result = await fetchAndStoreScreenerAnnuals(claimed.symbol, supabase);
      await updateQueueSuccess(client, result);
      await insertRun(client, {
        symbol: claimed.symbol,
        startedAt,
        status: result.status,
        message: result.message,
        durationMs: result.durationMs,
        rowsWritten: result.rowsWritten,
      });
      return result;
    } catch (err) {
      await updateQueueFailure(client, claimed.symbol, err);
      await insertRun(client, {
        symbol: claimed.symbol,
        startedAt,
        status: 'error',
        message: err?.message || String(err),
        durationMs: Date.now() - startedAt,
      });
      throw err;
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => {});
    }
  } finally {
    client?.release();
    await pool.end().catch(() => {});
  }
}

export async function main() {
  try {
    const result = await withTimeout(runOnce, HARD_TIMEOUT_MS);
    console.log(JSON.stringify(result));
    return 0;
  } catch (err) {
    console.error(`[screener-worker] ${err.message}`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
