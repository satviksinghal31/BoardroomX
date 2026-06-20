import fs from "fs";
import pg from "pg";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l && !l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1)];}));
const c = new pg.Client({connectionString: env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
await c.connect();
const r = await c.query(`
  SELECT
    (SELECT count(*) FROM stocks) AS total_stocks,
    (SELECT count(*) FROM financials WHERE fetched_at IS NOT NULL) AS scraped,
    (SELECT count(*) FROM financials WHERE fetched_at < NOW() - INTERVAL '24 hours') AS stale,
    (SELECT count(*) FROM stocks WHERE symbol NOT IN (SELECT symbol FROM financials WHERE fetched_at IS NOT NULL)) AS never_scraped
`);
console.log(r.rows[0]);
await c.end();
