import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildBhavcopyCandidates,
  parseMarketCapCsv,
} from '../scripts/eod-market-cap.mjs';

test('parseMarketCapCsv maps NSE mcap rows to dated facts', () => {
  const csv = [
    'Trade Date,Symbol,Series,Security Name,Category,Last Trade Date,Face Value(Rs.),Issue Size,Close Price/Paid up value(Rs.),Market Cap(Rs.)',
    '19 JUN 2026,20MICRONS,EQ,20 MICRONS LTD,Listed,19 JUN 2026,5.00,35286502,184.15,6497656478.30',
  ].join('\n');

  assert.deepEqual(parseMarketCapCsv(csv, 'mcap19062026.csv'), [{
    trade_date: '2026-06-19',
    symbol: '20MICRONS',
    series: 'EQ',
    security_name: '20 MICRONS LTD',
    category: 'Listed',
    last_trade_date: '2026-06-19',
    face_value: 5,
    issue_size: 35286502,
    close_price: 184.15,
    market_cap: 6497656478.3,
    source_file: 'mcap19062026.csv',
  }]);
});

test('buildBhavcopyCandidates creates NSE PR zip and mcap file names', () => {
  assert.deepEqual(buildBhavcopyCandidates(new Date('2026-06-20T00:00:00.000Z'), 1), [
    {
      back: 0,
      zipDate: '200626',
      fileDate: '20062026',
      url: 'https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR200626.zip',
      csvName: 'mcap20062026.csv',
    },
    {
      back: 1,
      zipDate: '190626',
      fileDate: '19062026',
      url: 'https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR190626.zip',
      csvName: 'mcap19062026.csv',
    },
  ]);
});
