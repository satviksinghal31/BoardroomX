import fs from 'fs';
import pg from 'pg';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)];}));
const c = new pg.Client({connectionString: env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
await c.connect();
const r = await c.query(`SELECT user_id, symbol, position FROM watchlists ORDER BY user_id, position`);
console.log('Watchlist rows:', r.rows.length);
r.rows.forEach(x => console.log(' ', x.user_id.slice(0,8), x.symbol, 'pos='+x.position));
await c.end();
