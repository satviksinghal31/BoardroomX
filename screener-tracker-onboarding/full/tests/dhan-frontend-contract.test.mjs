import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('frontend no longer advertises Yahoo as active chart data source', () => {
  assert.equal(appJs.includes('yahoo-finance2'), false);
  assert.equal(appJs.includes('yahooFinance.'), false);
});

test('chart range controls include MAX on desktop and mobile', () => {
  assert.match(indexHtml, /id="tfmax"[^>]+switchTf\('MAX'\)[^>]*>MAX<\/button>/);
  assert.match(indexHtml, /id="mtfmax"[^>]+switchMobileTf\('MAX'\)[^>]*>MAX<\/button>/);
  assert.match(appJs, /'MAX':\s*null/);
});

test('frontend requests live prices for searched chart symbols', () => {
  assert.match(appJs, /new URLSearchParams\(\)/);
  assert.match(appJs, /params\.set\('symbols'/);
  assert.match(appJs, /bxFetch\(`\/api\/prices\?\$\{params\.toString\(\)\}`\)/);
});

test('detail sheet does not render removed PE fields', () => {
  assert.equal(appJs.includes('Trailing PE'), false);
  assert.equal(appJs.includes('Forward PE'), false);
  assert.equal(appJs.includes('Fwd P/E'), false);
});
