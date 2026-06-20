// ─────────────────────────────────────────────────────────────────────────────
// Seed the `stocks` catalog with stubs for every active market-universe symbol.
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

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchMarketUniverse() {
  const PAGE = 1000;
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("market_universe")
      .select("symbol,company_name,display_name,is_active")
      .neq("is_active", false)
      .order("symbol")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

const universe = await fetchMarketUniverse();
console.log(`Universe: ${universe.length} active symbols.`);

// What's already in catalog?  (use upsert anyway — bullet-proof against races)
const { data: existing } = await sb.from("stocks").select("symbol");
const have = new Set((existing ?? []).map(r => r.symbol));
console.log(`Already in stocks table: ${have.size}.`);

const toInsert = universe
  .filter(u => !have.has(u.symbol))
  .map(u => ({
    symbol:          u.symbol,
    name:            u.company_name ?? u.display_name ?? u.symbol,
    screener_url:    `https://www.screener.in/company/${u.symbol}/`,
    screener_id:     null,
    yahoo_symbol:    null,
    is_consolidated: null,  // unknown until scrape
    is_banking:      false, // default; scrape will correct
    sector:          null,
  }));

console.log(`To insert: ${toInsert.length} new stubs.`);

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
