import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  extractFact,
  parseQuarterlyXbrl,
} from '../scripts/lib/nse-quarterly-xbrl.mjs';

const fixture = async (name) => readFile(
  new URL(`./fixtures/nse-quarterly/${name}`, import.meta.url),
  'utf8',
);

test('official NSE fixtures match their documented immutable checksums', async () => {
  const sources = JSON.parse(await fixture('sources.json'));

  for (const source of sources) {
    const xml = await fixture(source.file);
    const checksum = createHash('sha256').update(xml).digest('hex');
    assert.equal(checksum, source.sha256, `${source.file} checksum`);
    assert.match(source.url, /^https:\/\/nsearchives\.nseindia\.com\/corporate\/xbrl\//);
  }
});

test('extractFact matches an exact local name and OneD context only', () => {
  const xml = `
    <xbrli:xbrl>
      <in:RevenueFromOperations contextRef="PreviousD">1</in:RevenueFromOperations>
      <in:SegmentRevenueFromOperations contextRef="OneD">2</in:SegmentRevenueFromOperations>
      <in:RevenueFromOperations unitRef="INR" contextRef="OneD">003</in:RevenueFromOperations>
    </xbrli:xbrl>`;

  assert.equal(extractFact(xml, 'RevenueFromOperations'), '3');
  assert.equal(extractFact(xml, 'RevenueFromOperations', 'PreviousD'), '1');
});

test('parses the official SBI banking XBRL with exact INR arithmetic', async () => {
  assert.deepEqual(parseQuarterlyXbrl(await fixture('sbi-jun-2026.xml')), {
    taxonomy: 'banking',
    revenueInr: '1362404900000',
    calculatedEbitdaInr: '713100000000',
    netProfitInr: '251208900000',
    componentsInr: {
      interest_earned: '1362404900000',
      employees_cost: '192186600000',
      other_operating_expenses: '399639500000',
      provisions: '57478800000',
    },
    issues: [],
  });
});

test('parses the official Hindalco Ind AS XBRL', async () => {
  const result = parseQuarterlyXbrl(await fixture('hindalco-jun-2026.xml'));

  assert.equal(result.taxonomy, 'indas');
  assert.equal(result.revenueInr, '848250000000');
  assert.equal(result.calculatedEbitdaInr, '139320000000');
  assert.equal(result.netProfitInr, '70130000000');
  assert.deepEqual(result.issues, []);
});

test('parses the official ONGC Ind AS XBRL', async () => {
  const result = parseQuarterlyXbrl(await fixture('ongc-jun-2026.xml'));

  assert.equal(result.revenueInr, '2049873500000');
  assert.equal(result.calculatedEbitdaInr, '154853500000');
  assert.equal(result.netProfitInr, '65544400000');
  assert.deepEqual(result.issues, []);
});

test('missing required EBITDA facts produce null and a named issue', async () => {
  const xml = (await fixture('hindalco-jun-2026.xml')).replace(
    /<in-capmkt:OtherExpenses contextRef="OneD"[^>]*>[^<]*<\/in-capmkt:OtherExpenses>/,
    '',
  );
  const result = parseQuarterlyXbrl(xml);

  assert.equal(result.calculatedEbitdaInr, null);
  assert.deepEqual(result.issues, ['OtherExpenses']);
});

test('rejects an XBRL instance without a supported taxonomy identity', () => {
  assert.throws(
    () => parseQuarterlyXbrl('<xbrli:xbrl><x:InterestEarned contextRef="OneD">1</x:InterestEarned></xbrli:xbrl>'),
    /supported.*taxonomy/i,
  );
});
