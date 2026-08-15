import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readPublic = (name) => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('quarterly page states its exact source and exposes only approved controls', async () => {
  const html = await readPublic('quarterly-results.html');
  assert.match(html, /NSE India Integrated Filing API/i);
  assert.match(html, /NSE XBRL/i);
  assert.match(html, /historical NSE XBRL/i);
  assert.match(html, /calculated EBITDA/i);
  assert.match(html, /id="quarterlySearch"/);
  const options = [...html.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(options, ['reported_at', 'revenue_yoy', 'profit_yoy', 'desc', 'asc']);
  assert.match(html, /id="quarterlyResults"/);
});

test('frontend uses only the BoardroomX API and renders all three periods and sources', async () => {
  const js = await readPublic('quarterly-results.js');
  assert.match(js, /authGuard\(\)/);
  assert.match(js, /bxFetch\(`\/api\/quarterly-results\?/);
  assert.doesNotMatch(js, /nseindia\.com/i);
  assert.match(js, /periods\.current/);
  assert.match(js, /periods\.previous/);
  assert.match(js, /periods\.priorYear/);
  assert.match(js, /sources\.current/);
  assert.match(js, /N\/A/);
  assert.match(js, /250/);
});

test('calculated EBITDA explanation is keyboard/tap accessible and tables scroll on mobile', async () => {
  const [html, css, js] = await Promise.all([
    readPublic('quarterly-results.html'),
    readPublic('quarterly-results.css'),
    readPublic('quarterly-results.js'),
  ]);
  assert.match(html, /data-ebitda-info/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(js, /aria-expanded/);
  assert.match(css, /\.quarterly-table-wrap[\s\S]*overflow-x:\s*auto/i);
  assert.match(css, /:hover[\s\S]*\.ebitda-tooltip|:focus/i);
});

test('primary pages link the Quarterly Results navigation tab', async () => {
  const [index, annuals, quarterly] = await Promise.all([
    readPublic('index.html'),
    readPublic('annuals.html'),
    readPublic('quarterly-results.html'),
  ]);
  for (const html of [index, annuals, quarterly]) {
    assert.match(html, /href="\/quarterly-results\.html"[^>]*>[\s\S]*?Quarterly Results/i);
  }
  assert.match(quarterly, /class="hdr-nav-item active" href="\/quarterly-results\.html"/);
});

