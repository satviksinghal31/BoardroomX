// One-off DB introspection — read schema, RLS, row counts, users
import fs from 'fs';
import pg from 'pg';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);

const { Client } = pg;
const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const tables = await c.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
);
console.log('=== TABLES ===');
console.log(tables.rows.map(r => r.table_name).join('\n'));

for (const t of ['stocks', 'financials', 'results', 'profiles', 'watchlists']) {
  const cols = await c.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [t]
  );
  if (cols.rows.length) {
    console.log(`\n=== ${t} columns ===`);
    console.log(cols.rows.map(r => `  ${r.column_name} ${r.data_type}${r.is_nullable === 'NO' ? ' NOT NULL' : ''}`).join('\n'));
  } else {
    console.log(`\n=== ${t} : DOES NOT EXIST ===`);
  }
}

const rls = await c.query(
  `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
);
console.log('\n=== RLS STATUS ===');
console.log(rls.rows.map(r => `  ${r.tablename}: ${r.rowsecurity ? 'ENABLED' : 'disabled'}`).join('\n'));

const policies = await c.query(
  `SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public' ORDER BY tablename`
);
console.log('\n=== POLICIES ===');
console.log(policies.rows.length
  ? policies.rows.map(r => `  ${r.tablename} -> ${r.policyname} (${r.cmd})`).join('\n')
  : '  (none)');

const counts = await c.query(`
  SELECT 'stocks' AS t, count(*) AS n FROM stocks
  UNION ALL SELECT 'financials', count(*) FROM financials
  UNION ALL SELECT 'results', count(*) FROM results
`);
console.log('\n=== ROW COUNTS ===');
console.log(counts.rows.map(r => `  ${r.t}: ${r.n}`).join('\n'));

const sym = await c.query(`SELECT symbol FROM stocks ORDER BY symbol`);
console.log('  symbols:', sym.rows.map(r => r.symbol).join(', '));

const users = await c.query(`SELECT id, email, created_at FROM auth.users ORDER BY created_at LIMIT 20`);
console.log('\n=== AUTH USERS ===');
console.log(users.rows.map(r => `  ${r.id} ${r.email} (${r.created_at.toISOString()})`).join('\n'));

await c.end();
