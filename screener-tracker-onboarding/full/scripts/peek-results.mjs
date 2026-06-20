import fs from 'fs';
import pg from 'pg';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)];}));
const c = new pg.Client({connectionString: env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
await c.connect();

const stocks = ['BAJFINANCE', 'INFY', 'RELIANCE'];
for (const sym of stocks) {
  const r = await c.query(
    `SELECT quarter, reported_at, expected_at, (data->>'Sales')::text IS NOT NULL OR (data->>'Revenue')::text IS NOT NULL AS has_data
     FROM results WHERE symbol=$1 ORDER BY quarter`, [sym]
  );
  const total = r.rows.length;
  const withRep = r.rows.filter(x => x.reported_at).length;
  const withExp = r.rows.filter(x => x.expected_at).length;
  const withData = r.rows.filter(x => x.has_data).length;
  console.log(`\n${sym}: ${total} rows | ${withData} with data | ${withRep} reported_at | ${withExp} expected_at`);
  // Show the ones with reported_at
  const reported = r.rows.filter(x => x.reported_at).map(x => `${x.quarter}=${x.reported_at}`);
  console.log('  reported_at:', reported.join(', ') || '(none)');
}
await c.end();
