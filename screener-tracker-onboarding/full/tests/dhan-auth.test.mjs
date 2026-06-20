import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDhanAuth } from '../dhan_auth.mjs';
import { chunkSecurityIds, createDhanClient } from '../scripts/lib/dhan-client.mjs';

function createStateStore(initial = null) {
  let state = initial;
  return {
    async read() {
      return state;
    },
    async write(next) {
      state = next;
    },
    get state() {
      return state;
    },
  };
}

test('createDhanAuth reuses a token with more than two hours remaining', async () => {
  const stateStore = createStateStore({
    access_token: 'cached-token',
    expiry_time: '2026-06-22T10:00:00.000Z',
  });
  let calls = 0;
  const auth = createDhanAuth({
    env: { DHAN_CLIENT_ID: '1001', DHAN_PIN: '123456', DHAN_TOTP_SECRET: 'SECRET' },
    stateStore,
    generateTotp: () => '000000',
    now: () => new Date('2026-06-22T07:00:00.000Z'),
    fetchImpl: async () => {
      calls += 1;
      throw new Error('should not fetch');
    },
  });

  assert.equal(await auth.getAccessToken(), 'cached-token');
  assert.equal(calls, 0);
});

test('createDhanAuth refreshes expired token and stores new state', async () => {
  const stateStore = createStateStore({
    access_token: 'old-token',
    expiry_time: '2026-06-22T07:30:00.000Z',
  });
  const auth = createDhanAuth({
    env: { DHAN_CLIENT_ID: '1001', DHAN_PIN: '123456', DHAN_TOTP_SECRET: 'SECRET' },
    stateStore,
    generateTotp: () => '123123',
    now: () => new Date('2026-06-22T07:00:00.000Z'),
    fetchImpl: async url => {
      assert.equal(url.toString(), 'https://auth.dhan.co/app/generateAccessToken?dhanClientId=1001&pin=123456&totp=123123');
      return {
        ok: true,
        status: 200,
        async json() {
          return { accessToken: 'new-token', expiryTime: '2026-06-23T07:00:00.000' };
        },
      };
    },
  });

  assert.equal(await auth.getAccessToken(), 'new-token');
  assert.equal(stateStore.state.access_token, 'new-token');
  assert.equal(stateStore.state.last_refresh_error, null);
});

test('createDhanAuth retries transient failures but not terminal auth failures', async () => {
  const transientStore = createStateStore();
  let transientCalls = 0;
  const transientAuth = createDhanAuth({
    env: { DHAN_CLIENT_ID: '1001', DHAN_PIN: '123456', DHAN_TOTP_SECRET: 'SECRET' },
    stateStore: transientStore,
    generateTotp: () => '111111',
    now: () => new Date('2026-06-22T07:00:00.000Z'),
    sleep: async () => {},
    fetchImpl: async () => {
      transientCalls += 1;
      if (transientCalls < 3) return { ok: false, status: 503, async text() { return 'busy'; } };
      return { ok: true, status: 200, async json() { return { accessToken: 'retry-token', expiryTime: '2026-06-23T07:00:00.000' }; } };
    },
  });

  assert.equal(await transientAuth.getAccessToken(), 'retry-token');
  assert.equal(transientCalls, 3);

  const terminalStore = createStateStore();
  let terminalCalls = 0;
  const terminalAuth = createDhanAuth({
    env: { DHAN_CLIENT_ID: '1001', DHAN_PIN: '123456', DHAN_TOTP_SECRET: 'SECRET' },
    stateStore: terminalStore,
    generateTotp: () => '111111',
    now: () => new Date('2026-06-22T07:00:00.000Z'),
    sleep: async () => {},
    fetchImpl: async () => {
      terminalCalls += 1;
      return { ok: false, status: 401, async text() { return 'bad totp'; } };
    },
  });

  await assert.rejects(() => terminalAuth.getAccessToken(), /Dhan token refresh failed/);
  assert.equal(terminalCalls, 1);
  assert.match(terminalStore.state.last_refresh_error, /bad totp/);
});

test('chunkSecurityIds splits ids into bounded chunks without mutating input', () => {
  const ids = ['1', '2', '3', '4', '5'];
  assert.deepEqual(chunkSecurityIds(ids, 2), [['1', '2'], ['3', '4'], ['5']]);
  assert.deepEqual(ids, ['1', '2', '3', '4', '5']);
});

test('createDhanClient sends authenticated historical and OHLC requests', async () => {
  const calls = [];
  const client = createDhanClient({
    clientId: '1001',
    getAccessToken: async () => 'token',
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), options });
      return { ok: true, status: 200, async json() { return { status: 'success' }; } };
    },
  });

  await client.fetchHistoricalDaily({
    securityId: '1333',
    exchangeSegment: 'NSE_EQ',
    fromDate: '2026-01-01',
    toDate: '2026-01-31',
  });
  await client.fetchOhlcBySegment({ NSE_EQ: ['1333'] });

  assert.equal(calls[0].url, 'https://api.dhan.co/v2/charts/historical');
  assert.equal(calls[0].options.headers['access-token'], 'token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    securityId: '1333',
    exchangeSegment: 'NSE_EQ',
    instrument: 'EQUITY',
    expiryCode: 0,
    oi: false,
    fromDate: '2026-01-01',
    toDate: '2026-01-31',
  });
  assert.equal(calls[1].url, 'https://api.dhan.co/v2/marketfeed/ohlc');
  assert.equal(calls[1].options.headers['client-id'], '1001');
});
