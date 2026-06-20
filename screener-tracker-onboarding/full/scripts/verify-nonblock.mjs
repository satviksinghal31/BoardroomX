// Verify P2.2-C: POST /api/watchlist returns instantly (<1.5s) for a stub
// symbol with bootstrapping:true, instead of blocking on the 5-10s scrape.
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l && !l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1)];}));
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {auth:{persistSession:false,autoRefreshToken:false}});

const STUB_SYM = process.argv[2] || "NESTLEIND";
const PROD = process.env.PROD_URL || "https://portfolio-tracker-production-fe7d.up.railway.app";

const email = "qa.bootstrap." + Date.now() + "@mailinator.com";
const PASS = "QAVerify!@#secure12345";
const { data: u, error: cErr } = await admin.auth.admin.createUser({ email, password: PASS, email_confirm: true });
if (cErr) { console.error(cErr.message); process.exit(1); }
const { data: s } = await anon.auth.signInWithPassword({ email, password: PASS });
const token = s.session.access_token;
const userId = u.user.id;

try {
  const t0 = Date.now();
  const res = await fetch(`${PROD}/api/watchlist`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: STUB_SYM, name: "Test Add" }),
  });
  const dt = Date.now() - t0;
  const body = await res.json();
  console.log(`POST /api/watchlist ${STUB_SYM} → ${res.status} in ${dt}ms`);
  console.log(`  Response: ${JSON.stringify(body)}`);
  if (res.status === 200 && body.bootstrapping === true && dt < 1500) {
    console.log(`  ✓ Non-blocking confirmed (returned <1.5s with bootstrapping=true)`);
  } else if (res.status === 200 && body.bootstrapping === false) {
    console.log(`  ⓘ Symbol was already catalogued (financials already present) — non-blocking path skipped`);
  } else {
    console.log(`  ✗ FAIL — status ${res.status}, dt ${dt}ms, bootstrapping ${body.bootstrapping}`);
    process.exitCode = 1;
  }

  // Poll for completion to verify the async scrape actually runs
  console.log(`\nPolling /api/portfolio for quarters8 on ${STUB_SYM}…`);
  for (let i = 1; i <= 8; i++) {
    await new Promise(r => setTimeout(r, 4000));
    const pres = await fetch(`${PROD}/api/portfolio`, { headers: { Authorization: `Bearer ${token}` } });
    const arr = await pres.json();
    const stock = arr.find(x => x.symbol === STUB_SYM);
    if (!stock) { console.log(`  attempt ${i}: row not found?`); break; }
    if (stock.quarters8) {
      console.log(`  attempt ${i} (~${i*4}s after add): quarters8 ready ✓ (${stock.quarters8.labels.length} quarters)`);
      console.log(`  earningsMarkers: ${stock.earningsMarkers?.length || 0}`);
      break;
    }
    console.log(`  attempt ${i} (~${i*4}s): still bootstrapping…`);
  }
} finally {
  await admin.from("watchlists").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);
  console.log("\nCleaned up test user.");
}
