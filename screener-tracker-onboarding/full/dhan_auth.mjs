import * as OTPAuth from 'otpauth';

const DHAN_TOKEN_URL = 'https://auth.dhan.co/app/generateAccessToken';
const TOKEN_REUSE_MARGIN_MS = 2 * 60 * 60 * 1000;
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function requireEnv(env, name) {
  const value = env?.[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function defaultTotp(secret) {
  return new OTPAuth.TOTP({
    issuer: 'Dhan',
    label: 'BoardroomX',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  }).generate();
}

function tokenReusable(state, now) {
  if (!state?.access_token || !state?.expiry_time) return false;
  const expiryMs = new Date(state.expiry_time).getTime();
  if (!Number.isFinite(expiryMs)) return false;
  return expiryMs - now.getTime() > TOKEN_REUSE_MARGIN_MS;
}

async function responseText(response) {
  if (typeof response.text === 'function') return response.text();
  try {
    return JSON.stringify(await response.json());
  } catch {
    return '';
  }
}

export function createDhanAuth({
  env = process.env,
  stateStore,
  generateTotp = defaultTotp,
  fetchImpl = fetch,
  now = () => new Date(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!stateStore?.read || !stateStore?.write) {
    throw new Error('stateStore with read/write is required');
  }

  async function refreshToken() {
    const clientId = requireEnv(env, 'DHAN_CLIENT_ID');
    const pin = requireEnv(env, 'DHAN_PIN');
    const secret = requireEnv(env, 'DHAN_TOTP_SECRET');
    const totp = generateTotp(secret);
    const url = new URL(DHAN_TOKEN_URL);
    url.searchParams.set('dhanClientId', clientId);
    url.searchParams.set('pin', pin);
    url.searchParams.set('totp', totp);

    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetchImpl(url, { method: 'POST' });
        if (response.ok) {
          const payload = await response.json();
          if (!payload?.accessToken || !payload?.expiryTime) {
            throw new Error('Dhan token response missing accessToken or expiryTime');
          }
          await stateStore.write({
            access_token: payload.accessToken,
            issued_at: now().toISOString(),
            expiry_time: payload.expiryTime,
            last_refresh_error: null,
          });
          return payload.accessToken;
        }

        const body = await responseText(response);
        lastError = new Error(`Dhan token refresh failed (${response.status}): ${body}`);
        if (!TRANSIENT_STATUSES.has(response.status)) break;
      } catch (err) {
        lastError = err;
      }

      if (attempt < 3) await sleep(250 * attempt);
    }

    await stateStore.write({
      ...(await stateStore.read()),
      last_refresh_error: lastError?.message ?? 'Dhan token refresh failed',
      updated_at: now().toISOString(),
    });
    throw new Error(`Dhan token refresh failed: ${lastError?.message ?? 'unknown error'}`);
  }

  return {
    async getAccessToken() {
      const state = await stateStore.read();
      if (tokenReusable(state, now())) return state.access_token;
      return refreshToken();
    },
  };
}

export function createSupabaseDhanAuthStateStore(supabase) {
  return {
    async read() {
      const { data, error } = await supabase
        .from('dhan_auth_state')
        .select('access_token, issued_at, expiry_time, last_refresh_error')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw new Error(`dhan_auth_state read failed: ${error.message}`);
      return data;
    },
    async write(state) {
      const { error } = await supabase
        .from('dhan_auth_state')
        .upsert({ id: 1, ...state, updated_at: new Date().toISOString() });
      if (error) throw new Error(`dhan_auth_state write failed: ${error.message}`);
    },
  };
}
