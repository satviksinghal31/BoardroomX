// ─────────────────────────────────────────────────────────────────────────────
//  BoardroomX — Auth API routes
//  ES module. Import and wire into server.js with two lines:
//
//    import { registerAuthRoutes } from './auth_routes.js';
//    registerAuthRoutes(app, supabase);
//
//  All routes are under /api/auth/*.
//  The supabase client must be created with the SERVICE_ROLE key so that
//  admin methods (createUser, signOut) are available.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register all auth routes onto the Express app.
 *
 * IMPORTANT: Two separate Supabase clients are required to prevent the
 * "auth pollution" footgun where signInWithPassword() on the admin client
 * switches its session to the signed-in user and breaks subsequent admin
 * operations (e.g. .from('stocks').upsert() then runs as that user, not
 * service_role, and hits RLS/grants).
 *
 * @param {import('express').Application} app
 * @param {SupabaseClient} supabaseAdmin  service-role client — for createUser/getUser/table queries
 * @param {SupabaseClient} supabaseAuth   anon-key client — ONLY for signInWithPassword/refreshSession
 */
export function registerAuthRoutes(app, supabaseAdmin, supabaseAuth) {
  // Fallback for callers that pass a single client (back-compat): use it for both,
  // but warn — this is the buggy mode and should be migrated.
  if (!supabaseAuth) {
    console.warn('[auth_routes] Only one client passed — auth pollution risk! Pass a dedicated anon-key client as 3rd arg.');
    supabaseAuth = supabaseAdmin;
  }

  // ── POST /api/auth/signup ───────────────────────────────────────────────────
  // Body: { email, password, display_name }
  // Creates a new Supabase auth user, then signs in immediately so the caller
  // gets a session in one round trip.
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { email, password, display_name } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      // Create the user via the admin API (admin client)
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,   // skip email confirmation — confirm immediately
        user_metadata: { display_name: display_name || email.split('@')[0] },
      });

      if (createErr) {
        return res.status(400).json({ error: createErr.message });
      }

      // Sign in to obtain a session (auth client — keeps admin client clean)
      const { data: signInData, error: signInErr } =
        await supabaseAuth.auth.signInWithPassword({ email, password });

      if (signInErr) {
        return res.status(400).json({ error: signInErr.message });
      }

      const session = _buildSession(signInData.session, signInData.user, display_name);
      return res.json({ session, user: session.user });
    } catch (err) {
      console.error('[auth/signup]', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── POST /api/auth/signin ───────────────────────────────────────────────────
  // Body: { email, password }
  app.post('/api/auth/signin', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
      }

      const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

      if (error) {
        return res.status(401).json({ error: error.message });
      }

      // Fetch display_name from profiles table (admin client — RLS-bypass read)
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .eq('id', data.user.id)
        .single();

      const session = _buildSession(data.session, data.user, profile?.display_name);
      return res.json({ session, user: session.user });
    } catch (err) {
      console.error('[auth/signin]', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── POST /api/auth/signout ──────────────────────────────────────────────────
  // Authorization: Bearer <access_token>
  app.post('/api/auth/signout', async (req, res) => {
    try {
      const token = _extractBearer(req);

      if (token) {
        // Revoke the JWT on the Supabase side (admin operation)
        await supabaseAdmin.auth.admin.signOut(token);
      }

      return res.json({ ok: true });
    } catch (err) {
      // Still return ok — client will clear local session regardless
      console.warn('[auth/signout]', err.message);
      return res.json({ ok: true });
    }
  });

  // ── GET /api/auth/me ────────────────────────────────────────────────────────
  // Authorization: Bearer <access_token>
  // Returns the full profile for the authenticated user.
  app.get('/api/auth/me', async (req, res) => {
    try {
      const token = _extractBearer(req);
      if (!token) {
        return res.status(401).json({ error: 'Missing Authorization header' });
      }

      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data?.user) {
        return res.status(401).json({ error: error?.message || 'Invalid token' });
      }

      // Fetch profile row (admin client — RLS-bypass read)
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      return res.json({
        id:           data.user.id,
        email:        data.user.email,
        display_name: profile?.display_name ?? data.user.user_metadata?.display_name ?? null,
        created_at:   profile?.created_at ?? data.user.created_at,
      });
    } catch (err) {
      console.error('[auth/me]', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── POST /api/auth/refresh ──────────────────────────────────────────────────
  // Body: { refresh_token }
  // Returns a new session with a fresh access_token.
  app.post('/api/auth/refresh', async (req, res) => {
    try {
      const { refresh_token } = req.body;
      if (!refresh_token) {
        return res.status(400).json({ error: 'refresh_token is required' });
      }

      const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token });
      if (error || !data?.session) {
        return res.status(401).json({ error: error?.message || 'Could not refresh session' });
      }

      // Fetch display_name from profiles table (admin client — RLS-bypass read)
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .eq('id', data.user.id)
        .single();

      const session = _buildSession(data.session, data.user, profile?.display_name);
      return res.json({ session, user: session.user });
    } catch (err) {
      console.error('[auth/refresh]', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
}

// ── Private helpers ───────────────────────────────────────────────────────────

/** Extract a Bearer token from the Authorization header, or null. */
function _extractBearer(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

/**
 * Normalise a Supabase session + user into the shape the client expects.
 * Supabase returns expires_at in seconds; we keep it as-is and let the
 * client convert (auth.js handles both seconds and ms).
 */
function _buildSession(supabaseSession, supabaseUser, displayName) {
  return {
    access_token:  supabaseSession.access_token,
    refresh_token: supabaseSession.refresh_token,
    expires_at:    supabaseSession.expires_at,   // unix seconds from Supabase
    user: {
      id:           supabaseUser.id,
      email:        supabaseUser.email,
      display_name: displayName
        || supabaseUser.user_metadata?.display_name
        || supabaseUser.email?.split('@')[0]
        || 'User',
    },
  };
}
