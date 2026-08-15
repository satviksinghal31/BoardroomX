import 'dotenv/config';
import pg from 'pg';

import { createNseQuarterlySource } from './lib/nse-quarterly-source.mjs';
import {
  createQuarterlyRepository,
  ingestDiscoveredFilings,
  processDueFilings,
} from './quarterly-results-worker.mjs';

function requireEnv(name, env = process.env) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function bootstrapLatestQuarterFilings({ source, repository, pageSize = 200 }) {
  const latestFilings = [];
  let latestPeriod = null;
  let page = 1;
  let pagesFetched = 0;

  while (true) {
    const result = await source.fetchLatestPage({ page, size: pageSize });
    pagesFetched += 1;
    if (page === 1) {
      latestPeriod = result.filings.map((filing) => filing.periodEnd).sort().at(-1) ?? null;
      if (!latestPeriod) {
        return {
          latestPeriod: null,
          pagesFetched,
          discovery: { discovered: 0, inserted: 0, rejected: 0 },
        };
      }
    }
    latestFilings.push(...result.filings.filter((filing) => filing.periodEnd === latestPeriod));

    if (page * pageSize >= result.totalCount || result.filings.length === 0) break;
    page += 1;
  }

  return {
    latestPeriod,
    pagesFetched,
    discovery: await ingestDiscoveredFilings({ filings: latestFilings, source, repository }),
  };
}

export async function runQuarterlyResultsBackfill({ source, repository, now = new Date(), pageSize = 200 }) {
  const bootstrap = await bootstrapLatestQuarterFilings({ source, repository, pageSize });
  const processing = await processDueFilings({ source, repository, now });
  return { ...bootstrap, processing };
}

export async function main() {
  const { Pool } = pg;
  const pool = new Pool({
    connectionString: requireEnv('SUPABASE_DB_URL'),
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  try {
    const result = await runQuarterlyResultsBackfill({
      source: createNseQuarterlySource(),
      repository: createQuarterlyRepository(pool),
    });
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    console.error(`[quarterly-results-backfill] ${error.message}`);
    return 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
