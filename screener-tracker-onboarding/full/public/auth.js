// ─────────────────────────────────────────────────────────────────────────────
//  BoardroomX — Auth client  (USER SERVICE — single source of truth)
//
//  This is the ONLY file that reads or writes auth state.
//  No other page/script should ever touch localStorage for auth.
//
//  Public API (all exposed on window):
//    authGuard()          — call at top of any protected page; redirects if not logged in
//    bxFetch(url, init)   — auth-aware fetch; handles token refresh + redirect on 401
//    getUser()            — returns { id, email, display_name } or null
//    signIn(email, pw)    — returns user object
//    signUp(email, pw, name) — returns user object
//    signOut()            — clears session, redirects to /auth.html
//    renderUserPill()     — returns HTML string for header pill
//
//  Session shape (stored under BX_SESSION_KEY):
//    { access_token, refresh_token, expires_at (unix ms), user: { id, email, display_name } }
//
//  All auth calls go through /api/auth/* server routes — no Supabase JS SDK needed.
// ─────────────────────────────────────────────────────────────────────────────

const BX_SESSION_KEY      = 'bx_session';
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // proactive refresh 5 min before expiry

// ── Session storage (private) ─────────────────────────────────────────────────

/**
 * Return the stored session if it exists and has not expired, otherwise null.
 * Clears storage if the token is found to be expired.
 */
function getSession() {
  try {
    const raw = localStorage.getItem(BX_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.access_token || !session?.expires_at) return null;
    if (Date.now() >= session.expires_at) {
      localStorage.removeItem(BX_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function _storeSession(serverSession) {
  // Supabase returns expires_at in seconds; normalise to ms.
  const expiresAt = serverSession.expires_at
    ? (serverSession.expires_at > 1e12 ? serverSession.expires_at : serverSession.expires_at * 1000)
    : Date.now() + 3600_000;

  const stored = {
    access_token:  serverSession.access_token,
    refresh_token: serverSession.refresh_token,
    expires_at:    expiresAt,
    user:          serverSession.user ?? null,
  };
  localStorage.setItem(BX_SESSION_KEY, JSON.stringify(stored));
  return stored;
}

function _clearSession() {
  localStorage.removeItem(BX_SESSION_KEY);
}

// ── Redirect helper ───────────────────────────────────────────────────────────

/**
 * Build the /auth.html URL, preserving the current page as ?redirect=<path>.
 * Used everywhere we need to send the user to login so they come back after.
 */
function _authRedirectUrl() {
  const cur = window.location.pathname;
  const onAuth = cur === '/auth' || cur.endsWith('/auth.html');
  if (onAuth) return '/auth.html'; // already there — no loop
  return `/auth.html?redirect=${encodeURIComponent(cur)}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Protect a page. Call synchronously at the top of any page script.
 *
 * If no valid session: redirects to /auth.html?redirect=<current page>.
 * If logged in:        returns the access_token (no async needed).
 *
 * Usage:
 *   const token = authGuard();   // if this returns, we're authenticated
 */
function authGuard() {
  const session = getSession();
  if (!session) {
    window.location.href = _authRedirectUrl();
    return null;
  }
  return session.access_token;
}

/** Return user object { id, email, display_name } from current session, or null. */
function getUser() {
  return getSession()?.user ?? null;
}

/** True if a valid, non-expired session exists. */
function isLoggedIn() {
  return getSession() !== null;
}

// ── Auth actions ──────────────────────────────────────────────────────────────

async function _post(path, body, accessToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

async function _get(path, accessToken) {
  const headers = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  const res = await fetch(path, { headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/** Sign in — stores session, schedules refresh, returns user object. */
async function signIn(email, password) {
  const data   = await _post('/api/auth/signin', { email, password });
  const stored = _storeSession(data.session);
  _scheduleRefresh(stored);
  return stored.user;
}

/** Sign up — auto-signs-in, stores session, returns user object. */
async function signUp(email, password, name) {
  const data   = await _post('/api/auth/signup', { email, password, display_name: name });
  const stored = _storeSession(data.session);
  _scheduleRefresh(stored);
  return stored.user;
}

/** Sign out — clears session, revokes on server (best-effort), redirects to /auth.html. */
async function signOut() {
  const session = getSession();
  try {
    if (session) await _post('/api/auth/signout', {}, session.access_token);
  } catch { /* ignore server errors — still clear locally */ }
  _clearSession();
  window.location.href = '/auth.html';
}

/** Refresh the access token. Returns new session or null on failure. */
async function refreshSession() {
  const session = getSession();
  if (!session?.refresh_token) return null;
  try {
    const data   = await _post('/api/auth/refresh', { refresh_token: session.refresh_token });
    const stored = _storeSession(data.session);
    _scheduleRefresh(stored);
    return stored;
  } catch {
    _clearSession();
    return null;
  }
}

/** Validate token against server and return full profile, or null. */
async function fetchMe() {
  const session = getSession();
  if (!session) return null;
  try { return await _get('/api/auth/me', session.access_token); }
  catch { return null; }
}

// ── bxFetch ───────────────────────────────────────────────────────────────────
// Auth-aware fetch. Drop-in replacement for window.fetch().
//   • Attaches Bearer token from current session
//   • On 401: tries one silent token refresh and retries
//   • If refresh fails or second 401: clears session, redirects to
//     /auth.html?redirect=<current page> (so user returns here after login)
// Returns the raw Response — callers do .json() / .text() as needed.

async function bxFetch(input, init = {}) {
  function _build(token) {
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return { ...init, headers };
  }

  const session = getSession();
  let res = await fetch(input, _build(session?.access_token));
  if (res.status !== 401) return res;

  // First 401 → attempt silent token refresh
  const refreshed = await refreshSession();
  if (!refreshed?.access_token) {
    window.location.href = _authRedirectUrl();
    return res;
  }

  // Retry with new token
  res = await fetch(input, _build(refreshed.access_token));
  if (res.status === 401) {
    _clearSession();
    window.location.href = _authRedirectUrl();
  }
  return res;
}

// ── Auto-refresh scheduler ────────────────────────────────────────────────────

let _refreshTimer = null;

function _scheduleRefresh(session) {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  const msUntilRefresh = session.expires_at - Date.now() - REFRESH_THRESHOLD_MS;
  if (msUntilRefresh > 0) {
    _refreshTimer = setTimeout(async () => {
      const ok = await refreshSession();
      if (!ok) window.location.href = _authRedirectUrl();
    }, msUntilRefresh);
  }
}

// Proactively refresh on page load if close to expiry
(function _initAutoRefresh() {
  const session = getSession();
  if (session) _scheduleRefresh(session);
})();

// ── auth.html page logic ──────────────────────────────────────────────────────
// This block ONLY runs when we are actually on the login/signup page.
// It is harmless when auth.js is included by any other page.

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _authPageInit);
} else {
  _authPageInit();
}

function _authPageInit() {
  const onAuth = window.location.pathname === '/auth' ||
                 window.location.pathname.endsWith('/auth.html');
  if (!onAuth) return;

  // Already logged in → bounce to redirect target or app root
  if (isLoggedIn()) {
    const redir = new URLSearchParams(window.location.search).get('redirect');
    window.location.href = redir || '/';
    return;
  }

  // Wire up password-strength meter
  const pwInput = document.getElementById('signup-password');
  if (pwInput) pwInput.addEventListener('input', _updatePwStrength);
}

// ── Form handlers (used by auth.html) ────────────────────────────────────────

async function handleSignIn(e) {
  e.preventDefault();
  const form  = e.target;
  const email = form.querySelector('#signin-email').value.trim();
  const pw    = form.querySelector('#signin-password').value;
  const btn   = document.getElementById('signin-btn');
  const err   = document.getElementById('signin-error');

  _clearMsg(err);
  _setLoading(btn, true);
  try {
    await signIn(email, pw);
    const redir = new URLSearchParams(window.location.search).get('redirect');
    window.location.href = redir || '/';
  } catch (ex) {
    _showError(err, ex.message || 'Sign in failed. Check your credentials.');
    _setLoading(btn, false);
  }
}

async function handleSignUp(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.querySelector('#signup-name').value.trim();
  const email = form.querySelector('#signup-email').value.trim();
  const pw    = form.querySelector('#signup-password').value;
  const btn   = document.getElementById('signup-btn');
  const err   = document.getElementById('signup-error');
  const ok    = document.getElementById('signup-success');

  _clearMsg(err); _clearMsg(ok);
  if (pw.length < 8) { _showError(err, 'Password must be at least 8 characters.'); return; }

  _setLoading(btn, true);
  try {
    await signUp(email, pw, name);
    const redir = new URLSearchParams(window.location.search).get('redirect');
    window.location.href = redir || '/';
  } catch (ex) {
    _showError(err, ex.message || 'Could not create account. Please try again.');
    _setLoading(btn, false);
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function switchTab(tab) {
  const signinTab   = document.getElementById('tab-signin');
  const signupTab   = document.getElementById('tab-signup');
  const signinPanel = document.getElementById('panel-signin');
  const signupPanel = document.getElementById('panel-signup');
  const indicator   = document.getElementById('tabIndicator');

  const isSignin = tab === 'signin';
  signinTab.classList.toggle('active',   isSignin);
  signupTab.classList.toggle('active',  !isSignin);
  signinPanel.classList.toggle('active',  isSignin);
  signupPanel.classList.toggle('active', !isSignin);
  signinTab.setAttribute('aria-selected', String(isSignin));
  signupTab.setAttribute('aria-selected', String(!isSignin));
  if (indicator) indicator.classList.toggle('right', !isSignin);
}

function _setLoading(btn, loading) {
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

function _showError(el, msg)   { if (el) { el.textContent = msg; el.classList.add('visible'); } }
function _showSuccess(el, msg) { if (el) { el.textContent = msg; el.classList.add('visible'); } }
function _clearMsg(el)         { if (el) { el.textContent = '';  el.classList.remove('visible'); } }

function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === 'text';
  input.type = show ? 'password' : 'text';
  btn.setAttribute('aria-label', show ? 'Show password' : 'Hide password');
  const svg = btn.querySelector('svg');
  if (svg) svg.style.opacity = show ? '1' : '0.5';
}

function _updatePwStrength(e) {
  const val   = e.target.value;
  const fill  = document.getElementById('pw-strength-fill');
  const label = document.getElementById('pw-strength-label');
  if (!fill || !label) return;

  let score = 0;
  if (val.length >= 8)          score++;
  if (val.length >= 12)         score++;
  if (/[A-Z]/.test(val))        score++;
  if (/[0-9]/.test(val))        score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;

  const levels = [
    { pct: '0%',   color: 'transparent', text: '' },
    { pct: '25%',  color: '#dc2626',     text: 'Weak' },
    { pct: '50%',  color: '#d97706',     text: 'Fair' },
    { pct: '75%',  color: '#ca8a04',     text: 'Good' },
    { pct: '90%',  color: '#16a34a',     text: 'Strong' },
    { pct: '100%', color: '#16a34a',     text: 'Strong' },
  ];
  const level = levels[Math.min(score, 5)];
  fill.style.width      = level.pct;
  fill.style.background = level.color;
  label.textContent     = level.text;
  label.style.color     = level.color;
}

// ── User pill (used by app.js via global scope) ───────────────────────────────

function renderUserPill() {
  const user = getUser();
  if (!user) return '';
  const initial = (user.display_name || user.email || '?').charAt(0).toUpperCase();
  const label   = user.display_name || user.email || 'User';
  return `
    <div class="user-pill" title="${_esc(user.email || '')}">
      <div class="user-pill-avatar">${_esc(initial)}</div>
      <span class="user-pill-email">${_esc(label)}</span>
      <button class="signout-btn" onclick="signOut()" title="Sign out" aria-label="Sign out">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M13 3h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4M9 14l4-4-4-4M13 10H3"
                stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>`;
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Window exports ────────────────────────────────────────────────────────────
// Everything a page or module needs — nothing else is public.

window.authGuard     = authGuard;
window.bxFetch       = bxFetch;
window.getUser       = getUser;
window.isLoggedIn    = isLoggedIn;
window.signIn        = signIn;
window.signOut       = signOut;
window.signUp        = signUp;
window.renderUserPill = renderUserPill;
