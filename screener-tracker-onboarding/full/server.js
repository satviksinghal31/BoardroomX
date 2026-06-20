import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import "dotenv/config";
import { registerAuthRoutes } from "./auth_routes.js";
import { registerKiteRoutes } from "./kite_routes.js";
import { requireAuth } from "./auth_middleware.js";
import { scrapeAndStore } from "./scraper.js";
import { getCronJobs } from "./scripts/run-cron.mjs";
import { createDhanMarketData } from "./dhan_market_data.js";
import { registerDhanRoutes } from "./dhan_routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_PORTFOLIO_SIZE = 30;

const _portfolio = JSON.parse(readFileSync(join(__dirname, "portfolio.json"), "utf8"));

if (_portfolio.length > MAX_PORTFOLIO_SIZE) {
  console.error(`ERROR: portfolio.json has ${_portfolio.length} stocks — max allowed is ${MAX_PORTFOLIO_SIZE}. Remove entries and restart.`);
  process.exit(1);
}

console.log(`Portfolio: ${_portfolio.length}/${MAX_PORTFOLIO_SIZE} stocks loaded.`);

const sectorMap   = Object.fromEntries(_portfolio.map(c => [c.symbol, c.sector      ?? null]));
const _portfolioSymbols = _portfolio.map(c => c.symbol);

const app = express();
const PORT = process.env.PORT || 3001;

// `supabase` is the SERVER-SIDE ADMIN client. It uses the service_role key
// and MUST NEVER call signInWithPassword / setSession — that would pollute
// its auth state and downgrade later .from() calls to the signed-in user's
// role (then RLS/grants kick in and admin operations start failing).
// persistSession:false and autoRefreshToken:false guarantee the client stays
// stateless and always runs as service_role.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// `supabaseAuth` is dedicated to user sign-in/up flows. It uses the ANON
// key (which can call .auth.signInWithPassword to mint JWTs) and is NEVER
// used for .from() table queries.
const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ── Direct Postgres pool ──────────────────────────────────────────────────────
// Used for internal server-side queries that must load full tables.
// Supabase's REST API (PostgREST) hard-caps every response at 1000 rows,
// even when .range() asks for more — pagination would still work but is slower.
// Direct pg queries have NO row limit and don't go through PostgREST at all.
//
// RULE: use `dbPool` for any SELECT that may return >1000 rows.
//       use `supabase` (REST) for mutations (INSERT/UPDATE/UPSERT/DELETE)
//       and for simple lookups where the 1000-row cap is irrelevant.
//
// `let` (not const) so _verifyDbPool() can null it out if connectivity fails.
const { Pool } = pg;
let dbPool = process.env.SUPABASE_DB_URL
  ? new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, max: 3 })
  : null;

/** Fired once at startup. Tests a real connection to catch bad URLs, firewall
 *  blocks, or wrong credentials before the first request arrives.
 *  On failure: logs the full error and nulls dbPool. Endpoints that require
 *  direct SQL call getRequiredDbPool() so they fail loudly instead of reading
 *  from a capped fallback source. */
async function _verifyDbPool() {
  if (!dbPool) {
    console.warn('[db] ⚠ SUPABASE_DB_URL not set — direct SQL unavailable');
    return;
  }
  let client;
  try {
    client = await dbPool.connect();
    client.release();
    console.log('[db] pg pool connected OK — direct SQL active for large reads');
  } catch (err) {
    console.error('[db] ⛔ pg pool FAILED TO CONNECT:', err.message);
    console.error('[db] ⛔ Check SUPABASE_DB_URL in Railway vars. Pool disabled until a direct reconnect succeeds.');
    console.error('[db] ⛔ Tip: try the Supabase connection pooler URL (port 6543) instead of direct (port 5432)');
    await dbPool.end().catch(() => {});
    dbPool = null;
  }
}

async function getRequiredDbPool() {
  if (dbPool) return dbPool;
  if (!process.env.SUPABASE_DB_URL) {
    throw new Error('Annuals requires SUPABASE_DB_URL / direct DB pool');
  }

  const candidate = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });

  let client;
  try {
    client = await candidate.connect();
    client.release();
    dbPool = candidate;
    console.log('[db] pg pool reconnected OK — direct SQL active');
    return dbPool;
  } catch (err) {
    if (client) client.release();
    await candidate.end().catch(() => {});
    throw new Error(`Annuals DB pool unavailable: ${err.message}`);
  }
}

app.use(express.static(join(__dirname, "public")));
app.use(express.json());

// ── Auth & Kite routes ─────────────────────────────────────────────────────
// Pass BOTH clients: admin for createUser/getUser, auth for signInWithPassword
registerAuthRoutes(app, supabase, supabaseAuth);
registerKiteRoutes(app, supabase);

// ── Auth middleware factory ────────────────────────────────────────────────
// Applied per-route below to every /api/* endpoint that needs user context.
// NOT applied to /api/auth/* (the auth routes themselves) or /api/config
// (clients need the supabase URL/anon-key BEFORE they can authenticate).
const auth = requireAuth(supabase);
const dhanMarketData = createDhanMarketData({
  dbPool: {
    query: async (...args) => {
      const pool = await getRequiredDbPool();
      return pool.query(...args);
    },
  },
});

registerDhanRoutes(app, {
  auth,
  marketData: dhanMarketData,
  getVisiblePriceSymbols: req => {
    const extra = String(req.query?.symbols ?? '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    return [...new Set([..._portfolioSymbols, ...extra])];
  },
});

// ── SPA page routes ────────────────────────────────────────────────────────
app.get("/auth", (_req, res) =>
  res.sendFile(join(__dirname, "public", "auth.html"))
);
app.get("/kite-connect", (_req, res) =>
  res.sendFile(join(__dirname, "public", "kite-connect.html"))
);
app.get("/godmode", (_req, res) =>
  res.sendFile(join(__dirname, "public", "godmode.html"))
);
// /bm-schema route removed (bm-schema.html deleted in Phase 6);

// ── Helpers ────────────────────────────────────────────────────────────────

function calcGrowth(curr, prev) {
  if (curr == null || prev == null || prev === 0) return null;
  return +((curr - prev) / Math.abs(prev) * 100).toFixed(1);
}

const Q_SEQ     = ["Mar", "Jun", "Sep", "Dec"];
const Q_ORDER   = { Mar: 0, Jun: 1, Sep: 2, Dec: 3 };
const Q_END_MON = { Mar: 2, Jun: 5, Sep: 8, Dec: 11 };

function quarterSort(a, b) {
  const [am, ay] = a.split(" ");
  const [bm, by] = b.split(" ");
  return parseInt(ay) !== parseInt(by)
    ? parseInt(ay) - parseInt(by)
    : Q_ORDER[am] - Q_ORDER[bm];
}

function shortLabel(header) {
  if (!header) return null;
  const [m, y] = header.split(" ");
  return `${m}'${y.slice(2)}`;
}

function nextQuarterHeader(lastHeader) {
  if (!lastHeader) return null;
  const [mon, yr] = lastHeader.split(" ");
  const year  = parseInt(yr);
  const idx   = Q_SEQ.indexOf(mon);
  const nextM = Q_SEQ[(idx + 1) % 4];
  const nextY = nextM === "Mar" && mon === "Dec" ? year + 1 : year;
  return `${nextM} ${nextY}`;
}

function quarterStatus(resultRows) {
  // resultRows: sorted array of result rows for one stock (data rows only)
  const withData = resultRows.filter(r => r.data && Object.keys(r.data).length > 0);
  if (!withData.length) return null;

  const lastHeader = withData.at(-1).quarter;
  const nextHeader = nextQuarterHeader(lastHeader);

  // Check if next quarter has an expected date (set by fetch_ann.py)
  const nextRow      = resultRows.find(r => r.quarter === nextHeader);
  const nextBoardDate = nextRow?.expected_at ?? null;

  const [nextMon, nextYr] = nextHeader.split(" ");
  const endMonth     = Q_END_MON[nextMon];
  const nextEnd      = new Date(parseInt(nextYr), endMonth + 1, 0);
  const daysAfterEnd = (new Date() - nextEnd) / 86400000;

  let nextStatus;
  if (daysAfterEnd < 0)       nextStatus = "upcoming";
  else if (daysAfterEnd < 75) nextStatus = "awaiting";
  else                        nextStatus = "overdue";

  return {
    lastLabel:     shortLabel(lastHeader),
    nextLabel:     shortLabel(nextHeader),
    nextStatus,
    nextBoardDate,
  };
}

// ── API ────────────────────────────────────────────────────────────────────

app.get("/api/config", (req, res) => {
  res.json({
    supabaseUrl:      process.env.SUPABASE_URL,
    supabaseKey:      process.env.SUPABASE_ANON_KEY,
    portfolioCount:   _portfolio.length,
    maxPortfolioSize: MAX_PORTFOLIO_SIZE,
  });
});

app.get("/api/portfolio", auth, async (req, res) => {
  // 1. Read THIS user's watchlist (symbols + display order)
  const { data: wl, error: wlErr } = await supabase
    .from("watchlists")
    .select("symbol, position")
    .eq("user_id", req.user.id)
    .order("position", { ascending: true });

  if (wlErr) {
    console.error("[/api/portfolio] watchlist read error:", wlErr.message);
    return res.status(500).json({ error: wlErr.message });
  }

  // Empty watchlist → return [] (new user / onboarding state). Not an error.
  if (!wl || wl.length === 0) return res.json([]);

  const symbols       = wl.map(w => w.symbol);
  const orderBySymbol = Object.fromEntries(wl.map(w => [w.symbol, w.position]));

  // 2. Fetch global market data ONLY for this user's symbols
  const [
    { data: stocks,   error: se },
    { data: fins,     error: fe },
    { data: allResults, error: re },
  ] = await Promise.all([
    supabase.from("stocks").select("*").in("symbol", symbols),
    supabase.from("financials").select("*").in("symbol", symbols),
    supabase.from("results").select("*").in("symbol", symbols),
  ]);

  if (se || fe || re) return res.status(500).json({ error: (se || fe || re).message });

  // Build lookup maps
  const finMap = Object.fromEntries((fins ?? []).map(f => [f.symbol, f]));

  // Group result rows by symbol, sorted chronologically
  const resultMap = {};
  for (const row of allResults ?? []) {
    if (!resultMap[row.symbol]) resultMap[row.symbol] = [];
    resultMap[row.symbol].push(row);
  }
  for (const sym of Object.keys(resultMap)) {
    resultMap[sym].sort((a, b) => quarterSort(a.quarter, b.quarter));
  }

  const portfolio = await Promise.all(
    (stocks ?? []).map(async (stock) => {
      const fin        = finMap[stock.symbol] ?? null;
      const rows       = resultMap[stock.symbol] ?? [];
      const withData   = rows.filter(r => r.data && Object.keys(r.data).length > 0);
      const marketData = await dhanMarketData.getQuote(stock.symbol).catch(() => ({}));

      const isBanking = stock.is_banking ?? false;
      const revKey    = isBanking ? "Revenue"            : "Sales";
      const profKey   = isBanking ? "Financing Profit"   : "Operating Profit";
      const margKey   = isBanking ? "Financing Margin %"  : "OPM %";

      let yoyRevGrowth = null, yoyEarningsGrowth = null;
      let latestQuarter = null, quarters8 = null;

      if (withData.length) {
        const lRow = withData.at(-1);
        const pRow = withData.at(-5) ?? null;

        yoyRevGrowth      = calcGrowth(lRow.data[revKey],        pRow?.data?.[revKey]);
        yoyEarningsGrowth = calcGrowth(lRow.data["Net Profit"],  pRow?.data?.["Net Profit"]);

        latestQuarter = {
          label:          lRow.quarter,
          prevLabel:      pRow?.quarter         ?? null,
          revenue:        lRow.data[revKey]      ?? null,
          prevRevenue:    pRow?.data?.[revKey]   ?? null,
          coreProfit:     lRow.data[profKey]     ?? null,
          prevCoreProfit: pRow?.data?.[profKey]  ?? null,
          margin:         lRow.data[margKey]     ?? null,
          netProfit:      lRow.data["Net Profit"]     ?? null,
          prevNetProfit:  pRow?.data?.["Net Profit"]  ?? null,
          eps:            lRow.data["EPS in Rs"]      ?? null,
          prevEps:        pRow?.data?.["EPS in Rs"]   ?? null,
          grossNpa:       lRow.data["Gross NPA %"]    ?? null,
          netNpa:         lRow.data["Net NPA %"]      ?? null,
        };

        const vis = withData.slice(-8);
        quarters8 = {
          labels:     vis.map(r => r.quarter),
          revenue:    vis.map(r => r.data[revKey]            ?? null),
          coreProfit: vis.map(r => r.data[profKey]           ?? null),
          margin:     vis.map(r => r.data[margKey]           ?? null),
          netProfit:  vis.map(r => r.data["Net Profit"]      ?? null),
          eps:        vis.map(r => r.data["EPS in Rs"]       ?? null),
          grossNpa:   vis.map(r => r.data["Gross NPA %"]     ?? null),
          netNpa:     vis.map(r => r.data["Net NPA %"]       ?? null),
        };
      }

      // Earnings markers — reported results (green/red) + upcoming board meetings (yellow)
      // Look up YoY prev row by quarter position in withData (chronological), NOT in
      // the filtered list — earlier we indexed the filtered array which dropped
      // every marker whose 4-quarter-prior didn't happen to also have reported_at.
      const reportedMarkers = withData
        .filter(r => r.reported_at)
        .map((r) => {
          const wIdx = withData.indexOf(r);
          const pRow = wIdx >= 4 ? withData[wIdx - 4] : null;
          const revGrowth = calcGrowth(r.data[revKey],       pRow?.data?.[revKey]);
          const netGrowth = calcGrowth(r.data["Net Profit"], pRow?.data?.["Net Profit"]);
          // Skip marker if no YoY comparison is possible (not enough historical DB data).
          // Gray circles only appear for genuinely new listings — not DB gaps.
          if (revGrowth === null && netGrowth === null) return null;
          return {
            time:      r.reported_at,
            quarter:   r.quarter,
            revenue:   r.data[revKey]       ?? null,
            netProfit: r.data["Net Profit"] ?? null,
            revGrowth,
            netGrowth,
            pending:   false,
          };
        })
        .filter(Boolean);

      const pendingMarkers = rows
        .filter(r => r.expected_at && !r.reported_at)
        .map(r => ({
          time:      r.expected_at,
          quarter:   r.quarter,
          revenue:   null, netProfit: null, revGrowth: null, netGrowth: null,
          pending:   true,
        }));

      const earningsMarkers = [...reportedMarkers, ...pendingMarkers]
        .sort((a, b) => a.time.localeCompare(b.time));

      return {
        symbol:           stock.symbol,
        name:             stock.name,
        // sector lives on the stocks row now (populated from data/nse_universe.json
        // during seed). Falling back to sectorMap covers the legacy 14 in
        // portfolio.json whose stocks rows pre-date the column.
        sector:           stock.sector ?? sectorMap[stock.symbol] ?? null,
        isBanking,
        isConsolidated:   stock.is_consolidated ?? null,
        marketData,
        yoyRevGrowth,
        yoyEarningsGrowth,
        latestQuarter,
        quarters8,
        earningsMarkers,
        quarterStatus:    quarterStatus(rows),
        CAGRs:            fin?.cagrs    ?? null,
        analysis:         fin?.analysis ?? null,
        lastFetched:      fin?.fetched_at ?? null,
      };
    })
  );

  // Sort by the user's chosen watchlist position
  portfolio.sort((a, b) =>
    (orderBySymbol[a.symbol] ?? 0) - (orderBySymbol[b.symbol] ?? 0)
  );

  res.json(portfolio);
});

// ── Watchlist mutations (per-user) ─────────────────────────────────────────
// POST /api/watchlist        — body: { symbol, name? } → add to user's watchlist
// DELETE /api/watchlist/:sym — remove from user's watchlist
// PATCH /api/watchlist/reorder — body: { order: ["SYM1", "SYM2", ...] }

app.post("/api/watchlist", auth, async (req, res) => {
  try {
    const symbolRaw = (req.body?.symbol || "").trim().toUpperCase();
    const nameHint  = (req.body?.name || "").trim() || null;

    if (!symbolRaw || !/^[A-Z0-9&\-]+$/i.test(symbolRaw)) {
      return res.status(400).json({ error: "Invalid symbol" });
    }
    if (symbolRaw.length > 20) {
      return res.status(400).json({ error: "Symbol too long" });
    }

    // 1-3. All independent reads in PARALLEL: duplicate check, watchlist size,
    //      catalog presence, financials freshness, current max position.
    //      Cuts ~600-1000ms off the response on Supabase Cloud round-trips.
    const [
      { data: existing },
      { count },
      { data: catalog },
      { data: fin },
      { data: maxRow },
    ] = await Promise.all([
      supabase.from("watchlists")
        .select("symbol").eq("user_id", req.user.id).eq("symbol", symbolRaw).maybeSingle(),
      supabase.from("watchlists")
        .select("symbol", { count: "exact", head: true }).eq("user_id", req.user.id),
      supabase.from("stocks")
        .select("symbol, name").eq("symbol", symbolRaw).maybeSingle(),
      supabase.from("financials")
        .select("fetched_at").eq("symbol", symbolRaw).maybeSingle(),
      supabase.from("watchlists")
        .select("position").eq("user_id", req.user.id)
        .order("position", { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (existing) {
      return res.status(409).json({ error: "Already in watchlist", symbol: symbolRaw });
    }
    if ((count ?? 0) >= MAX_PORTFOLIO_SIZE) {
      return res.status(400).json({
        error: `Watchlist limit reached (${MAX_PORTFOLIO_SIZE}). Remove a stock first.`
      });
    }

    const inCatalog     = !!catalog;
    const hasFinancials = !!fin?.fetched_at;
    const needsScrape   = !inCatalog || !hasFinancials;

    // If not in catalog at all, create a stub IMMEDIATELY so the watchlist FK
    // is satisfied. The full scrape happens async after we respond.
    if (!inCatalog) {
      const { error: stubErr } = await supabase.from("stocks").insert({
        symbol:          symbolRaw,
        name:            nameHint || symbolRaw,
        screener_url:    `https://www.screener.in/company/${symbolRaw}/`,
        is_consolidated: null,
        is_banking:      false,
      });
      if (stubErr) {
        console.error("[POST /api/watchlist] stub insert error:", stubErr.message);
        return res.status(500).json({ error: stubErr.message });
      }
    }

    // 4. Append to user's watchlist at next position (maxRow fetched in parallel above)
    const nextPos = (maxRow?.position ?? -1) + 1;

    const { error: insErr } = await supabase
      .from("watchlists")
      .insert({
        user_id:  req.user.id,
        symbol:   symbolRaw,
        position: nextPos,
      });
    if (insErr) {
      console.error("[POST /api/watchlist] insert error:", insErr.message);
      return res.status(500).json({ error: insErr.message });
    }

    // 5. Fire-and-forget scrape if financials aren't ready. Don't await — user
    //    gets the row in their watchlist instantly; the background job (or this
    //    one) populates data within a few seconds. Client polls /api/portfolio
    //    until quarters8 appears.
    if (needsScrape) {
      scrapeAndStore(symbolRaw, { name: nameHint }, supabase)
        .then(r => {
          if (r.ok) console.log(`[watchlist-add] ✓ ${symbolRaw} scraped after add`);
          else      console.warn(`[watchlist-add] × ${symbolRaw} scrape failed: ${r.error}`);
        })
        .catch(err => console.warn(`[watchlist-add] × ${symbolRaw} scrape threw: ${err.message}`));
    }

    return res.json({
      ok:            true,
      symbol:        symbolRaw,
      position:      nextPos,
      bootstrapping: needsScrape,
    });
  } catch (err) {
    console.error("[POST /api/watchlist] unexpected:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
});

app.delete("/api/watchlist/:symbol", auth, async (req, res) => {
  try {
    const sym = (req.params.symbol || "").trim().toUpperCase();
    if (!sym) return res.status(400).json({ error: "Missing symbol" });

    const { error } = await supabase
      .from("watchlists")
      .delete()
      .eq("user_id", req.user.id)
      .eq("symbol", sym);

    if (error) {
      console.error("[DELETE /api/watchlist] error:", error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.json({ ok: true, symbol: sym });
  } catch (err) {
    console.error("[DELETE /api/watchlist] unexpected:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
});

app.patch("/api/watchlist/reorder", auth, async (req, res) => {
  try {
    const order = Array.isArray(req.body?.order) ? req.body.order : null;
    if (!order || !order.length) {
      return res.status(400).json({ error: "Body.order must be a non-empty array" });
    }

    // Update each position in parallel
    const updates = order.map((sym, idx) =>
      supabase
        .from("watchlists")
        .update({ position: idx })
        .eq("user_id", req.user.id)
        .eq("symbol", String(sym).trim().toUpperCase())
    );
    const results = await Promise.all(updates);
    const firstErr = results.find(r => r.error);
    if (firstErr) {
      console.error("[PATCH /api/watchlist/reorder] error:", firstErr.error.message);
      return res.status(500).json({ error: firstErr.error.message });
    }
    return res.json({ ok: true, count: order.length });
  } catch (err) {
    console.error("[PATCH /api/watchlist/reorder] unexpected:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
});

// ── /api/financials/:symbol ────────────────────────────────────────────────
// Returns the financials block for any symbol. Reads from the global catalog
// (stocks/financials/results). If the symbol isn't catalogued yet, scrape &
// persist via scrapeAndStore, then read. Always returns JSON, never HTML —
// every error path is explicit .json().
app.get("/api/financials/:symbol", auth, async (req, res) => {
  try {
    const symbol = (req.params.symbol || "").trim().toUpperCase();
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    // 1. Ensure catalog has the symbol — scrape on miss
    let { data: stock } = await supabase
      .from("stocks")
      .select("*")
      .eq("symbol", symbol)
      .maybeSingle();

    if (!stock) {
      const scrape = await scrapeAndStore(symbol, {}, supabase);
      if (!scrape.ok) {
        return res.status(404).json({
          error: `No data for ${symbol}: ${scrape.error}`,
        });
      }
      const refetch = await supabase
        .from("stocks").select("*").eq("symbol", symbol).maybeSingle();
      stock = refetch.data;
      if (!stock) return res.status(500).json({ error: "Scrape succeeded but read failed" });
    }

    // 2. Read financials + results in parallel
    const [{ data: fin }, { data: resRows }] = await Promise.all([
      supabase.from("financials").select("*").eq("symbol", symbol).maybeSingle(),
      supabase.from("results").select("*").eq("symbol", symbol),
    ]);

    const rows = (resRows ?? [])
      .filter(r => r.data && Object.keys(r.data).length > 0)
      .sort((a, b) => quarterSort(a.quarter, b.quarter));

    const isBanking = stock.is_banking ?? false;
    const revKey   = isBanking ? "Revenue"           : "Sales";
    const profKey  = isBanking ? "Financing Profit"  : "Operating Profit";
    const margKey  = isBanking ? "Financing Margin %" : "OPM %";

    let latestQuarter = null;
    let quarters8     = null;
    let yoyRevGrowth = null, yoyEarningsGrowth = null;

    if (rows.length) {
      const lRow = rows.at(-1);
      const pRow = rows.at(-5) ?? null;

      yoyRevGrowth      = calcGrowth(lRow.data[revKey],       pRow?.data?.[revKey]);
      yoyEarningsGrowth = calcGrowth(lRow.data["Net Profit"], pRow?.data?.["Net Profit"]);

      latestQuarter = {
        label:          lRow.quarter,
        prevLabel:      pRow?.quarter         ?? null,
        revenue:        lRow.data[revKey]      ?? null,
        prevRevenue:    pRow?.data?.[revKey]   ?? null,
        coreProfit:     lRow.data[profKey]     ?? null,
        prevCoreProfit: pRow?.data?.[profKey]  ?? null,
        margin:         lRow.data[margKey]     ?? null,
        netProfit:      lRow.data["Net Profit"]      ?? null,
        prevNetProfit:  pRow?.data?.["Net Profit"]   ?? null,
        eps:            lRow.data["EPS in Rs"]       ?? null,
        prevEps:        pRow?.data?.["EPS in Rs"]    ?? null,
        grossNpa:       lRow.data["Gross NPA %"]     ?? null,
        netNpa:         lRow.data["Net NPA %"]       ?? null,
      };

      const vis = rows.slice(-8);
      quarters8 = {
        labels:     vis.map(r => r.quarter),
        revenue:    vis.map(r => r.data[revKey]            ?? null),
        coreProfit: vis.map(r => r.data[profKey]           ?? null),
        margin:     vis.map(r => r.data[margKey]           ?? null),
        netProfit:  vis.map(r => r.data["Net Profit"]      ?? null),
        eps:        vis.map(r => r.data["EPS in Rs"]       ?? null),
        grossNpa:   vis.map(r => r.data["Gross NPA %"]     ?? null),
        netNpa:     vis.map(r => r.data["Net NPA %"]       ?? null),
      };
    }

    return res.json({
      symbol,
      name:           stock.name ?? symbol,
      isBanking,
      isConsolidated: stock.is_consolidated ?? null,
      quarters8,
      latestQuarter,
      quarterStatus:  quarterStatus(rows),
      earningsMarkers: [],
      yoyRevGrowth,
      yoyEarningsGrowth,
      CAGRs:          fin?.cagrs    ?? null,
      analysis:       fin?.analysis ?? null,
      lastFetched:    fin?.fetched_at ?? null,
    });
  } catch (err) {
    console.error("[/api/financials] unexpected:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
});

app.post("/api/refresh/:symbol", auth, (req, res) => {
  const { symbol } = req.params;
  execFile("node", ["fetch.js", symbol], { cwd: __dirname }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true, log: stdout.trim() });
  });
});

// ── NSE Events API endpoints ──────────────────────────────────────────────────

// ── Date helpers ──────────────────────────────────────────────────────────────
const _EV_MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

function _parseEvDate(str) {
  if (!str) return null;
  const [dd, mon, yyyy] = str.split('-');
  const m = _EV_MONTHS[mon];
  if (m === undefined || !yyyy) return null;
  return new Date(parseInt(yyyy), m, parseInt(dd));
}

function _evType(date) {
  const d = _parseEvDate(date);
  if (!d) return 'unknown';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d >= today ? 'upcoming' : 'past';
}

// 5-min in-memory cache — serves all filter combos without re-querying DB
let   _evCache    = null;
let   _evCacheAt  = 0;
const _EV_TTL_MS  = 5 * 60 * 1000;

// ── _evFetchAll: load ALL nse_events rows into memory ─────────────────────────
//
// PRIMARY path — direct pg query (dbPool): single SQL SELECT, no row limit,
//   no pagination needed. ~2–3× faster than REST. Uses SUPABASE_DB_URL.
//
// FALLBACK path — Supabase REST (supabase client): used when SUPABASE_DB_URL is
//   absent. IMPORTANT: PostgREST hard-caps every response at 1000 rows regardless
//   of .range() arguments. PAGE must always be exactly 1000. Never change to a
//   larger value — it looks like it should work but silently truncates, causing
//   the loop to exit after one page and leaving most rows unloaded.
//
// After loading, fires an async count check against the DB to catch any
// truncation early and log a clear warning.
async function _evFetchAll() {
  if (_evCache && Date.now() - _evCacheAt < _EV_TTL_MS) return _evCache;

  let all;

  if (dbPool) {
    // ── Direct SQL — no row limit ─────────────────────────────────────────
    // If this throws, the error propagates to the caller. Do NOT catch here —
    // a silent fallback to REST would give wrong row counts with no visible signal.
    // Cast ingested_at to TEXT so the rest of the code gets an ISO string,
    // matching what Supabase REST returns. pg returns TIMESTAMPTZ as a JS
    // Date object which breaks .slice()-based comparisons downstream.
    const { rows } = await dbPool.query(
      `SELECT symbol, company, purpose, bm_desc, date,
              to_char(ingested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ingested_at
         FROM nse_events
        ORDER BY ingested_at DESC`
    );
    all = rows;
    console.log(`[events] cache loaded via SQL — ${all.length} rows`);
  } else {
    // ── REST — only used when SUPABASE_DB_URL is not set ─────────────────
    // PAGE must stay at 1000. PostgREST silently caps larger values.
    const PAGE = 1000;
    all = [];
    let from = 0;
    let pages = 0;
    while (true) {
      const { data, error } = await supabase
        .from('nse_events')
        .select('symbol, company, purpose, bm_desc, date, ingested_at')
        .order('ingested_at', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data?.length) break;
      all.push(...data);
      pages++;
      if (data.length < PAGE) break;
      from += PAGE;
    }
    console.log(`[events] cache loaded via REST — ${all.length} rows across ${pages} pages`);
  }

  _evCache   = all;
  _evCacheAt = Date.now();

  // Async count-check: if loaded count doesn't match DB, log a warning and
  // invalidate so the next request triggers a fresh load.
  _evValidateCache(all.length);

  return _evCache;
}

/** Fire-and-forget: compare loaded row count against DB count.
 *  If mismatch > 5 rows, invalidates cache so next request reloads. */
async function _evValidateCache(loadedCount) {
  try {
    const { count, error } = await supabase
      .from('nse_events')
      .select('*', { count: 'exact', head: true });
    if (error || count == null) return;
    if (Math.abs(count - loadedCount) > 5) {
      console.warn(`[events] ⚠ cache mismatch — loaded ${loadedCount} but DB has ${count}. Invalidating cache.`);
      _evCache = null;  // next request will reload
    } else {
      console.log(`[events] cache validated — ${loadedCount}/${count} rows OK`);
    }
  } catch (e) {
    console.warn('[events] cache validation failed:', e.message);
  }
}

export function _evInvalidateCache() { _evCache = null; _evCacheAt = 0; }

// ── GET /api/events/purposes ──────────────────────────────────────────────────
// Returns sorted list of distinct purpose values for the filter dropdown.
// Cached with the main event cache (same TTL).

let _purposeCache    = null;
let _purposeCacheAt  = 0;

app.get('/api/events/purposes', requireAuth(supabase), async (_req, res) => {
  try {
    if (!_purposeCache || Date.now() - _purposeCacheAt > _EV_TTL_MS) {
      const rows = await _evFetchAll();
      const set  = new Set();
      for (const r of rows) {
        if (r.purpose) r.purpose.split('/').forEach(p => set.add(p.trim()));
      }
      _purposeCache   = [...set].filter(Boolean).sort();
      _purposeCacheAt = Date.now();
    }
    res.json(_purposeCache);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/events/list?symbol=X ─────────────────────────────────────────────
// All events for one symbol — used by chevron expand in God Mode.

app.get('/api/events/list', requireAuth(supabase), async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const { data, error } = await supabase
      .from('nse_events')
      .select('symbol, company, purpose, bm_desc, date, ingested_at')
      .eq('symbol', symbol)
      .order('date', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data ?? []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/events/grouped ───────────────────────────────────────────────────
// Company-grouped feed for God Mode events tab.
// Filters: ?purpose= ?type=upcoming|past|all ?symbol= ?limit= ?offset=
//
// Sort order (per plan):
//   1. latest_ingested_at DESC  — newest cron batch first
//   2. has_upcoming DESC        — upcoming companies above past-only
//   3. symbol ASC               — alphabetical within each tier

app.get('/api/events/grouped', requireAuth(supabase), async (req, res) => {
  try {
    const limit   = Math.min(parseInt(req.query.limit  ?? '300'), 500);
    const offset  = parseInt(req.query.offset ?? '0');
    const purpose = req.query.purpose?.trim()         ?? null;
    const type    = req.query.type                    ?? 'all';  // upcoming|past|all
    const symQ    = req.query.symbol?.toUpperCase()   ?? null;

    let rows = await _evFetchAll();

    // ── Filters ──
    if (symQ)    rows = rows.filter(r => r.symbol === symQ || r.symbol.startsWith(symQ));
    if (purpose) rows = rows.filter(r => r.purpose && r.purpose.includes(purpose));
    if (type === 'upcoming') rows = rows.filter(r => _evType(r.date) === 'upcoming');
    else if (type === 'past') rows = rows.filter(r => _evType(r.date) === 'past');

    // ── Group by symbol ──
    // Rows are already ingested_at DESC, so first occurrence per symbol = latest.
    // Display logic: if a company has ANY upcoming event, prefer showing the upcoming
    // event in the header row (date/purpose/desc) rather than a past event — even if
    // the past event was ingested more recently. latest_ingested_at is always the
    // most-recently-ingested event and drives sort order + NEW badge unchanged.
    const groups = new Map();
    for (const r of rows) {
      const evType = _evType(r.date);
      if (!groups.has(r.symbol)) {
        groups.set(r.symbol, {
          symbol:             r.symbol,
          company:            r.company,
          latest_ingested_at: r.ingested_at,   // sort key + NEW badge — always most recent
          latest_date:        r.date,
          latest_purpose:     r.purpose,
          latest_desc:        r.bm_desc,
          latest_type:        evType,
          has_upcoming:       evType === 'upcoming',
          event_count:        0,
        });
      } else {
        const g = groups.get(r.symbol);
        // First time we encounter an upcoming event for a company whose header currently
        // shows a past event → upgrade display fields to the upcoming event so the
        // header date/purpose/desc is actionable (future date, not stale results date).
        if (evType === 'upcoming' && !g.has_upcoming) {
          g.has_upcoming   = true;
          g.latest_date    = r.date;
          g.latest_purpose = r.purpose;
          g.latest_desc    = r.bm_desc;
          g.latest_type    = 'upcoming';
        }
      }
      groups.get(r.symbol).event_count++;
    }

    // ── Sort: ingested_at DESC → has_upcoming DESC → symbol ASC ──
    const all = [...groups.values()].sort((a, b) => {
      // 1. Latest ingested batch first (truncate to minute for stable batching)
      const tA = a.latest_ingested_at?.slice(0, 16) ?? '';
      const tB = b.latest_ingested_at?.slice(0, 16) ?? '';
      if (tA !== tB) return tB.localeCompare(tA);
      // 2. Upcoming above past-only
      if (a.has_upcoming !== b.has_upcoming) return b.has_upcoming ? 1 : -1;
      // 3. Alphabetical
      return a.symbol.localeCompare(b.symbol);
    });

    // total_events = all rows loaded (unfiltered) — shown as "Total events" in God Mode
    const allRows = await _evFetchAll();
    res.json({ companies: all.slice(offset, offset + limit), total: all.length, total_events: allRows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// /api/bm/status removed — nse_bm_runs table dropped in migration 013

// ── NSE Universe ──────────────────────────────────────────────────────────────
// In-memory cache of nse_universe rows — loaded from DB on startup.
// mcap column refreshed nightly at midnight IST via bhavcopy ZIP.
// Symbol list (EQUITY_L) is a one-time / manual operation — not auto-refreshed.

let _universeCache   = [];
let _universeCacheAt = 0;

async function _loadUniverseCache() {
  if (dbPool) {
    // Direct SQL — throws on failure so the caller sees the real error.
    // Do NOT catch here — a silent REST fallback would silently truncate at 1000 rows.
    const { rows } = await dbPool.query(
      `SELECT symbol, company_name, market_cap
       FROM nse_universe
       WHERE is_active IS DISTINCT FROM false
       ORDER BY symbol`
    );
    _universeCache   = rows;
    _universeCacheAt = Date.now();
    console.log(`[universe] cache loaded via SQL — ${_universeCache.length} stocks`);
  } else {
    // REST — only used when SUPABASE_DB_URL is not set. Paginate at 1000 (PostgREST cap).
    const PAGE = 1000;
    const all  = [];
    let   from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('nse_universe')
        .select('symbol,company_name,market_cap')
        .neq('is_active', false)
        .order('symbol')
        .range(from, from + PAGE - 1);
      if (error) { console.warn('[universe] cache load error:', error.message); break; }
      if (!data?.length) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    _universeCache   = all;
    _universeCacheAt = Date.now();
    console.log(`[universe] cache loaded via REST — ${_universeCache.length} stocks`);
  }
}

// ── Scheduler log ─────────────────────────────────────────────────────────────
// In-memory read cache + persistent DB table (scheduler_log).
// Entries: { job, status, message, ts }
// On startup: loads last SCHED_LOG_MAX rows from DB so history survives restarts.
// Writes happen in scripts/run-cron.mjs, not in the web process.

const _schedulerLog = [];
const SCHED_LOG_MAX = 50;       // in-memory ring buffer size

/** Load last SCHED_LOG_MAX entries from scheduler_log table into memory.
 *  Called once on server startup so restarts don't lose history. */
async function _loadSchedulerLog() {
  try {
    const { data, error } = await supabase
      .from('scheduler_log')
      .select('job, status, message, ts')
      .neq('status', 'scheduled')   // exclude legacy 'scheduled' rows written before this fix
      .order('ts', { ascending: false })
      .limit(SCHED_LOG_MAX);
    if (error) { console.error('[schedLog] startup load failed:', error.message); return; }
    if (data?.length) {
      _schedulerLog.splice(0, _schedulerLog.length, ...data);
      console.log(`[schedLog] loaded ${data.length} historic entries from DB`);
    }
  } catch (e) {
    console.error('[schedLog] startup load error:', e.message);
  }
}

// Endpoint — universe for client-side search (no auth, public data)
app.get('/api/universe', (_req, res) => {
  res.json(_universeCache.map(r => ({
    symbol:       r.symbol,
    company_name: r.company_name,
    market_cap:   r.market_cap,
  })));
});

// ── Annual Results APIs ──────────────────────────────────────────────────────
// DB-backed Screener annuals. The UI never scrapes; the Railway worker fills
// these tables progressively from nse_universe.

function _annualNoStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

app.get('/api/annuals/status', auth, async (_req, res) => {
  _annualNoStore(res);
  try {
    const annualsDb = await getRequiredDbPool();
    const { rows } = await annualsDb.query(`
      WITH totals AS (
        SELECT count(*)::int AS total FROM nse_universe
      ),
      fetched AS (
        SELECT count(DISTINCT symbol)::int AS fetched FROM annual_fundamentals
      ),
      queue AS (
        SELECT
          count(*)::int AS queued,
          count(*) FILTER (WHERE status = 'fetching')::int AS fetching,
          count(*) FILTER (WHERE status = 'retry')::int AS retry,
          count(*) FILTER (WHERE status = 'failed')::int AS failed,
          count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
          count(*) FILTER (WHERE latest_fy_missing)::int AS latest_fy_missing
        FROM screener_fetch_queue
      )
      SELECT
        totals.total,
        queue.queued,
        fetched.fetched,
        fetched.fetched AS complete,
        GREATEST(totals.total - fetched.fetched - queue.failed - queue.skipped, 0)::int AS pending,
        queue.fetching,
        queue.retry,
        queue.failed,
        queue.skipped,
        queue.latest_fy_missing
      FROM totals, fetched, queue
    `);
    return res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/annuals/symbols', auth, async (_req, res) => {
  _annualNoStore(res);
  try {
    const annualsDb = await getRequiredDbPool();
    const { rows } = await annualsDb.query(`
      WITH annual_counts AS (
        SELECT symbol, count(*)::int AS annual_years_count
        FROM annual_fundamentals
        GROUP BY symbol
      )
      SELECT
        u.symbol,
        u.company_name,
        u.market_cap,
        COALESCE(q.status, 'pending') AS status,
        COALESCE(ac.annual_years_count, q.history_years_count, 0)::int AS history_years_count,
        (COALESCE(ac.annual_years_count, 0) > 0) AS has_annual_data,
        (COALESCE(ac.annual_years_count, 0) >= 5 OR COALESCE(q.history_complete, false)) AS history_complete,
        q.latest_period,
        q.latest_fy_available,
        q.latest_fy_missing,
        q.last_success_at,
        q.last_attempt_at,
        q.next_attempt_at,
        q.last_error
      FROM nse_universe u
      LEFT JOIN screener_fetch_queue q ON q.symbol = u.symbol
      LEFT JOIN annual_counts ac ON ac.symbol = u.symbol
      ORDER BY u.symbol
    `);
    return res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function _validateAnnualsStreamToken(req, res, next) {
  const token = req.query.token;
  if (!token || typeof token !== 'string') return res.status(401).json({ error: 'Missing token' });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });
  req.user = { id: data.user.id, email: data.user.email };
  next();
}

app.get('/api/annuals/events', _validateAnnualsStreamToken, async (_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  let lastPayload = '';
  let alive = true;
  const send = async () => {
    if (!alive) return;
    try {
      const annualsDb = await getRequiredDbPool();
      const statusRows = (await annualsDb.query(`
        WITH fetched AS (
          SELECT count(DISTINCT symbol)::int AS fetched FROM annual_fundamentals
        ),
        latest_run AS (
          SELECT max(started_at) AS last_run_at FROM screener_fetch_runs
        )
        SELECT fetched.fetched, latest_run.last_run_at FROM fetched, latest_run
      `)).rows;
      const payload = JSON.stringify(statusRows[0] ?? {});
      if (payload !== lastPayload) {
        lastPayload = payload;
        res.write(`event: annuals\n`);
        res.write(`data: ${payload}\n\n`);
      } else {
        res.write(`: heartbeat\n\n`);
      }
    } catch (err) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  };

  await send();
  const interval = setInterval(send, 15_000);
  _req.on('close', () => {
    alive = false;
    clearInterval(interval);
    res.end();
  });
});

app.get('/api/annuals/:symbol', auth, async (req, res) => {
  _annualNoStore(res);
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

    const [
      { data: stock },
      { data: fundamentals, error: fErr },
      { data: ratios, error: rErr },
      { data: balanceSheet, error: bErr },
      { data: cashFlows, error: cErr },
      { data: shareholding, error: sErr },
      { data: queue, error: qErr },
      { data: runs, error: runErr },
    ] = await Promise.all([
      supabase.from('nse_universe').select('symbol,company_name,market_cap').eq('symbol', symbol).maybeSingle(),
      supabase.from('annual_fundamentals').select('*').eq('symbol', symbol).order('period_order'),
      supabase.from('annual_ratios').select('*').eq('symbol', symbol).order('period_order'),
      supabase.from('annual_balance_sheet').select('*').eq('symbol', symbol).order('period_order'),
      supabase.from('annual_cash_flows').select('*').eq('symbol', symbol).order('period_order'),
      supabase.from('shareholding_pattern').select('*').eq('symbol', symbol).order('period_order'),
      supabase.from('screener_fetch_queue').select('*').eq('symbol', symbol).maybeSingle(),
      supabase.from('screener_fetch_runs').select('started_at,finished_at,status,message,duration_ms,rows_written').eq('symbol', symbol).order('started_at', { ascending: false }).limit(5),
    ]);

    const firstErr = fErr || rErr || bErr || cErr || sErr || qErr || runErr;
    if (firstErr) return res.status(500).json({ error: firstErr.message });

    res.json({
      symbol,
      stock: stock ?? { symbol },
      queue,
      fundamentals: fundamentals ?? [],
      ratios: ratios ?? [],
      balanceSheet: balanceSheet ?? [],
      cashFlows: cashFlows ?? [],
      shareholding: shareholding ?? [],
      runs: runs ?? [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint — scheduler log for God Mode
app.get('/api/scheduler/log', requireAuth(supabase), (_req, res) => {
  res.json({ jobs: getCronJobs(), log: _schedulerLog });
});

app.listen(PORT, () => {
  console.log(`BoardroomX → http://localhost:${PORT}`);

  // Verify pg pool connectivity first, then load universe/search cache.
  // Direct-SQL-only routes call getRequiredDbPool() and fail loudly if the
  // required database URL is missing or unavailable.
  // Awaited inside an async IIFE so app.listen callback stays synchronous.
  (async () => {
    await _verifyDbPool();
    _loadUniverseCache().catch(err =>
      console.error('[universe] ⛔ STARTUP LOAD FAILED:', err.message)
    );
  })();
  // Scheduler log: load history from DB so restarts don't wipe the log
  _loadSchedulerLog();
});
