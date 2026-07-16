import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseWorkerArgs,
  processSymbolsSequentially,
  snapshotRowFromScrape,
} from '../scripts/advanced-screener-bulk-worker.mjs';

test('parseWorkerArgs defaults to one second delay and dedupes symbols', () => {
  const args = parseWorkerArgs([
    'node',
    'worker',
    '--symbols',
    'tdpowersys,TCS,TDPOWERSYS',
    '--statement',
    'standalone',
  ]);

  assert.deepEqual(args.symbols, ['TDPOWERSYS', 'TCS']);
  assert.equal(args.delaySeconds, 1);
  assert.equal(args.statement, 'standalone');
});

test('snapshotRowFromScrape keeps full payload and completeness fields', () => {
  const scraped = {
    ticker: 'TDPOWERSYS',
    name: 'TD Power Systems Ltd',
    url: 'https://www.screener.in/company/TDPOWERSYS/consolidated/',
    statement_type: 'consolidated',
    is_consolidated: true,
    parser_version: 'boardroomx-screener-v1',
    section_status: { profit_loss: { status: 'ok', error: null } },
    profit_loss: { years: ['Mar 2025', 'Mar 2026'], line_items: [] },
    quarters: { years: ['Dec 2025', 'Mar 2026'], line_items: [] },
  };

  const row = snapshotRowFromScrape(scraped);

  assert.equal(row.symbol, 'TDPOWERSYS');
  assert.equal(row.company_name, 'TD Power Systems Ltd');
  assert.equal(row.latest_profit_loss_period, 'Mar 2026');
  assert.equal(row.latest_quarter_period, 'Mar 2026');
  assert.equal(row.payload, scraped);
  assert.deepEqual(row.section_status, scraped.section_status);
});

test('processSymbolsSequentially waits between symbols and reports progress', async () => {
  const events = [];
  const result = await processSymbolsSequentially(['A', 'B'], {
    delaySeconds: 1,
    scrapeSymbol: async symbol => {
      events.push(`scrape:${symbol}`);
      return { ticker: symbol, profit_loss: { years: [] }, quarters: { years: [] } };
    },
    persistSymbol: async symbol => {
      events.push(`persist:${symbol}`);
    },
    markFailure: async () => {},
    sleep: async ms => {
      events.push(`sleep:${ms}`);
    },
  });

  assert.deepEqual(events, ['scrape:A', 'persist:A', 'sleep:1000', 'scrape:B', 'persist:B']);
  assert.equal(result.completed, 2);
  assert.equal(result.failed, 0);
});
