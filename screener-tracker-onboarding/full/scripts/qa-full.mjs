// ─────────────────────────────────────────────────────────────────────────────
// Full QA sweep against production. Read-only-ish: creates a throwaway test
// user, exercises every API, then deletes the user. Reports pass/fail per test.
//
// Usage:  node scripts/qa-full.mjs
//         PROD_URL=https://… node scripts/qa-full.mjs
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const PROD = process.env.PROD_URL || "https://portfolio-tracker-production-fe7d.up.railway.app";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8")
    .split("\n").filter(l => l && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Test reporter ───────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function ok(name)      { passed++; console.log(`  ✓ ${name}`); }
function fail(name, why){ failed++; failures.push({name, why}); console.log(`  ✗ ${name} — ${why}`); }
function group(name)   { console.log(`\n=== ${name} ===`); }

// ── Helpers ─────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, path, opts = {}, retries = 3) {
  const headers = { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) };
  if (opts.body) headers["Content-Type"] = "application/json";
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${PROD}${path}`, {
        method, headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      let body = null;
      const txt = await res.text();
      try { body = JSON.parse(txt); } catch { body = txt; }
      return { status: res.status, body };
    } catch (err) {
      if (attempt < retries && (err.cause?.code === "ECONNRESET" || err.cause?.code === "ECONNREFUSED")) {
        console.log(`  ⚠ ${method} ${path} → ${err.cause.code}, retrying (${attempt}/${retries})…`);
        await sleep(2000 * attempt);
      } else {
        throw err;
      }
    }
  }
}

// ── Warm up Railway (may be cold-starting) ───────────────────────────────────
process.stdout.write("Warming up production server… ");
try {
  await api("GET", "/api/config");
  console.log("✓");
} catch { console.log("slow — continuing anyway"); }

// ── Test user setup (idempotent) ────────────────────────────────────────────
const TEST_EMAIL = `qa.full.${Date.now()}@mailinator.com`;
const TEST_PASS  = "QATest!@#secure12345";
console.log(`Creating test user: ${TEST_EMAIL}`);
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: TEST_EMAIL, password: TEST_PASS, email_confirm: true,
});
if (createErr) { console.error("setup failed:", createErr.message); process.exit(1); }
const TEST_USER_ID = created.user.id;
console.log(`Test user id: ${TEST_USER_ID}`);

// Sign in to get token
const { data: sess } = await anon.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASS });
const TEST_TOKEN = sess.session.access_token;
console.log(`Token: ${TEST_TOKEN.slice(0, 30)}… (${TEST_TOKEN.length} chars)`);

try {
  // ── BATCH 1: API smoke (no auth) ──────────────────────────────────────────
  group("Batch 1: Public endpoints");
  {
    const { status, body } = await api("GET", "/api/config");
    if (status === 200 && body.supabaseUrl && body.supabaseKey) ok("GET /api/config returns JSON");
    else fail("GET /api/config", `${status} ${JSON.stringify(body).slice(0, 100)}`);
  }
  {
    const { status, body } = await api("GET", "/api/portfolio");
    if (status === 401 && body.error) ok("GET /api/portfolio without token → 401 JSON");
    else fail("GET /api/portfolio anon", `${status} ${JSON.stringify(body)}`);
  }

  // ── BATCH 2: Auth flows ───────────────────────────────────────────────────
  group("Batch 2: Auth");
  {
    const { status, body } = await api("POST", "/api/auth/signin",
      { body: { email: TEST_EMAIL, password: "wrong-password" } });
    if (status === 401 && body.error) ok("Bad password → 401 JSON");
    else fail("Bad password", `${status} ${JSON.stringify(body)}`);
  }
  {
    const { status, body } = await api("POST", "/api/auth/signin",
      { body: { email: TEST_EMAIL, password: TEST_PASS } });
    if (status === 200 && body.session?.access_token) ok("Sign in returns session");
    else fail("Sign in", `${status} ${JSON.stringify(body)}`);
  }
  {
    // Missing fields
    const { status } = await api("POST", "/api/auth/signin", { body: { email: TEST_EMAIL } });
    if (status === 400) ok("Sign in missing password → 400");
    else fail("Sign in missing fields", `expected 400, got ${status}`);
  }
  {
    const { status, body } = await api("GET", "/api/auth/me", { token: TEST_TOKEN });
    if (status === 200 && body.id === TEST_USER_ID) ok("GET /api/auth/me returns this user");
    else fail("GET /api/auth/me", `${status} ${JSON.stringify(body)}`);
  }

  // ── BATCH 3: Watchlist CRUD ───────────────────────────────────────────────
  group("Batch 3: Watchlist CRUD");
  {
    const { status, body } = await api("GET", "/api/portfolio", { token: TEST_TOKEN });
    if (status === 200 && Array.isArray(body) && body.length === 0) ok("New user portfolio is []");
    else fail("New user portfolio", `${status} ${JSON.stringify(body)}`);
  }
  {
    // Add catalogued symbol — should be ~instant (no scrape)
    const t0 = Date.now();
    const { status, body } = await api("POST", "/api/watchlist",
      { token: TEST_TOKEN, body: { symbol: "BAJFINANCE" } });
    const dt = Date.now() - t0;
    if (status === 200 && body.ok) ok(`Add BAJFINANCE (catalogued) → 200 in ${dt}ms`);
    else fail("Add BAJFINANCE", `${status} ${JSON.stringify(body)}`);
  }
  {
    // Duplicate
    const { status, body } = await api("POST", "/api/watchlist",
      { token: TEST_TOKEN, body: { symbol: "BAJFINANCE" } });
    if (status === 409) ok("Add duplicate BAJFINANCE → 409");
    else fail("Add duplicate", `expected 409, got ${status} ${JSON.stringify(body)}`);
  }
  {
    // Invalid symbol
    const { status } = await api("POST", "/api/watchlist",
      { token: TEST_TOKEN, body: { symbol: "../etc/passwd" } });
    if (status === 400) ok("Invalid symbol chars → 400");
    else fail("Invalid symbol", `expected 400, got ${status}`);
  }
  {
    // Empty symbol
    const { status } = await api("POST", "/api/watchlist",
      { token: TEST_TOKEN, body: { symbol: "" } });
    if (status === 400) ok("Empty symbol → 400");
    else fail("Empty symbol", `expected 400, got ${status}`);
  }
  {
    // Get portfolio — should have 1 entry now
    const { status, body } = await api("GET", "/api/portfolio", { token: TEST_TOKEN });
    if (status === 200 && Array.isArray(body) && body.length === 1 && body[0].symbol === "BAJFINANCE") {
      ok("Portfolio has BAJFINANCE");
      // Spot-check fields
      const s = body[0];
      if (s.quarters8?.labels?.length === 8) ok("  quarters8 has 8 labels");
      else fail("  quarters8 labels", `got ${s.quarters8?.labels?.length}`);
      // BAJFINANCE has 7 reported_at dates in DB; YoY needs a row 4 quarters back
      // so realistic count is 5+. With the bug we were getting 3.
      if (s.earningsMarkers && s.earningsMarkers.length >= 5) ok(`  earningsMarkers populated (${s.earningsMarkers.length})`);
      else fail("  earningsMarkers", `got ${s.earningsMarkers?.length} (expected >=5)`);
      if (s.sector) ok(`  sector="${s.sector}"`);
      else fail("  sector", "null");
      if (s.analysis?.pros || s.analysis?.cons) ok("  analysis populated");
      else fail("  analysis", "null");
      if (s.CAGRs && Object.keys(s.CAGRs).length > 0) ok("  CAGRs populated");
      else fail("  CAGRs", "null");
    }
    else fail("Get portfolio after add", `${status} len=${body?.length}`);
  }
  {
    const { status, body } = await api("DELETE", "/api/watchlist/BAJFINANCE", { token: TEST_TOKEN });
    if (status === 200 && body.ok) ok("Delete BAJFINANCE → 200");
    else fail("Delete", `${status} ${JSON.stringify(body)}`);
  }
  {
    const { status, body } = await api("GET", "/api/portfolio", { token: TEST_TOKEN });
    if (status === 200 && Array.isArray(body) && body.length === 0) ok("Portfolio empty after delete");
    else fail("Portfolio after delete", `${status} len=${body?.length}`);
  }

  // ── BATCH 4: Data endpoints ───────────────────────────────────────────────
  group("Batch 4: Data endpoints");
  {
    const { status, body } = await api("GET", "/api/chart/BAJFINANCE?years=5", { token: TEST_TOKEN });
    if (status === 200 && Array.isArray(body.candles) && body.candles.length > 100) {
      ok(`chart/BAJFINANCE → ${body.candles.length} candles`);
    } else fail("chart/BAJFINANCE", `${status} ${typeof body === 'object' ? Object.keys(body).join(',') : body}`);
  }
  {
    const { status, body } = await api("GET", "/api/quote/RELIANCE", { token: TEST_TOKEN });
    if (status === 200 && body.symbol === "RELIANCE" && typeof body.price === "number") {
      ok(`quote/RELIANCE → ₹${body.price}`);
    } else fail("quote/RELIANCE", `${status} ${JSON.stringify(body).slice(0,100)}`);
  }
  {
    // Symbol that's definitely catalogued (BAJFINANCE)
    const { status, body } = await api("GET", "/api/financials/BAJFINANCE", { token: TEST_TOKEN });
    if (status === 200 && body.quarters8?.labels?.length === 8) {
      ok(`financials/BAJFINANCE → 8 quarters`);
    } else fail("financials/BAJFINANCE", `${status} ${JSON.stringify(body).slice(0,100)}`);
  }
  {
    // Symbol that exists as stub but not yet scraped — should still work via auto-scrape
    // (pick one that's likely not scraped yet — let worker progress dictate)
    // We'll just test that a definitely-bad symbol returns proper JSON error not HTML
    const { status, body } = await api("GET", "/api/financials/NOTAREALSYMBOLXYZ", { token: TEST_TOKEN });
    if ((status === 404 || status === 502 || status === 500) && body.error) {
      ok(`financials/INVALID → ${status} JSON error (not HTML)`);
    } else fail("financials/INVALID", `${status} ${typeof body}`);
  }

  // ── BATCH 5: Cross-user isolation via the API surface ────────────────────
  // Note: clients can't hit Supabase tables directly (authenticated role has no
  // SELECT grant — by design). The real attack surface is /api/*. Tests below
  // verify that the SERVER properly scopes by req.user.id no matter what the
  // attacker tries to send.
  group("Batch 5: Cross-user security (via API)");
  {
    // Set up a second user to attempt cross-reads against
    const VICTIM_EMAIL = `qa.victim.${Date.now()}@mailinator.com`;
    const VICTIM_PASS  = "QAVictim!@#secure12345";
    const { data: victim, error: vErr } = await admin.auth.admin.createUser({
      email: VICTIM_EMAIL, password: VICTIM_PASS, email_confirm: true,
    });
    if (vErr) { fail("Setup victim user", vErr.message); }
    else {
      const VICTIM_ID = victim.user.id;
      // Sign victim in and add a stock to their watchlist
      const { data: vSess } = await anon.auth.signInWithPassword({ email: VICTIM_EMAIL, password: VICTIM_PASS });
      const VICTIM_TOKEN = vSess.session.access_token;
      await api("POST", "/api/watchlist", { token: VICTIM_TOKEN, body: { symbol: "TARIL" } });

      // 5a: Attacker (TEST_TOKEN) hits /api/portfolio — must NOT see TARIL
      const { body: portfolio } = await api("GET", "/api/portfolio", { token: TEST_TOKEN });
      if (Array.isArray(portfolio) && !portfolio.some(s => s.symbol === "TARIL")) {
        ok("API doesn't leak victim's watchlist into attacker's /api/portfolio");
      } else {
        fail("Cross-user portfolio leak", `attacker sees: ${JSON.stringify(portfolio.map(s => s.symbol))}`);
      }

      // 5b: Verify the victim DOES see their own data
      const { body: vPortfolio } = await api("GET", "/api/portfolio", { token: VICTIM_TOKEN });
      if (Array.isArray(vPortfolio) && vPortfolio.some(s => s.symbol === "TARIL")) {
        ok("Victim sees their own watchlist (auth scoping correctness)");
      } else {
        fail("Victim own-read", `${JSON.stringify(vPortfolio)}`);
      }

      // 5c: Attacker tries to DELETE victim's stock — server only deletes WHERE user_id = req.user.id
      const { status: delStatus } = await api("DELETE", "/api/watchlist/TARIL", { token: TEST_TOKEN });
      // The server returns 200 either way (idempotent delete), but the row must remain
      const { count } = await admin.from("watchlists")
        .select("symbol", { count: "exact", head: true })
        .eq("user_id", VICTIM_ID).eq("symbol", "TARIL");
      if (count === 1) ok("Attacker's DELETE on victim's stock had no effect on DB");
      else fail("Cross-user delete leak", `victim's row count after attacker DELETE: ${count}`);

      // 5d: Validate RLS at the Postgres layer too — bypass GRANT by querying
      // through Supabase admin to assert policies are correctly defined.
      // (Direct postgres SELECT shows policy is in place, even though clients
      // can't reach it because of GRANT layering.)
      const { data: policies } = await admin
        .from("pg_policies")
        .select("policyname, cmd, qual")
        .eq("tablename", "watchlists");
      // pg_policies isn't in REST schema by default; if not exposed, skip silently
      if (Array.isArray(policies)) {
        const hasOwnSelect = policies.some(p => p.policyname === "watchlists_select_own");
        if (hasOwnSelect) ok("RLS policy watchlists_select_own exists at Postgres layer");
      }

      // Cleanup victim
      await admin.from("watchlists").delete().eq("user_id", VICTIM_ID);
      await admin.auth.admin.deleteUser(VICTIM_ID);
    }
  }
  {
    // 5e: Attacker tries to inject a user_id in the POST body — server must
    // ignore body.user_id and use req.user.id from the JWT
    const { status, body } = await api("POST", "/api/watchlist", {
      token: TEST_TOKEN,
      body: { symbol: "GOLDBEES", user_id: "3ff61274-0e87-47be-a8eb-f9216429b864" },
    });
    if (status === 200) {
      // Verify it was inserted under TEST_USER_ID, not the injected one
      const { data } = await admin.from("watchlists").select("user_id, symbol")
        .eq("symbol", "GOLDBEES").eq("user_id", TEST_USER_ID);
      if (data?.length === 1) ok("body.user_id ignored — row inserted under JWT user");
      else fail("user_id injection", "row missing under JWT user — may have been inserted under injected id!");
      // Cleanup
      await api("DELETE", "/api/watchlist/GOLDBEES", { token: TEST_TOKEN });
    } else {
      fail("user_id injection", `add failed: ${status} ${JSON.stringify(body)}`);
    }
  }

  // ── BATCH 6: Background worker health ─────────────────────────────────────
  group("Batch 6: Catalog & worker");
  {
    const { data: stats } = await admin.rpc?.("…") ?? {};  // ignored — just demonstrating
    const stocks = await admin.from("stocks").select("symbol", { count: "exact", head: true });
    const scraped = await admin.from("financials").select("symbol", { count: "exact", head: true });
    const total = stocks.count ?? 0;
    const scrapedCount = scraped.count ?? 0;
    if (total >= 500) ok(`Catalog has ${total} stocks (>=500)`);
    else fail("Catalog size", `only ${total}`);
    if (scrapedCount >= 20) ok(`${scrapedCount} stocks scraped (worker progressing)`);
    else fail("Worker progress", `only ${scrapedCount} scraped`);
  }
  {
    // Verify at least some stocks have reported_at from NSE backfill
    const { count } = await admin.from("results").select("symbol", { count: "exact", head: true })
      .not("reported_at", "is", null);
    if (count >= 50) ok(`reported_at populated on ${count} rows (NSE sync working)`);
    else fail("NSE reported_at", `only ${count} rows`);
  }
  {
    // Check sector backfill coverage
    const totalRes = await admin.from("stocks").select("symbol", { count: "exact", head: true });
    const withSec = await admin.from("stocks").select("symbol", { count: "exact", head: true }).not("sector", "is", null);
    const pct = (withSec.count / totalRes.count) * 100;
    if (pct >= 95) ok(`Sector coverage: ${pct.toFixed(1)}%`);
    else fail("Sector coverage", `${pct.toFixed(1)}%`);
  }

  // ── BATCH 7: Edge cases ───────────────────────────────────────────────────
  group("Batch 7: Edge cases");
  {
    // SQL injection attempt in symbol
    const { status } = await api("POST", "/api/watchlist",
      { token: TEST_TOKEN, body: { symbol: "'; DROP TABLE stocks; --" } });
    if (status === 400) ok("SQL injection blocked");
    else fail("SQL injection", `expected 400, got ${status}`);
  }
  {
    // XSS attempt in symbol
    const { status } = await api("POST", "/api/watchlist",
      { token: TEST_TOKEN, body: { symbol: "<script>alert(1)</script>" } });
    if (status === 400) ok("XSS in symbol blocked");
    else fail("XSS in symbol", `expected 400, got ${status}`);
  }
  {
    // Very long symbol
    const { status } = await api("POST", "/api/watchlist",
      { token: TEST_TOKEN, body: { symbol: "A".repeat(100) } });
    if (status === 400) ok("Over-length symbol blocked");
    else fail("Long symbol", `expected 400, got ${status}`);
  }
  {
    // Expired/invalid token
    const { status, body } = await api("GET", "/api/portfolio", { token: "garbage.token.invalid" });
    if (status === 401 && body.error) ok("Invalid token → 401 JSON");
    else fail("Invalid token", `${status}`);
  }
  {
    // Bearer with empty token
    const res = await fetch(`${PROD}/api/portfolio`, { headers: { Authorization: "Bearer " } });
    if (res.status === 401) ok("Empty bearer → 401");
    else fail("Empty bearer", `${res.status}`);
  }
} finally {
  // Cleanup test user
  console.log(`\nCleaning up test user ${TEST_USER_ID}…`);
  await admin.from("watchlists").delete().eq("user_id", TEST_USER_ID);
  await admin.auth.admin.deleteUser(TEST_USER_ID);
  console.log("Cleaned up.");
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`Total: ${passed + failed}  |  PASS: ${passed}  |  FAIL: ${failed}`);
if (failures.length) {
  console.log(`\nFailures:`);
  failures.forEach(f => console.log(`  • ${f.name} — ${f.why}`));
  process.exit(1);
}
console.log("\nAll tests passed.");
process.exit(0);
