// ─────────────────────────────────────────────────────────────────────────────
// Seed the `stocks` catalog with stubs for every NSE universe symbol.
//
// A stub is a stocks row with just { symbol, name, screener_url, is_banking=false }
// — no financials/results yet. The background worker (server.js) picks these
// up one at a time and runs scrapeAndStore() to populate full data.
//
// Idempotent: ON CONFLICT DO NOTHING — already-catalogued symbols stay
// untouched (we don't clobber their `is_banking`, `is_consolidated`, etc).
//
// Usage:  node scripts/seed-stub-catalog.mjs
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8")
    .split("\n").filter(l => l && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const universeRaw = JSON.parse(fs.readFileSync("data/nse_universe.json", "utf8"));
// Dedupe by symbol (universe sometimes has overlap)
const universe = Array.from(
  new Map(universeRaw.map(u => [u.symbol, u])).values()
);
console.log(`Universe: ${universeRaw.length} entries, ${universe.length} unique.`);

// What's already in catalog?  (use upsert anyway — bullet-proof against races)
const { data: existing } = await sb.from("stocks").select("symbol");
const have = new Set((existing ?? []).map(r => r.symbol));
console.log(`Already in stocks table: ${have.size}.`);

const toInsert = universe
  .filter(u => !have.has(u.symbol))
  .map(u => ({
    symbol:          u.symbol,
    name:            u.name,
    screener_url:    `https://www.screener.in/company/${u.symbol}/`,
    screener_id:     null,
    yahoo_symbol:    null,
    is_consolidated: null,  // unknown until scrape
    is_banking:      false, // default; scrape will correct
    sector:          u.sector ?? null,
  }));

console.log(`To insert: ${toInsert.length} new stubs.`);

// Always backfill sector on existing rows from universe — cheap and ensures
// previously-seeded stocks pick up sector info when the universe is updated.
console.log("Backfilling sector on existing rows from universe…");
let updated = 0;
for (const u of universe) {
  if (!u.sector) continue;
  const { error } = await sb
    .from("stocks")
    .update({ sector: u.sector })
    .eq("symbol", u.symbol)
    .is("sector", null);
  if (!error) updated++;
}
console.log(`  sector backfilled where missing: ${updated} symbols processed.`);

if (!toInsert.length) { console.log("Nothing to insert."); process.exit(0); }

// Insert in chunks of 200 to avoid huge payloads
const chunkSize = 200;
let inserted = 0;
for (let i = 0; i < toInsert.length; i += chunkSize) {
  const chunk = toInsert.slice(i, i + chunkSize);
  const { error } = await sb.from("stocks").upsert(chunk, { onConflict: "symbol", ignoreDuplicates: true });
  if (error) {
    console.error(`Chunk ${i}-${i + chunk.length} error:`, error.message);
  } else {
    inserted += chunk.length;
    process.stdout.write(`  inserted ${inserted}/${toInsert.length}\r`);
  }
}
console.log(`\nDone. Inserted ${inserted} stubs.`);
process.exit(0);
