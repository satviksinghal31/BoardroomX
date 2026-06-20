import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeFeedPacket } from '../scripts/lib/dhan-feed-decoder.mjs';
import { applyTick, serializeLiveState } from '../scripts/lib/dhan-live-aggregate.mjs';

function header({ code, length = 16, segment = 1, securityId = 1333 }) {
  const buf = Buffer.alloc(length);
  buf.writeUInt8(code, 0);
  buf.writeInt16LE(length, 1);
  buf.writeUInt8(segment, 3);
  buf.writeInt32LE(securityId, 4);
  return buf;
}

test('decodeFeedPacket reads Dhan ticker packets as little-endian binary', () => {
  const buf = header({ code: 2, length: 16, securityId: 1333 });
  buf.writeFloatLE(2500.25, 8);
  buf.writeInt32LE(1782104400, 12);

  assert.deepEqual(decodeFeedPacket(buf), {
    packetType: 'ticker',
    responseCode: 2,
    exchangeSegmentCode: 1,
    securityId: '1333',
    ltp: 2500.25,
    lastTradeTime: 1782104400,
  });
});

test('decodeFeedPacket reads previous-close packets', () => {
  const buf = header({ code: 6, length: 16, securityId: 1333 });
  buf.writeFloatLE(2488.5, 8);
  buf.writeInt32LE(0, 12);

  assert.deepEqual(decodeFeedPacket(buf), {
    packetType: 'prev_close',
    responseCode: 6,
    exchangeSegmentCode: 1,
    securityId: '1333',
    prevClose: 2488.5,
    previousOpenInterest: 0,
  });
});

test('applyTick tracks open high low ltp volume for a trading day', () => {
  let state = new Map();
  state = applyTick(state, { symbol: 'ABC', tradeDate: '2026-06-22', ltp: 100, volume: 10, lastTickAt: '2026-06-22T04:00:00.000Z' });
  state = applyTick(state, { symbol: 'ABC', tradeDate: '2026-06-22', ltp: 103, volume: 15, lastTickAt: '2026-06-22T04:01:00.000Z' });
  state = applyTick(state, { symbol: 'ABC', tradeDate: '2026-06-22', ltp: 99, volume: 20, lastTickAt: '2026-06-22T04:02:00.000Z' });

  assert.deepEqual(state.get('ABC'), {
    symbol: 'ABC',
    trade_date: '2026-06-22',
    open: 100,
    high: 103,
    low: 99,
    ltp: 99,
    prev_close: null,
    volume: 20,
    last_tick_at: '2026-06-22T04:02:00.000Z',
  });
});

test('applyTick resets when trade date rolls over and serializeLiveState sorts by symbol', () => {
  let state = new Map();
  state = applyTick(state, { symbol: 'XYZ', tradeDate: '2026-06-22', ltp: 50, volume: 10, lastTickAt: '2026-06-22T04:00:00.000Z' });
  state = applyTick(state, { symbol: 'ABC', tradeDate: '2026-06-23', ltp: 70, prevClose: 49, volume: 1, lastTickAt: '2026-06-23T04:00:00.000Z' });
  state = applyTick(state, { symbol: 'XYZ', tradeDate: '2026-06-23', ltp: 55, prevClose: 50, volume: 2, lastTickAt: '2026-06-23T04:01:00.000Z' });

  assert.deepEqual(state.get('XYZ'), {
    symbol: 'XYZ',
    trade_date: '2026-06-23',
    open: 55,
    high: 55,
    low: 55,
    ltp: 55,
    prev_close: 50,
    volume: 2,
    last_tick_at: '2026-06-23T04:01:00.000Z',
  });
  assert.deepEqual(serializeLiveState(state).map(row => row.symbol), ['ABC', 'XYZ']);
});
