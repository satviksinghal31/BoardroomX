import 'dotenv/config';

import pg from 'pg';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url} failed ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function verifyDb(pool) {
  const active = await pool.query(`
    SELECT count(*)::int AS count
    FROM nse_universe
    WHERE is_active IS DISTINCT FROM false
      AND dhan_security_id IS NOT NULL
  `);
  const samples = await pool.query(`
    SELECT symbol, count(*)::int AS candles
    FROM dhan_daily_candles
    WHERE symbol = ANY($1)
    GROUP BY symbol
    ORDER BY symbol
  `, [['RELIANCE', 'TCS', 'HDFCBANK']]);

  return {
    active_mapped: active.rows[0]?.count ?? 0,
    sample_candles: samples.rows,
  };
}

async function verifyApi(baseUrl, token) {
  const headers = token ? ` with bearer token` : ` without bearer token`;
  console.log(`[verify-dhan] API base ${baseUrl}${headers}`);
  const [chart, quote, health] = await Promise.all([
    fetchJson(`${baseUrl}/api/chart/RELIANCE`, token),
    fetchJson(`${baseUrl}/api/quote/RELIANCE`, token),
    fetchJson(`${baseUrl}/api/dhan/health`, token),
  ]);

  return {
    chart_shape: {
      candles_is_array: Array.isArray(chart.candles),
      displayFrom: chart.displayFrom ?? null,
      candle_count: Array.isArray(chart.candles) ? chart.candles.length : null,
    },
    quote_shape: {
      symbol: quote.symbol,
      has_pe: Object.prototype.hasOwnProperty.call(quote, 'pe'),
      has_forwardPE: Object.prototype.hasOwnProperty.call(quote, 'forwardPE'),
    },
    health,
  };
}

export async function main() {
  const { Pool } = pg;
  const pool = new Pool({
    connectionString: requireEnv('SUPABASE_DB_URL'),
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  try {
    const result = { db: await verifyDb(pool) };
    if (process.env.BOARDROOMX_BASE_URL) {
      result.api = await verifyApi(process.env.BOARDROOMX_BASE_URL.replace(/\/$/, ''), process.env.BOARDROOMX_BEARER_TOKEN);
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await pool.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(`[verify-dhan] ${err.message}`);
    process.exitCode = 1;
  });
}
