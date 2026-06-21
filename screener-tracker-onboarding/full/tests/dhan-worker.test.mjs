import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSubscriptionMessages, formatWebSocketClose, validateWorkerEnv } from '../dhan_live_feed.mjs';

test('validateWorkerEnv requires Dhan and database credentials', () => {
  assert.throws(() => validateWorkerEnv({}), /SUPABASE_URL is required/);
  assert.doesNotThrow(() => validateWorkerEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    SUPABASE_DB_URL: 'postgres://example',
    DHAN_CLIENT_ID: '1001',
    DHAN_PIN: '123456',
    DHAN_TOTP_SECRET: 'SECRET',
  }));
});

test('buildSubscriptionMessages batches instruments into Dhan request payloads', () => {
  const instruments = Array.from({ length: 205 }, (_, i) => ({
    dhan_exchange_segment: 'NSE_EQ',
    dhan_security_id: String(1000 + i),
  }));

  const batches = buildSubscriptionMessages(instruments, 100);

  assert.equal(batches.length, 3);
  assert.equal(batches[0].RequestCode, 15);
  assert.equal(batches[0].InstrumentCount, 100);
  assert.deepEqual(batches[0].InstrumentList[0], { ExchangeSegment: 'NSE_EQ', SecurityId: '1000' });
  assert.equal(batches[2].InstrumentCount, 5);
});

test('formatWebSocketClose includes close code and optional reason', () => {
  assert.equal(formatWebSocketClose(1000, ''), 'code=1000');
  assert.equal(formatWebSocketClose(4001, Buffer.from('unauthorized')), 'code=4001 reason=unauthorized');
});
