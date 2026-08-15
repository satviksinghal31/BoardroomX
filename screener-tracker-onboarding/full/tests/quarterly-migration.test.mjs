import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationUrl = new URL('../migrations/023_nse_quarterly_results.sql', import.meta.url);

test('quarterly migration contains only the approved persistence contract', () => {
  const sql = readFileSync(migrationUrl, 'utf8');
  const requiredColumns = [
    'nse_seq_id',
    'symbol',
    'period_end',
    'basis',
    'taxonomy',
    'source_xbrl_url',
    'reported_at',
    'status',
    'revenue_inr',
    'calculated_ebitda_inr',
    'net_profit_inr',
    'ebitda_components_inr',
    'last_attempt_at',
    'attempt_count',
    'next_retry_at',
    'error',
    'superseded_by_seq_id',
  ];

  for (const column of requiredColumns) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, 'i'), `missing ${column}`);
  }

  for (const rejected of ['company_name', 'pdf_url', 'market_cap', 'fetched_flag']) {
    assert.doesNotMatch(sql, new RegExp(`\\b${rejected}\\b`, 'i'), `unexpected ${rejected}`);
  }
});

test('quarterly migration enforces identity, processing, and access rules', () => {
  const sql = readFileSync(migrationUrl, 'utf8');

  assert.match(sql, /nse_seq_id\s+text\s+primary key/i);
  assert.match(sql, /references\s+public\.dhan_instruments\s*\(symbol\)/i);
  assert.match(sql, /basis\s+in\s*\('consolidated',\s*'standalone'\)/i);
  assert.match(sql, /taxonomy\s+in\s*\('indas',\s*'banking'\)/i);
  assert.match(sql, /status\s+in\s*\('pending',\s*'processing',\s*'retry',\s*'processed',\s*'failed'\)/i);
  assert.match(sql, /attempt_count\s+between\s+0\s+and\s+3/i);
  assert.match(sql, /superseded_by_seq_id\s+text\s+references\s+public\.quarterly_results/i);
  assert.match(sql, /create index[^;]+\(symbol,\s*period_end,\s*basis\)/is);
  assert.match(sql, /create index[^;]+\(status,\s*next_retry_at,\s*reported_at\)/is);
  assert.match(sql, /alter table public\.quarterly_results enable row level security/i);
  assert.match(sql, /revoke all on public\.quarterly_results from anon, authenticated/i);
  assert.match(sql, /grant all on public\.quarterly_results to service_role/i);
});
