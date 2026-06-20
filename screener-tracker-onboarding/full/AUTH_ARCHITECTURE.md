# BoardroomX — Auth Architecture

## Overview

BoardroomX uses **Supabase Auth** on the backend, with a thin Express layer that
keeps all token logic server-side. The browser stores a lightweight session object
in `localStorage` (`bx_session`) — the raw Supabase JWTs never touch any non-`/api`
routes.

---

## Flow Diagrams

### Sign Up

```
Browser (auth.html)          Express /api/auth/signup         Supabase Auth
        |                               |                             |
        |-- POST {email,pw,name} ------>|                             |
        |                               |-- admin.createUser() ------>|
        |                               |<-- { user } ----------------| (email auto-confirmed)
        |                               |-- signInWithPassword() ---->|
        |                               |<-- { session, user } -------|
        |<-- { session, user } ---------|
        |                               |
        | store bx_session in           |
        | localStorage                  |
        | redirect → /                  |
```

### Sign In

```
Browser (auth.html)          Express /api/auth/signin         Supabase Auth
        |                               |                             |
        |-- POST {email,pw} ----------->|                             |
        |                               |-- signInWithPassword() ---->|
        |                               |<-- { session, user } -------|
        |                               |-- profiles SELECT ---------->| Supabase DB
        |                               |<-- { display_name } --------|
        |<-- { session, user } ---------|
        |                               |
        | store bx_session              |
        | redirect → /                  |
```

### Token Refresh

```
Browser (auth.js — auto)     Express /api/auth/refresh        Supabase Auth
        |                               |                             |
        | (timer fires 5min before      |                             |
        |  access_token expiry)         |                             |
        |-- POST {refresh_token} ------>|                             |
        |                               |-- refreshSession() -------->|
        |                               |<-- { new session } ---------|
        |<-- { session, user } ---------|
        |                               |
        | overwrite bx_session          |
        | reschedule next refresh timer |
```

### Sign Out

```
Browser (any page)           Express /api/auth/signout        Supabase Auth
        |                               |                             |
        |-- POST (Bearer token) ------->|                             |
        |                               |-- admin.signOut(token) ---->|
        |                               |   (revokes JWT server-side) |
        |                               |<-- ok ------------------------
        |<-- { ok: true } --------------|
        |                               |
        | delete bx_session from        |
        | localStorage                  |
        | redirect → /auth              |
```

---

## localStorage Session Schema

Key: `bx_session`

```json
{
  "access_token":  "eyJ...",
  "refresh_token": "...",
  "expires_at":    1748000000000,
  "user": {
    "id":           "uuid-v4",
    "email":        "user@example.com",
    "display_name": "Alice"
  }
}
```

| Field           | Type       | Notes                                               |
|-----------------|------------|-----------------------------------------------------|
| `access_token`  | string     | Supabase JWT — sent only to `/api/*` routes         |
| `refresh_token` | string     | Long-lived — used to obtain a new access token      |
| `expires_at`    | unix ms    | `Date.now()` comparison; auto-refresh fires 5 min before |
| `user.id`       | UUID       | Supabase auth.users PK                              |
| `user.email`    | string     | From Supabase auth                                  |
| `user.display_name` | string | From `profiles` table / `user_metadata`             |

---

## Security Notes

1. **Tokens are never sent to non-`/api` routes.** `auth.js` only attaches the
   `Authorization: Bearer` header for requests to `/api/auth/*`. No token is
   ever included in page navigation or static asset fetches.

2. **HTTPS only in production.** The `Secure` attribute is implied for
   `localStorage` over HTTPS; ensure TLS is terminated at the reverse proxy
   (e.g. Caddy, nginx, or the hosting platform).

3. **Service-role key stays on the server.** `SUPABASE_SERVICE_ROLE_KEY` is only
   ever read in `server.js` / `auth_routes.js`. It is never sent to the browser.
   The `SUPABASE_ANON_KEY` exposed via `/api/config` has RLS enforced on all
   tables.

4. **JWT revocation.** `POST /api/auth/signout` calls
   `supabase.auth.admin.signOut(token)` which immediately invalidates the JWT
   on Supabase's side, so a stolen token stops working at sign-out even before
   its natural expiry.

5. **Profile isolation via RLS.** The `profiles` table has RLS enabled with a
   `(auth.uid() = id)` policy — each user can only read and update their own row.
   The server uses the service-role client which bypasses RLS, allowing it to
   back-fill profiles on sign-up.

---

## Multi-User Design

Each user is identified by their `auth.users` UUID. The `profiles` table is the
single source of truth for display names. Future features (watchlists, notes,
alerts) should reference `profiles.id` as a foreign key and add matching RLS
policies so users only see their own data.

The portfolio data (stocks, financials, results) is currently shared / read-only
from the browser's perspective — all writes happen through server-side scripts.
If per-user portfolios are added later, create a `user_portfolios` junction table:

```sql
CREATE TABLE user_portfolios (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  symbol  TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, symbol)
);
ALTER TABLE user_portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own" ON user_portfolios USING (auth.uid() = user_id);
```

---

## Wiring auth_routes.js into server.js

Add exactly two lines to `server.js` — one import and one call:

```js
// At the top, with the other imports:
import { registerAuthRoutes } from './auth_routes.js';

// After `app.use(express.json())` and before `app.listen(...)`:
registerAuthRoutes(app, supabase);
```

That's it. The five routes (`/api/auth/signup`, `/signin`, `/signout`, `/me`,
`/refresh`) will be registered on the shared Express instance.

---

## Protecting Existing API Endpoints

Add this middleware helper to `server.js` (or a separate `middleware.js`):

```js
// ── Auth middleware ────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = auth.slice(7).trim();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = data.user;  // available downstream as req.user.id, req.user.email
  next();
}
```

Then protect any route by adding `requireAuth` as middleware:

```js
// Example — protect the portfolio endpoint:
app.get('/api/portfolio', requireAuth, async (req, res) => { ... });

// Or protect a whole group at once:
app.use('/api/portfolio', requireAuth);
app.use('/api/chart',     requireAuth);
app.use('/api/prices',    requireAuth);
```

The client-side (`app.js`) already passes the Bearer token automatically because
`auth.js` is loaded first and all `fetch()` calls inside `app.js` can use:

```js
const session = getSession();
const headers = session ? { Authorization: `Bearer ${session.access_token}` } : {};
fetch('/api/portfolio', { headers });
```

---

## Future: Google OAuth

```js
// auth.js — add:
async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/' },
  });
  if (error) throw new Error(error.message);
  // Supabase handles the redirect; on return, session is in the URL hash.
}
```

Enable Google in Supabase dashboard → Authentication → Providers → Google.

---

## Future: Magic Link

```js
// auth_routes.js — add:
app.post('/api/auth/magic-link', async (req, res) => {
  const { email } = req.body;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: process.env.SITE_URL + '/' },
  });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});
```

---

## Future: Role-Based Access

Add a `role` column to `profiles`:

```sql
ALTER TABLE profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'
  CHECK (role IN ('viewer', 'editor', 'admin'));
```

Enforce in the `requireAuth` middleware:

```js
async function requireRole(role) {
  return async (req, res, next) => {
    const { data } = await supabase
      .from('profiles').select('role').eq('id', req.user.id).single();
    if (data?.role !== role) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// Usage:
app.post('/api/refresh/:symbol', requireAuth, requireRole('editor'), (req, res) => { ... });
```
