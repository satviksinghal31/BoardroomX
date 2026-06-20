import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import WebSocket from 'ws';

import { createDhanAuth, createSupabaseDhanAuthStateStore } from './dhan_auth.mjs';
import { decodeFeedPacket } from './scripts/lib/dhan-feed-decoder.mjs';
import { applyTick, serializeLiveState } from './scripts/lib/dhan-live-aggregate.mjs';
import { todayIstDate } from './scripts/lib/dhan-time.mjs';

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'DHAN_CLIENT_ID',
  'DHAN_PIN',
  'DHAN_TOTP_SECRET',
];

export function validateWorkerEnv(env = process.env) {
  for (const name of REQUIRED_ENV) {
    if (!env[name]) throw new Error(`${name} is required`);
  }
  return true;
}

export function buildSubscriptionMessages(instruments, batchSize = 100) {
  const messages = [];
  for (let i = 0; i < instruments.length; i += batchSize) {
    const batch = instruments.slice(i, i + batchSize);
    messages.push({
      RequestCode: 15,
      InstrumentCount: batch.length,
      InstrumentList: batch.map(row => ({
        ExchangeSegment: row.dhan_exchange_segment ?? 'NSE_EQ',
        SecurityId: String(row.dhan_security_id),
      })),
    });
  }
  return messages;
}

function createSupabase(env = process.env) {
  return createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function createPool(env = process.env) {
  const { Pool } = pg;
  return new Pool({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
}

async function loadInstruments(pool) {
  const { rows } = await pool.query(`
    SELECT symbol, dhan_security_id, dhan_exchange_segment
    FROM dhan_instruments
    WHERE is_active IS DISTINCT FROM false
      AND dhan_security_id IS NOT NULL
    ORDER BY symbol ASC
  `);
  return rows;
}

async function upsertLiveRows(supabase, rows) {
  if (!rows.length) return;
  const { error } = await supabase
    .from('dhan_live_today')
    .upsert(rows, { onConflict: 'symbol' });
  if (error) throw new Error(`dhan_live_today upsert failed: ${error.message}`);
}

function packetToTick(packet, symbolBySecurityId) {
  if (packet.packetType !== 'ticker') return null;
  const symbol = symbolBySecurityId.get(packet.securityId);
  if (!symbol) return null;
  return {
    symbol,
    tradeDate: todayIstDate(),
    ltp: packet.ltp,
    lastTickAt: new Date((packet.lastTradeTime || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };
}

export async function runDhanLiveFeed({
  env = process.env,
  supabase = createSupabase(env),
  pool = createPool(env),
  WebSocketImpl = WebSocket,
  flushMs = 10_000,
} = {}) {
  validateWorkerEnv(env);

  const auth = createDhanAuth({
    env,
    stateStore: createSupabaseDhanAuthStateStore(supabase),
  });

  const instruments = await loadInstruments(pool);
  if (!instruments.length) throw new Error('No active Dhan instruments found');
  const symbolBySecurityId = new Map(instruments.map(row => [String(row.dhan_security_id), row.symbol]));
  const token = await auth.getAccessToken();
  const url = `wss://api-feed.dhan.co?version=2&token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(env.DHAN_CLIENT_ID)}&authType=2`;

  let state = new Map();
  const ws = new WebSocketImpl(url);
  const flushTimer = setInterval(async () => {
    try {
      await upsertLiveRows(supabase, serializeLiveState(state));
    } catch (err) {
      console.error('[dhan-worker] flush failed:', err.message);
    }
  }, flushMs);

  ws.on('open', () => {
    for (const message of buildSubscriptionMessages(instruments)) {
      ws.send(JSON.stringify(message));
    }
    console.log(`[dhan-worker] subscribed ${instruments.length} instruments`);
  });

  ws.on('message', data => {
    try {
      const packet = decodeFeedPacket(data);
      const tick = packetToTick(packet, symbolBySecurityId);
      if (tick) state = applyTick(state, tick);
    } catch (err) {
      console.warn('[dhan-worker] packet decode failed:', err.message);
    }
  });

  ws.on('close', () => {
    clearInterval(flushTimer);
    console.warn('[dhan-worker] websocket closed');
  });

  ws.on('error', err => {
    console.error('[dhan-worker] websocket error:', err.message);
  });

  return { ws, stop: () => { clearInterval(flushTimer); ws.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDhanLiveFeed().catch(err => {
    console.error('[dhan-worker] fatal:', err);
    process.exitCode = 1;
  });
}
