// ─────────────────────────────────────────────────────────────────────────────
//  BoardroomX — Auth middleware
//
//  Exports `requireAuth(supabase)` which returns an Express middleware that:
//    • Reads the Authorization: Bearer <token> header
//    • Validates the JWT via supabase.auth.getUser(token)
//    • Attaches `req.user = { id, email }` on success
//    • Returns 401 { error } on failure
//
//  Usage in server.js:
//    import { requireAuth } from './auth_middleware.js';
//    const auth = requireAuth(supabase);
//    app.get('/api/portfolio', auth, async (req, res) => { … req.user.id … });
// ─────────────────────────────────────────────────────────────────────────────

export function requireAuth(supabase) {
  return async function authMiddleware(req, res, next) {
    try {
      const header = req.headers['authorization'] || '';
      if (!header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing Authorization header' });
      }
      const token = header.slice(7).trim();
      if (!token) {
        return res.status(401).json({ error: 'Empty bearer token' });
      }

      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) {
        return res.status(401).json({ error: error?.message || 'Invalid token' });
      }

      req.user = {
        id:    data.user.id,
        email: data.user.email,
      };
      return next();
    } catch (err) {
      console.error('[requireAuth] unexpected error:', err);
      return res.status(500).json({ error: 'Auth check failed' });
    }
  };
}
