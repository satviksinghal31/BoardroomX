import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { observePoolErrors } from '../scripts/lib/pg-pool.mjs';

test('idle PostgreSQL pool errors are observed without crashing the process', () => {
  const pool = new EventEmitter();
  const lines = [];

  assert.equal(observePoolErrors(pool, { logger: (line) => lines.push(line) }), pool);
  pool.emit('error', new Error('read ETIMEDOUT'));

  assert.deepEqual(lines, ['[postgres] idle client error: read ETIMEDOUT']);
});
