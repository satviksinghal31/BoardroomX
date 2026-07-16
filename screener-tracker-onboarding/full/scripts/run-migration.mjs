// Run a SQL migration file against SUPABASE_DB_URL
// Usage: node scripts/run-migration.mjs migrations/001_multitenant.sql
import fs from 'fs';
import pg from 'pg';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/run-migration.mjs <file.sql>'); process.exit(1); }

function localEnv() {
  if (!fs.existsSync('.env')) return {};
  return Object.fromEntries(
    fs.readFileSync('.env', 'utf8')
      .split('\n')
      .filter(l => l && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
  );
}

const sql = fs.readFileSync(file, 'utf8');
const { Client } = pg;
const env = { ...localEnv(), ...process.env };
if (!env.SUPABASE_DB_URL) {
  console.error('SUPABASE_DB_URL is required');
  process.exit(1);
}
const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

try {
  await c.connect();
  console.log(`Running ${file}…`);
  const result = await c.query(sql);
  console.log('✅ Migration completed.');
  if (Array.isArray(result)) {
    console.log(`  Executed ${result.length} statements.`);
  }
} catch (err) {
  console.error('❌ Migration failed:', err.message);
  if (err.detail) console.error('  Detail:', err.detail);
  if (err.hint) console.error('  Hint:', err.hint);
  process.exit(1);
} finally {
  await c.end();
}
