// ─────────────────────────────────────────────────────────────────────────────
//  BoardroomX — Kite Connect Routes (Phase 1: Read-Only)
//
//  Usage in server.js:
//    import { registerKiteRoutes } from "./kite_routes.js";
//    registerKiteRoutes(app, supabase);
//
//  Env vars required:
//    KITE_REDIRECT_URL      e.g. https://boardroomx.com/kite/callback
//    KITE_ENCRYPTION_KEY    32-byte hex key for AES-256-CBC api_secret encryption
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "crypto";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Portfolio lookup maps ──────────────────────────────────────────────────────
const _portfolio = JSON.parse(readFileSync(join(__dirname, "portfolio.json"), "utf8"));
const portfolioSymbols = new Set(_portfolio.map(s => s.symbol.toUpperCase()));
// symbol → display name (e.g. "BAJFINANCE" → "Bajaj Finance")
const portfolioNameMap = Object.fromEntries(
  _portfolio.map(s => [s.symbol.toUpperCase(), s.name ?? null])
);

// ── Kite API constants ────────────────────────────────────────────────────────
const KITE_BASE       = "https://kite.zerodha.com";
const KITE_API_BASE   = "https://api.kite.trade";
const KITE_VERSION    = "3";

// ── Encryption helpers (AES-256-CBC) for api_secret ──────────────────────────
// KITE_ENCRYPTION_KEY must be a 64-char hex string (32 bytes).
// If not set we fall back to a dev-only placeholder — never use in production.

function getEncryptionKey() {
  const hex = process.env.KITE_ENCRYPTION_KEY;
  if (hex && hex.length === 64) return Buffer.from(hex, "hex");
  // Dev fallback — log a warning so it's impossible to miss
  console.warn("[kite] WARNING: KITE_ENCRYPTION_KEY not set. Using insecure dev key.");
  return Buffer.alloc(32, 0xAB);
}

function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  // Store as iv:ciphertext (both hex)
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(stored) {
  try {
    const [ivHex, cipherHex] = stored.split(":");
    const key  = getEncryptionKey();
    const iv   = Buffer.from(ivHex, "hex");
    const data = Buffer.from(cipherHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── SHA-256 checksum (api_key + request_token + api_secret) ──────────────────
function kiteChecksum(apiKey, requestToken, apiSecret) {
  return crypto
    .createHash("sha256")
    .update(apiKey + requestToken + apiSecret)
    .digest("hex");
}

// ── Compute next 6:30 AM IST (token expiry) ──────────────────────────────────
function nextTokenExpiry() {
  // IST = UTC+5:30
  const now = new Date();
  // Current IST time
  const istOffset = 5.5 * 60 * 60 * 1000; // ms
  const ist       = new Date(now.getTime() + istOffset);

  // Set to 6:30 AM IST today
  const expiry = new Date(ist);
  expiry.setUTCHours(1, 0, 0, 0); // 6:30 IST = 01:00 UTC

  // If 6:30 IST has already passed today, roll to tomorrow
  if (ist.getUTCHours() * 60 + ist.getUTCMinutes() >= 6 * 60 + 30) {
    expiry.setUTCDate(expiry.getUTCDate() + 1);
  }

  return expiry.toISOString();
}

// ── Resolve user_id from Bearer token ────────────────────────────────────────
async function resolveUserId(req, supabase) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user.id;
}

// ── Internal: sync holdings from Kite API into kite_holdings table ────────────
async function syncHoldings(userId, supabase) {
  // 1. Fetch kite account
  const { data: account, error: accountErr } = await supabase
    .from("kite_accounts")
    .select("api_key, access_token, token_expires_at")
    .eq("user_id", userId)
    .single();

  if (accountErr || !account) {
    throw Object.assign(new Error("Kite account not found"), { code: "not_connected" });
  }

  // 2. Check token expiry
  if (account.token_expires_at && new Date(account.token_expires_at) <= new Date()) {
    throw Object.assign(new Error("Kite access token has expired"), { code: "token_expired" });
  }
  if (!account.access_token) {
    throw Object.assign(new Error("No access token — user must complete OAuth"), { code: "token_expired" });
  }

  // 3. Fetch holdings from Kite API
  const holdingsRes = await fetch(`${KITE_API_BASE}/portfolio/holdings`, {
    headers: {
      "X-Kite-Version": KITE_VERSION,
      "Authorization":  `token ${account.api_key}:${account.access_token}`,
    },
  });

  if (!holdingsRes.ok) {
    if (holdingsRes.status === 403 || holdingsRes.status === 401) {
      throw Object.assign(new Error("Kite token rejected"), { code: "token_expired" });
    }
    const body = await holdingsRes.text();
    throw new Error(`Kite API error ${holdingsRes.status}: ${body}`);
  }

  const holdingsJson = await holdingsRes.json();

  if (holdingsJson.status !== "success") {
    throw new Error(`Kite API error: ${holdingsJson.message ?? JSON.stringify(holdingsJson)}`);
  }

  // Kite response shape: { status: "success", data: [ {...}, ... ] }
  // Each holding: tradingsymbol, exchange, isin, quantity, t1_quantity,
  //   average_price, last_price, close_price, pnl, day_change,
  //   day_change_percentage, instrument_token, …
  const rawHoldings = holdingsJson.data ?? [];

  const now = new Date().toISOString();

  // 4. Upsert into kite_holdings — capture all useful fields
  const rows = rawHoldings.map(h => {
    const sym = (h.tradingsymbol ?? "").toUpperCase();
    return {
      user_id:           userId,
      tradingsymbol:     h.tradingsymbol,
      exchange:          h.exchange          ?? null,
      isin:              h.isin              ?? null,
      instrument_token:  h.instrument_token  ?? null,
      // quantity = total settled + unsettled (realised_quantity + t1_quantity)
      // Kite's `quantity` field already represents total held qty
      quantity:          h.quantity          ?? 0,
      t1_quantity:       h.t1_quantity       ?? 0,
      average_price:     h.average_price     ?? null,
      last_price:        h.last_price        ?? null,
      close_price:       h.close_price       ?? null,
      pnl:               h.pnl               ?? null,
      day_change:        h.day_change        ?? null,
      day_change_pct:    h.day_change_percentage ?? null,
      // Resolve a human-readable name: portfolio.json first, then Kite tradingsymbol
      display_name:      portfolioNameMap[sym] ?? h.tradingsymbol,
      synced_at:         now,
    };
  });

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("kite_holdings")
      .upsert(rows, { onConflict: "user_id,tradingsymbol" });

    if (upsertErr) throw new Error(`Holdings upsert failed: ${upsertErr.message}`);
  }

  // 5. Remove stale rows — symbols no longer in Kite (e.g. fully sold)
  //    PostgREST 'in' filter: ("SYM1","SYM2") — quoted for safety
  if (rawHoldings.length > 0) {
    const inList = rawHoldings.map(h => `"${h.tradingsymbol}"`).join(",");
    await supabase
      .from("kite_holdings")
      .delete()
      .eq("user_id", userId)
      .not("tradingsymbol", "in", `(${inList})`);
  }

  // 6. Update last_synced_at on the account row
  await supabase
    .from("kite_accounts")
    .update({ last_synced_at: now })
    .eq("user_id", userId);

  return { count: rows.length, synced_at: now };
}

// ── Register all Kite routes ──────────────────────────────────────────────────
export function registerKiteRoutes(app, supabase) {

  // ── GET /kite/login ─────────────────────────────────────────────────────────
  // Requires: ?user_id=UUID
  // Looks up this user's api_key and redirects to Kite OAuth.
  app.get("/kite/login", async (req, res) => {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: "user_id query param required" });
    }

    const { data: account, error } = await supabase
      .from("kite_accounts")
      .select("api_key")
      .eq("user_id", user_id)
      .single();

    if (error || !account) {
      return res.status(400).json({
        error: "Kite account not configured for this user. Save your API credentials first.",
        code:  "not_connected",
      });
    }

    const loginUrl =
      `${KITE_BASE}/connect/login?api_key=${encodeURIComponent(account.api_key)}&v=${KITE_VERSION}`;
    return res.redirect(loginUrl);
  });

  // ── GET /kite/callback ──────────────────────────────────────────────────────
  // Kite redirects here after user authorises.
  // Query params: request_token, action, status
  // We need user context to look up api_key/api_secret, so we store a pending
  // state in the query: &user_id=UUID appended to the redirect_url registered
  // in Kite developer console (see KITE_ARCHITECTURE.md).
  app.get("/kite/callback", async (req, res) => {
    const { request_token, status, user_id } = req.query;

    if (status !== "success" || !request_token) {
      return res.redirect("/?kite=error&reason=oauth_failed");
    }
    if (!user_id) {
      return res.redirect("/?kite=error&reason=missing_user");
    }

    // 1. Fetch api_key + encrypted api_secret for this user
    const { data: account, error: accountErr } = await supabase
      .from("kite_accounts")
      .select("api_key, api_secret")
      .eq("user_id", user_id)
      .single();

    if (accountErr || !account) {
      return res.redirect("/?kite=error&reason=not_connected");
    }

    const apiKey    = account.api_key;
    const apiSecret = decrypt(account.api_secret);
    if (!apiSecret) {
      return res.redirect("/?kite=error&reason=decrypt_failed");
    }

    // 2. Exchange request_token for access_token
    let sessionData;
    try {
      const checksum = kiteChecksum(apiKey, request_token, apiSecret);

      const tokenRes = await fetch(`${KITE_API_BASE}/session/token`, {
        method:  "POST",
        headers: {
          "X-Kite-Version": KITE_VERSION,
          "Content-Type":   "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          api_key:       apiKey,
          request_token: request_token,
          checksum:      checksum,
        }).toString(),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        console.error("[kite] token exchange failed:", tokenRes.status, body);
        return res.redirect("/?kite=error&reason=token_exchange_failed");
      }

      const tokenJson = await tokenRes.json();
      sessionData = tokenJson.data ?? tokenJson;
    } catch (err) {
      console.error("[kite] token exchange error:", err.message);
      return res.redirect("/?kite=error&reason=token_exchange_error");
    }

    // 3. Store access token + user metadata
    const { error: updateErr } = await supabase
      .from("kite_accounts")
      .update({
        access_token:     sessionData.access_token  ?? null,
        kite_user_id:     sessionData.user_id       ?? null,
        kite_user_name:   sessionData.user_name     ?? null,
        token_expires_at: nextTokenExpiry(),
        connected_at:     new Date().toISOString(),
      })
      .eq("user_id", user_id);

    if (updateErr) {
      console.error("[kite] failed to save access token:", updateErr.message);
      return res.redirect("/?kite=error&reason=db_error");
    }

    // 4. Immediately sync holdings
    try {
      await syncHoldings(user_id, supabase);
    } catch (syncErr) {
      // Non-fatal: we have the token, just couldn't fetch holdings yet
      console.warn("[kite] initial sync failed:", syncErr.message);
    }

    return res.redirect("/?kite=connected");
  });

  // ── POST /api/kite/connect ──────────────────────────────────────────────────
  // Body: { user_id, api_key, api_secret }
  // Saves credentials. Does NOT start OAuth.
  app.post("/api/kite/connect", async (req, res) => {
    const { user_id, api_key, api_secret } = req.body;

    if (!user_id || !api_key || !api_secret) {
      return res.status(400).json({ error: "user_id, api_key, and api_secret are required" });
    }

    // Check if api_key is already used by a DIFFERENT user
    const { data: existing } = await supabase
      .from("kite_accounts")
      .select("user_id")
      .eq("api_key", api_key)
      .maybeSingle();

    if (existing && existing.user_id !== user_id) {
      return res.status(409).json({
        error: "This API key is already associated with another account.",
        code:  "api_key_conflict",
      });
    }

    // Encrypt api_secret before storing
    const encryptedSecret = encrypt(api_secret);

    const { error: upsertErr } = await supabase
      .from("kite_accounts")
      .upsert(
        {
          user_id,
          api_key,
          api_secret:   encryptedSecret,
          connected_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upsertErr) {
      console.error("[kite] connect upsert error:", upsertErr.message);
      return res.status(500).json({ error: "Failed to save credentials" });
    }

    // Build the redirect_url with user_id so callback can look up the right account
    const redirectUrl = process.env.KITE_REDIRECT_URL || "http://localhost:3001/kite/callback";
    const loginUrl    =
      `${KITE_BASE}/connect/login?api_key=${encodeURIComponent(api_key)}&v=${KITE_VERSION}`;

    return res.json({ ok: true, loginUrl });
  });

  // ── GET /api/kite/status ────────────────────────────────────────────────────
  // Authorization: Bearer <token>
  app.get("/api/kite/status", async (req, res) => {
    const userId = await resolveUserId(req, supabase);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { data: account } = await supabase
      .from("kite_accounts")
      .select("kite_user_name, last_synced_at, token_expires_at, access_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (!account) {
      return res.json({ connected: false });
    }

    const { count: holdingsCount } = await supabase
      .from("kite_holdings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const tokenValid =
      !!account.access_token &&
      !!account.token_expires_at &&
      new Date(account.token_expires_at) > new Date();

    return res.json({
      connected:       true,
      kite_user_name:  account.kite_user_name  ?? null,
      last_synced_at:  account.last_synced_at  ?? null,
      holdings_count:  holdingsCount           ?? 0,
      token_valid:     tokenValid,
    });
  });

  // ── POST /api/kite/sync ─────────────────────────────────────────────────────
  // Authorization: Bearer <token>
  app.post("/api/kite/sync", async (req, res) => {
    const userId = await resolveUserId(req, supabase);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const result = await syncHoldings(userId, supabase);
      return res.json({ ok: true, ...result });
    } catch (err) {
      if (err.code === "token_expired") {
        return res.status(401).json({ error: "token_expired", reconnect: true });
      }
      if (err.code === "not_connected") {
        return res.status(400).json({ error: "Kite account not connected" });
      }
      console.error("[kite] sync error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/kite/holdings ──────────────────────────────────────────────────
  // Authorization: Bearer <token>
  app.get("/api/kite/holdings", async (req, res) => {
    const userId = await resolveUserId(req, supabase);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { data: holdings, error } = await supabase
      .from("kite_holdings")
      .select(`
        tradingsymbol, display_name, exchange, isin,
        quantity, t1_quantity,
        average_price, last_price, close_price,
        pnl, day_change, day_change_pct,
        synced_at
      `)
      .eq("user_id", userId)
      .order("tradingsymbol");

    if (error) {
      console.error("[kite] holdings fetch error:", error.message);
      return res.status(500).json({ error: "Failed to fetch holdings" });
    }

    const enriched = (holdings ?? []).map(h => {
      const sym = (h.tradingsymbol ?? "").toUpperCase();
      const totalQty = (h.quantity ?? 0) + (h.t1_quantity ?? 0);
      const currentValue = totalQty * (h.last_price ?? 0);
      const investedValue = totalQty * (h.average_price ?? 0);
      return {
        tradingsymbol:  h.tradingsymbol,
        display_name:   h.display_name ?? h.tradingsymbol,
        exchange:       h.exchange,
        isin:           h.isin,
        // quantities
        quantity:       h.quantity,       // settled (Demat)
        t1_quantity:    h.t1_quantity,    // unsettled (T+1)
        total_quantity: totalQty,
        // pricing
        average_price:  h.average_price,
        last_price:     h.last_price,
        close_price:    h.close_price,
        // computed values
        invested_value: investedValue ? +investedValue.toFixed(2) : null,
        current_value:  currentValue  ? +currentValue.toFixed(2)  : null,
        // P&L
        pnl:            h.pnl,
        day_change:     h.day_change,
        day_change_pct: h.day_change_pct,
        // meta
        synced_at:      h.synced_at,
        in_portfolio:   portfolioSymbols.has(sym),
      };
    });

    return res.json(enriched);
  });

  // ── DELETE /api/kite/disconnect ─────────────────────────────────────────────
  // Authorization: Bearer <token>
  app.delete("/api/kite/disconnect", async (req, res) => {
    const userId = await resolveUserId(req, supabase);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Delete holdings first (FK constraint order doesn't matter here, both refs profiles)
    await supabase.from("kite_holdings").delete().eq("user_id", userId);

    const { error } = await supabase
      .from("kite_accounts")
      .delete()
      .eq("user_id", userId);

    if (error) {
      console.error("[kite] disconnect error:", error.message);
      return res.status(500).json({ error: "Failed to disconnect" });
    }

    return res.json({ ok: true });
  });
}
