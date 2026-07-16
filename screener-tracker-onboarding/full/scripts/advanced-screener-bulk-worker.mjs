import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import pg from 'pg';

const execFileAsync = promisify(execFile);
const DEFAULT_DELAY_SECONDS = 1;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function createPool() {
  const { Pool } = pg;
  return new Pool({
    connectionString: requireEnv('SUPABASE_DB_URL'),
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
}

function normalizeSymbol(value) {
  const symbol = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9&-]+$/.test(symbol)) throw new Error(`Invalid symbol: ${value}`);
  return symbol;
}

function parseSymbolList(value) {
  const seen = new Set();
  const symbols = [];
  for (const part of String(value ?? '').split(/[\s,]+/)) {
    if (!part) continue;
    const symbol = normalizeSymbol(part);
    if (!seen.has(symbol)) {
      seen.add(symbol);
      symbols.push(symbol);
    }
  }
  return symbols;
}

export function parseWorkerArgs(argv = process.argv) {
  const args = {
    runId: null,
    symbols: [],
    source: null,
    statement: 'consolidated',
    delaySeconds: DEFAULT_DELAY_SECONDS,
    sections: [],
    limit: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${flag} requires a value`);
      return argv[i];
    };
    if (flag === '--run-id') args.runId = Number(next());
    else if (flag === '--symbols') args.symbols = parseSymbolList(next());
    else if (flag === '--source') args.source = next();
    else if (flag === '--statement') args.statement = next();
    else if (flag === '--delay') args.delaySeconds = Number(next());
    else if (flag === '--sections') args.sections = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (flag === '--limit') args.limit = Number(next());
    else throw new Error(`Unknown argument: ${flag}`);
  }

  if (!['consolidated', 'standalone'].includes(args.statement)) {
    throw new Error('--statement must be consolidated or standalone');
  }
  if (!Number.isFinite(args.delaySeconds) || args.delaySeconds < 0) {
    throw new Error('--delay must be a non-negative number');
  }
  return args;
}

export function snapshotRowFromScrape(data) {
  const profitYears = data?.profit_loss?.years ?? [];
  const quarterYears = data?.quarters?.years ?? [];
  return {
    symbol: normalizeSymbol(data?.ticker),
    statement_type: data?.statement_type ?? 'consolidated',
    company_name: data?.name ?? null,
    source_url: data?.url ?? null,
    is_consolidated: Boolean(data?.is_consolidated),
    parser_version: data?.parser_version ?? null,
    section_status: data?.section_status ?? {},
    latest_profit_loss_period: profitYears.at(-1) ?? null,
    latest_quarter_period: quarterYears.at(-1) ?? null,
    payload: data,
  };
}

async function sleep(ms) {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeSymbolWithPython(symbol, options) {
  const outDir = await mkdtemp(join(tmpdir(), 'boardroomx-screener-'));
  try {
    const args = [
      '-m',
      'screener_scraper',
      '--ticker',
      symbol,
      '--statement',
      options.statement,
      '--out-dir',
      outDir,
      '--delay',
      '0',
    ];
    if (options.sections?.length) args.push('--sections', ...options.sections);

    await execFileAsync('python3', args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: 'scripts' },
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    const json = await readFile(join(outDir, `${symbol}_${options.statement}.json`), 'utf8');
    return JSON.parse(json);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

async function insertRun(client, options, symbols) {
  const result = await client.query(`
    INSERT INTO screener_bulk_runs
      (status, statement_type, delay_seconds, sections, requested_total, started_at)
    VALUES ('running', $1, $2, $3, $4, now())
    RETURNING id
  `, [options.statement, options.delaySeconds, options.sections ?? [], symbols.length]);
  const runId = result.rows[0].id;
  for (const symbol of symbols) {
    await client.query(`
      INSERT INTO screener_bulk_run_items (run_id, symbol, status)
      VALUES ($1, $2, 'pending')
      ON CONFLICT (run_id, symbol) DO NOTHING
    `, [runId, symbol]);
  }
  return runId;
}

async function symbolsFromMarketUniverse(client, limit = null) {
  const limitSql = limit ? 'LIMIT $1' : '';
  const params = limit ? [limit] : [];
  const result = await client.query(`
    SELECT symbol
    FROM market_universe
    WHERE is_active IS DISTINCT FROM false
    ORDER BY symbol ASC
    ${limitSql}
  `, params);
  return result.rows.map(row => normalizeSymbol(row.symbol));
}

async function symbolsForRun(client, runId, limit = null) {
  const limitSql = limit ? 'LIMIT $2' : '';
  const params = limit ? [runId, limit] : [runId];
  const result = await client.query(`
    SELECT symbol
    FROM screener_bulk_run_items
    WHERE run_id = $1
      AND status IN ('pending', 'retry')
    ORDER BY created_at ASC, symbol ASC
    ${limitSql}
  `, params);
  return result.rows.map(row => normalizeSymbol(row.symbol));
}

async function markItemStarted(client, runId, symbol) {
  if (!runId) return;
  await client.query(`
    UPDATE screener_bulk_run_items
    SET status = 'running',
        attempts = attempts + 1,
        started_at = now(),
        error = null,
        updated_at = now()
    WHERE run_id = $1 AND symbol = $2
  `, [runId, symbol]);
}

async function persistSnapshot(client, runId, data) {
  const row = snapshotRowFromScrape(data);
  await client.query(`
    INSERT INTO screener_company_snapshots
      (symbol, statement_type, company_name, source_url, is_consolidated,
       parser_version, section_status, latest_profit_loss_period,
       latest_quarter_period, payload, scraped_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, now(), now())
    ON CONFLICT (symbol, statement_type) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      source_url = EXCLUDED.source_url,
      is_consolidated = EXCLUDED.is_consolidated,
      parser_version = EXCLUDED.parser_version,
      section_status = EXCLUDED.section_status,
      latest_profit_loss_period = EXCLUDED.latest_profit_loss_period,
      latest_quarter_period = EXCLUDED.latest_quarter_period,
      payload = EXCLUDED.payload,
      scraped_at = EXCLUDED.scraped_at,
      updated_at = now()
  `, [
    row.symbol,
    row.statement_type,
    row.company_name,
    row.source_url,
    row.is_consolidated,
    row.parser_version,
    JSON.stringify(row.section_status),
    row.latest_profit_loss_period,
    row.latest_quarter_period,
    JSON.stringify(row.payload),
  ]);

  if (runId) {
    await client.query(`
      UPDATE screener_bulk_run_items
      SET status = 'complete',
          finished_at = now(),
          snapshot_updated_at = now(),
          error = null,
          updated_at = now()
      WHERE run_id = $1 AND symbol = $2
    `, [runId, row.symbol]);
  }
}

async function markFailure(client, runId, symbol, error) {
  if (!runId) return;
  await client.query(`
    UPDATE screener_bulk_run_items
    SET status = 'failed',
        finished_at = now(),
        error = $3,
        updated_at = now()
    WHERE run_id = $1 AND symbol = $2
  `, [runId, symbol, String(error?.message ?? error).slice(0, 1000)]);
}

async function finishRun(client, runId) {
  if (!runId) return;
  await client.query(`
    UPDATE screener_bulk_runs r
    SET completed_count = counts.completed,
        failed_count = counts.failed,
        status = CASE
          WHEN counts.failed > 0 AND counts.pending = 0 THEN 'partial'
          WHEN counts.pending = 0 THEN 'complete'
          ELSE 'running'
        END,
        finished_at = CASE WHEN counts.pending = 0 THEN now() ELSE NULL END,
        updated_at = now()
    FROM (
      SELECT
        count(*) FILTER (WHERE status = 'complete') AS completed,
        count(*) FILTER (WHERE status = 'failed') AS failed,
        count(*) FILTER (WHERE status IN ('pending', 'retry', 'running')) AS pending
      FROM screener_bulk_run_items
      WHERE run_id = $1
    ) counts
    WHERE r.id = $1
  `, [runId]);
}

export async function processSymbolsSequentially(symbols, deps) {
  const {
    delaySeconds = DEFAULT_DELAY_SECONDS,
    scrapeSymbol,
    persistSymbol,
    markFailure: markFailureFn,
    sleep: sleepFn = sleep,
  } = deps;
  let completed = 0;
  let failed = 0;

  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = symbols[index];
    try {
      const data = await scrapeSymbol(symbol);
      await persistSymbol(symbol, data);
      completed += 1;
    } catch (err) {
      failed += 1;
      await markFailureFn(symbol, err);
    }
    if (index < symbols.length - 1) {
      await sleepFn(Math.round(delaySeconds * 1000));
    }
  }

  return { completed, failed, total: symbols.length };
}

export async function runBulk(options) {
  const pool = createPool();
  const client = await pool.connect();
  let runId = options.runId;
  try {
    let symbols = options.symbols;
    if (!symbols.length && options.source === 'market_universe') {
      symbols = await symbolsFromMarketUniverse(client, options.limit);
    }
    if (!symbols.length && runId) {
      symbols = await symbolsForRun(client, runId, options.limit);
    }
    if (!symbols.length) throw new Error('No symbols provided. Use --symbols, --source market_universe, or --run-id.');
    if (!runId) runId = await insertRun(client, options, symbols);

    const result = await processSymbolsSequentially(symbols, {
      delaySeconds: options.delaySeconds,
      scrapeSymbol: async symbol => {
        await markItemStarted(client, runId, symbol);
        return scrapeSymbolWithPython(symbol, options);
      },
      persistSymbol: async (_symbol, data) => persistSnapshot(client, runId, data),
      markFailure: async (symbol, err) => markFailure(client, runId, symbol, err),
    });
    await finishRun(client, runId);
    return { status: result.failed ? 'partial' : 'complete', runId, ...result };
  } finally {
    client.release();
    await pool.end();
  }
}

export async function main(argv = process.argv) {
  try {
    const options = parseWorkerArgs(argv);
    const result = await runBulk(options);
    console.log(JSON.stringify(result));
    return result.failed ? 1 : 0;
  } catch (err) {
    console.error(`[advanced-screener-bulk] ${err.message}`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
