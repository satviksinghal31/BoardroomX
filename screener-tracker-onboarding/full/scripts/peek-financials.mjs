import fs from 'fs';
import pg from 'pg';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)];}));
const c = new pg.Client({connectionString: env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
await c.connect();
const r = await c.query(`SELECT symbol, analysis, cagrs FROM financials WHERE symbol IN ('RELIANCE','INFY','BAJFINANCE') LIMIT 3`);
for (const row of r.rows) {
  console.log(`\n=== ${row.symbol} ===`);
  console.log('analysis:', row.analysis ? Object.keys(row.analysis) : 'null');
  if (row.analysis) console.log(JSON.stringify(row.analysis, null, 2).slice(0, 600));
  console.log('\ncagrs:', JSON.stringify(row.cagrs).slice(0, 300));
}
await c.end();
