import fs from 'fs';
import pg from 'pg';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)];}));
const c = new pg.Client({connectionString: env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
await c.connect();
const r = await c.query(`
  SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name IN ('watchlists','stocks','profiles')
  ORDER BY table_name, grantee, privilege_type`);
let last = '';
for (const row of r.rows) {
  if (row.grantee !== last) { console.log(`\n${row.grantee}:`); last = row.grantee; }
}
// regroup by table
const byTable = {};
for (const row of r.rows) {
  byTable[row.table_name = row.table_name || ''] = byTable[row.table_name] || {};
}
// simpler grouped output
const r2 = await c.query(`
  SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name IN ('watchlists','stocks','profiles')
  GROUP BY table_name, grantee
  ORDER BY table_name, grantee`);
console.log('\n=== GRANTS ===');
for (const x of r2.rows) console.log(`  ${x.table_name.padEnd(12)} ${x.grantee.padEnd(20)} ${x.privs}`);
await c.end();
