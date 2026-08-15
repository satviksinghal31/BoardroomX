import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readPublic = (name) => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('BoardroomX primary pages link to the mutual-fund analyser', async () => {
  for (const page of ['index.html', 'annuals.html']) {
    const html = await readPublic(page);
    assert.match(html, /href="\/mutual-funds\.html"[^>]*>[\s\S]*?Mutual Funds/);
  }
});

test('mutual-fund analyser is limited to the approved Release A universe', async () => {
  const html = await readPublic('mutual-funds.html');

  for (const name of ['Bandhan', 'Quant', 'Bank of India', 'Nippon India']) {
    assert.match(html, new RegExp(name, 'i'));
  }
  assert.match(html, /benchmark fund proxy/i);
  assert.match(html, /not (?:the )?actual[^<]*TRI/i);
  assert.match(html, /sample|preview/i);
  assert.match(html, /href="\/mutual-funds-details\.html"/);
  assert.match(html, /\/data\/mutual-funds\/fund-facts\.json/);
  assert.match(html, /portfolio holdings unknown/i);

  for (const unsupported of [
    'Nippon India Small Cap Fund',
    'HDFC Small Cap Fund',
    'Franklin India Smaller Companies',
    'SBI Small Cap Fund',
    'Kotak Small Cap Fund',
  ]) {
    assert.doesNotMatch(html, new RegExp(unsupported, 'i'));
  }

  assert.doesNotMatch(html, /portfolio overlap|portfolio growth|elimination|final verdict/i);
});

test('analyser preserves the supplied comparison and rolling-analysis skeleton', async () => {
  const html = await readPublic('mutual-funds.html');

  for (const contract of [
    'id="checksStrip"',
    'id="fTable"',
    'id="metricGrid"',
    'id="medianReturnsTable"',
    'id="consistencyTable"',
    'id="distributionTable"',
    'class="chart-placeholder"',
  ]) {
    assert.match(html, new RegExp(contract));
  }
  assert.match(html, /AUM \(Cr\)/);
  assert.match(html, /Expense/);
  assert.match(html, /NAV/);
  assert.match(html, /Rating/);
  assert.match(html, /Value Research overview facts/i);
});

test('details page uses the same approved universe and states its preview status', async () => {
  const html = await readPublic('mutual-funds-details.html');

  for (const name of ['Bandhan', 'Quant', 'Bank of India', 'Nippon India']) {
    assert.match(html, new RegExp(name, 'i'));
  }
  assert.match(html, /benchmark fund proxy/i);
  assert.match(html, /sample|preview/i);
  assert.match(html, /href="\/mutual-funds\.html"/);
  assert.match(html, /\/data\/mutual-funds\/fund-facts\.json/);
  assert.match(html, /Holdings not complete/i);
});

test('details page retains all supplied data-view tabs as pending skeletons', async () => {
  const html = await readPublic('mutual-funds-details.html');

  for (const view of ['Raw NAV', 'Rolling Returns', 'Score Components', 'Instrument Metadata']) {
    assert.match(html, new RegExp(`data-view="[^"]+"[^>]*>${view}`));
  }
  assert.match(html, /id="detailsContent"/);
  assert.match(html, /Pending verified data/i);
  assert.match(html, /id="metadataTable"/);
  assert.match(html, /portfolio_status/);
});

test('details tabs expose associated panels and managed keyboard state', async () => {
  const html = await readPublic('mutual-funds-details.html');
  const views = ['nav', 'rolling', 'scores', 'instruments'];

  assert.match(html, /role="tablist"[^>]*aria-label=/);
  for (const view of views) {
    assert.match(html, new RegExp(`id="tab-${view}"[^>]*role="tab"[^>]*aria-controls="view-${view}"`));
    assert.match(html, new RegExp(`id="view-${view}"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-${view}"`));
  }
  assert.match(html, /aria-selected="true"[^>]*tabindex="0"/);
  assert.match(html, /aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(html, /ArrowLeft/);
  assert.match(html, /ArrowRight/);
  assert.match(html, /Home/);
  assert.match(html, /End/);
  assert.match(html, /setAttribute\('aria-selected'/);
  assert.match(html, /\.focus\(\)/);
});

test('decorative chart bars are hidden from assistive technology', async () => {
  const html = await readPublic('mutual-funds.html');
  const chart = html.match(/<div class="chart-placeholder"[\s\S]*?<\/div>/)?.[0] ?? '';

  assert.doesNotMatch(chart, /<i[\s>]/);
  assert.equal((chart.match(/<span aria-hidden="true"><\/span>/g) ?? []).length, 5);
  assert.match(html, /@media\(max-width:480px\)[^{]*\{[^}]*\.placeholder-grid,\.metric-grid\{grid-template-columns:1fr\}/);
});
