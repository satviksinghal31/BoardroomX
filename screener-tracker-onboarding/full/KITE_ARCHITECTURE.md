# BoardroomX — Kite Connect Architecture (Phase 1: Read-Only)

---

## OAuth Flow

```
User clicks "Save & Connect"
        │
        ▼
POST /api/kite/connect          ← saves api_key + encrypted api_secret
        │
        ▼
GET /kite/login?user_id=UUID    ← server reads api_key from DB
        │
        ▼ redirect
https://kite.zerodha.com/connect/login?api_key=...&v=3
        │
        │ user authorises in Zerodha UI
        ▼
GET /kite/callback?request_token=TOKEN&status=success&user_id=UUID
        │
        ├── decrypt api_secret from DB
        ├── compute SHA-256 checksum(api_key + request_token + api_secret)
        ├── POST https://api.kite.trade/session/token  → access_token
        ├── store access_token + kite_user_id + token_expires_at in DB
        └── syncHoldings() → upsert kite_holdings
        │
        ▼
redirect → /?kite=connected
```

**Important:** The `user_id` is threaded through the flow via query params
(`/kite/login?user_id=UUID` and echoed back in the Kite redirect URL via
`KITE_REDIRECT_URL`). The Kite app's "Redirect URL" in the developer console
**must be set to** `https://yourdomain.com/kite/callback` — user_id is appended
dynamically from the `/kite/login` handler (via the login flow, not the
redirect_uri parameter which Kite validates strictly).

---

## Token Lifecycle

```
 login time         6:30 AM IST next day
     │                       │
     ▼                       ▼
[access_token valid ─────────×─── EXPIRED]
                             │
                        token_expires_at stored in kite_accounts
                        token_valid = false in /api/kite/status
                        kite-connect.html shows yellow re-connect banner
```

- Kite access tokens expire at **6:30 AM IST** each trading day (regardless of
  when they were issued).
- `nextTokenExpiry()` in `kite_routes.js` calculates the next 6:30 AM IST
  timestamp in UTC and stores it as `token_expires_at`.
- On each `/api/kite/status` call, `token_valid` is computed as:
  `access_token is not null AND token_expires_at > NOW()`.
- When `token_valid` is false, the frontend shows a warning and re-displays the
  credentials form so the user can re-authorise (they can reuse the same
  api_key/api_secret — only the OAuth step needs repeating).

---

## Security

### api_secret Storage
- The api_secret is **never stored in plaintext**.
- Encrypted with **AES-256-CBC** at the application layer before writing to
  `kite_accounts.api_secret`.
- The encryption key is `KITE_ENCRYPTION_KEY` — a 32-byte (64-char hex) key set
  as an environment variable, never committed to source control.
- The api_secret is **never returned to the browser** — only the api_key is
  used client-side (to construct the loginUrl in the POST /api/kite/connect
  response).

### access_token Storage
- Stored in `kite_accounts.access_token` (Supabase, RLS-protected).
- Used **server-side only** in the `Authorization: token api_key:access_token`
  header to Kite API — never exposed to the browser.
- Rotated on every OAuth callback (new access_token replaces the old one).

### Row Level Security
- `kite_accounts` and `kite_holdings` both have RLS enabled.
- Policy: `auth.uid() = user_id` — users can only see their own rows.
- Server uses the service-role key (bypasses RLS) only for server-initiated
  operations (token exchange, holdings sync).

### CORS
- All Kite API calls are proxied server-side. No Kite API URL is ever called
  from the browser. CORS is not relevant.

---

## One Kite Account Per User

- `kite_accounts.user_id` has a `UNIQUE` constraint — one row per BoardroomX user.
- `POST /api/kite/connect` returns **409 Conflict** if a different `user_id`
  tries to register the same `api_key`.
- Re-connecting (expired token) uses `upsert` with `onConflict: "user_id"` so
  credentials are updated in place, not duplicated.

---

## Holdings Sync Strategy

| Trigger | When |
|---------|------|
| OAuth callback | Immediately after user connects for the first time |
| Manual "Sync Now" button | User-initiated from kite-connect.html |
| (Phase 2) Daily cron | Optional background job via `setInterval` or cron service |

**Upsert logic:** `kite_holdings` has a `UNIQUE(user_id, tradingsymbol)` constraint.
Each sync does a full upsert — new holdings are inserted, existing ones updated,
and stale symbols are **not** automatically deleted (use explicit delete + re-insert
if a full refresh is needed in Phase 2).

**`synced_at`** on each row is updated every upsert. `last_synced_at` on
`kite_accounts` reflects the most recent successful sync.

---

## Rate Limiting

- Kite free tier: **3 requests/second**.
- Phase 1 only makes **1 API call per sync** (`GET /portfolio/holdings`), so
  rate limiting is not a concern.
- If Phase 2 adds quote fetching for multiple symbols, introduce a 350ms delay
  between calls: `await new Promise(r => setTimeout(r, 350))`.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `KITE_REDIRECT_URL` | Yes | Full callback URL, e.g. `https://boardroomx.com/kite/callback`. Must match the redirect URL registered in Kite developer console. |
| `KITE_ENCRYPTION_KEY` | Yes (prod) | 64-char hex string (32 bytes). Used to AES-256-CBC encrypt api_secret at rest. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

---

## Wiring kite_routes.js into server.js

No modification to `server.js` is needed at code level — add two lines:

```js
// Near the top, after other imports:
import { registerKiteRoutes } from "./kite_routes.js";

// After `const app = express();` and middleware setup:
registerKiteRoutes(app, supabase);
```

---

## Phase 2 Preview — What Would Be Needed for Trading

> Phase 1 is strictly read-only. The following is documentation only.

- **Separate table:** `kite_orders` — each order row would store
  `order_id, tradingsymbol, transaction_type, quantity, price, status, placed_at`.
- **New endpoints:**
  - `POST /api/kite/order` — place order via `POST https://api.kite.trade/orders/{variety}`
  - `GET /api/kite/orders` — list today's orders
  - `DELETE /api/kite/order/:id` — cancel order
- **Broker confirmation flow:**
  - Orders displayed in UI with status polling (`GET /orders/{order_id}`)
  - User sees a confirmation modal before placement
  - Order receipt (order_id) stored in `kite_orders` for audit trail
- **Additional OAuth scopes:** The Kite app in developer console must have
  `orders` scope enabled (currently only `profile` and `holdings` are needed).
- **Risk controls:** Per-order quantity caps, price deviation limits, and a
  "paper trading" mode should be built before any live order flow.

---

## Files

| File | Purpose |
|------|---------|
| `kite_migrate.sql` | Creates `kite_accounts` and `kite_holdings` tables with RLS |
| `kite_routes.js` | All Kite route handlers — import and call `registerKiteRoutes(app, supabase)` |
| `public/kite-connect.html` | Standalone UI for connect / sync / disconnect / holdings preview |
| `KITE_ARCHITECTURE.md` | This file |
