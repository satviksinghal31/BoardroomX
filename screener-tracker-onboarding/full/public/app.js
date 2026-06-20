// ── Auth guard ──────────────────────────────────────────────────────────────
// Only enforce on production (Railway). Skip on localhost for dev preview.
if (typeof isLoggedIn === 'function' && !isLoggedIn() && location.hostname !== 'localhost') {
  window.location.href = '/auth';
}

// ─────────────────────────────────────────────
//  Q4 FY26 RESULTS STATUS — live sidebar panel
// ─────────────────────────────────────────────
function renderResultsStatusAgent(data) {
  if (!data || !data.length) return '<div class="q4-empty">Loading…</div>';

  // Derive the active results quarter dynamically:
  // It is the most-recently-ended quarter that has at least one company still awaiting/overdue.
  // If no company is awaiting, it is the most recent lastLabel across the portfolio.
  const awaitingAll = data.filter(s => s.quarterStatus?.nextStatus === 'awaiting' || s.quarterStatus?.nextStatus === 'overdue');
  let activeQ = null;
  if (awaitingAll.length) {
    // All awaiting companies should share the same nextLabel (same results season).
    // Pick the most recent one in case of mismatch.
    const freq = {};
    awaitingAll.forEach(s => { const l = s.quarterStatus.nextLabel; freq[l] = (freq[l] || 0) + 1; });
    activeQ = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  } else {
    // All reported — find the most recent lastLabel
    const labels = data.map(s => s.quarterStatus?.lastLabel).filter(Boolean);
    activeQ = labels.sort().at(-1) ?? null;
  }

  if (!activeQ) return '<div class="q4-empty">No quarter data yet.</div>';

  const reported = data.filter(s => s.quarterStatus?.lastLabel === activeQ);
  const awaiting = data.filter(s => s.quarterStatus?.nextLabel === activeQ);

  const fmtCr = v => v == null ? '—' : Math.round(v).toLocaleString('en-IN');
  const yoyCell = (curr, prev) => {
    if (curr == null || prev == null || prev === 0) return '<span class="q4-flat">—</span>';
    const g = +((curr - prev) / Math.abs(prev) * 100).toFixed(1);
    return `<span class="${g >= 0 ? 'up' : 'down'}">${g >= 0 ? '+' : ''}${g}%</span>`;
  };

  let out = '';

  if (reported.length) {
    const rows = reported.map(s => {
      const lq = s.latestQuarter;
      return `<tr>
        <td class="q4-co">${s.name}</td>
        <td class="q4-val">${fmtCr(lq?.revenue)}</td>
        <td class="q4-val">${yoyCell(lq?.revenue, lq?.prevRevenue)}</td>
        <td class="q4-val">${fmtCr(lq?.netProfit)}</td>
        <td class="q4-val">${yoyCell(lq?.netProfit, lq?.prevNetProfit)}</td>
        <td class="q4-val">${lq?.eps != null ? '₹'+lq.eps : '—'}</td>
      </tr>`;
    }).join('');
    out += `<div class="q4-section-title">${activeQ} Results Out (${reported.length})</div>
      <div class="table-scroll">
        <table class="q4-table">
          <thead><tr><th class="q4-co">Company</th><th class="q4-val">Rev</th><th class="q4-val">YoY</th><th class="q4-val">NP</th><th class="q4-val">YoY</th><th class="q4-val">EPS</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  if (awaiting.length) {
    const rows = awaiting.map(s => {
      const qs = s.quarterStatus;
      const dateStr = qs?.nextBoardDate ? fmtDate(qs.nextBoardDate) : 'not announced';
      const badge = `<span class="qs-badge qs-${qs?.nextStatus}">${qs?.nextStatus}</span>`;
      return `<tr>
        <td class="q4-co">${s.name}</td>
        <td class="q4-val q4-date">${dateStr}</td>
        <td class="q4-val">${badge}</td>
      </tr>`;
    }).join('');
    out += `<div class="q4-section-title">Awaiting ${activeQ} (${awaiting.length})</div>
      <div class="table-scroll">
        <table class="q4-table">
          <thead><tr><th class="q4-co">Company</th><th class="q4-val">Board Meeting</th><th class="q4-val">Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  return out || `<div class="q4-empty">No data for ${activeQ}.</div>`;
}

// ─────────────────────────────────────────────
//  AGENT DEFINITION
// ─────────────────────────────────────────────
const AGENTS = [
  {
    id: 'results-status-agent',
    name: 'Results Status',
    tagline: 'Live results season tracker — who reported and who is awaiting board meeting.',
    renderFn: renderResultsStatusAgent,
  },
  {
    id: 'chart-agent',
    name: 'Chart Intelligence Agent',
    tagline: 'yahoo-finance2.chart() → 5Y daily OHLCV → lightweight-charts. EMA, RSI, gap zones on every load.',
    skills: [
      {
        label: 'Data fetch',
        items: [
          'yahooFinance.chart(SYMBOL.NS) — always 5Y fetched for indicator warmup',
          'displayFrom slice for 1Y / 3Y view; full 5Y used for all calculations',
          'yahooFinance.quote() for live price, PE, MCap, 52W high/low',
          'Any NSE symbol via search — not just portfolio stocks',
        ],
      },
      {
        label: 'EMA',
        items: [
          'calcEMA(allCandles, 50/200): k = 2/(period+1), seeded with SMA of first N candles',
          '5Y warmup means EMA 200 is converged before the display window starts',
          'Filtered to displayFrom before setData() — line only renders in visible range',
          'EMA 50 = amber, EMA 200 = blue; lastValueVisible: true on right axis',
        ],
      },
      {
        label: 'RSI',
        items: [
          'calcRSI(allCandles, 14): Wilder\'s smoothing — avgGain/avgLoss rolled across full 5Y',
          'Rendered in a separate synced lightweight-charts instance below price chart',
          'OB 70 / OS 30 dashed reference lines via createPriceLine()',
          'Time scales synced via subscribeVisibleLogicalRangeChange on both charts',
        ],
      },
      {
        label: 'Gap detection',
        items: [
          'Gap up: curr.low > prev.high — entire candle above prev high (no open/close)',
          'Gap down: curr.high < prev.low — entire candle below prev low',
          'Fill check runs on full 5Y: minLow/maxHigh of ALL subsequent candles',
          'Partial fill: if price entered zone but didn\'t fully cross, remaining zone shown',
          'Only gaps whose date ≥ displayFrom are drawn; filled gaps suppressed entirely',
          'Zone rendered as two dashed createPriceLine() calls (top + bottom boundary)',
          'Gap chip click → timeScale().setVisibleRange(±50 days around gap date)',
        ],
      },
      {
        label: 'Volume',
        items: [
          'addHistogramSeries on isolated priceScaleId \'vol\', scaleMargins top: 0.82',
          'Green/red bars by close vs open; scale hidden, occupies bottom 18% of price pane',
        ],
      },
    ],
    canAdd: [
      'MACD (12/26/9 EMA diff)',
      'Bollinger Bands (SMA 20 ± 2σ)',
      'VWAP (requires intraday data)',
      'EMA 9 / 21',
      'Fibonacci retracement (manual anchor or swing-high/low auto)',
      'Auto S/R zones (local min/max clustering)',
    ],
  },
  {
    id: 'qr-agent',
    name: 'Quarterly Results Agent',
    tagline: 'screener.in + Yahoo Finance → 8-quarter financials table + upcoming board meeting date.',
    skills: [
      {
        label: 'Step 1: node fetch.js [SYMBOL]',
        items: [
          'ScreenerScraperPro(url/consolidated/) — /consolidated/ first, fallback to standalone',
          'isConsolidated & isBanking stored; isBanking = "Financing Profit" in screener field keys',
          'quarters.{headers[], data{}} stored in data/SYMBOL.json',
        ],
      },
      {
        label: 'Step 2: python3 fetch_ann.py [SYMBOL]',
        items: [
          'Logs in to screener.in (credentials in fetch_ann.py)',
          'GET /upcoming-results/?q=SLUG — one request per company, exact slug match',
          'Writes nextBoardDateFromUpcoming: "2026-05-28" into data/SYMBOL.json',
          'Clears field if company not found (results already filed or date not yet announced)',
        ],
      },
      {
        label: '8Q table',
        items: [
          'Columns = last 8 quarter headers from screener; latest column highlighted',
          'Non-banking rows: Revenue, Op. Profit, OPM %, Net Profit, EPS',
          'Banking rows: Revenue, Fin. Profit, Fin. Margin %, Net Profit, EPS, Gross NPA %, Net NPA %',
          'Board Meeting row: nextLabel + nextBoardDate (from upcoming-results) + status badge',
          'nextStatus: upcoming (quarter not ended) | awaiting (0–75d after end) | overdue (>75d)',
        ],
      },
    ],
    canAdd: [
      'Reported On date per quarter (screener BSE filing history via login)',
      'Annual FY view alongside quarterly',
      'Peer comparison ranked by metric',
      'OPM contraction / NPA trend alerts',
    ],
  },
];

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let portfolioData        = [];
let selectedSymbol       = null;
let currentYears         = 1;
let currentTf            = '1Y';
let currentChartedSymbol = null; // symbol currently rendered in desktopCharts
let currentChartTab      = 'overview'; // which tab is active in the chart panel
const nonPortfolioFinCache = {}; // symbol → fetched financials for non-watchlist stocks
let activeSheet     = null;
let desktopCharts   = null;
let mobileCharts    = null;
let activeWatchlist = 'wl1';
let mobileSymbol    = null;
let mobileYears     = 1;
let mobileTf        = '1Y';
let showGapsEnabled = false;
let chartDataCache  = {}; // keyed by `${symbol}:${years}`

// ─────────────────────────────────────────────
//  GAP DETECTION
// ─────────────────────────────────────────────
// Runs on the FULL dataset so fill-checking uses all available history.
// Each gap carries the date it was created so callers can filter by display window.
function detectUnfilledGaps(candles, minPct = 0.8) {
  const gaps = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];

    // Gap up: curr.low > prev.high — the entire candle is above the previous candle's high.
    // Zone [prev.high, curr.low] is the price range that was never traded.
    if (curr.low > prev.high) {
      const origPct = ((curr.low - prev.high) / prev.high) * 100;
      if (origPct < minPct) continue;
      const sub    = candles.slice(i + 1);
      const minLow = sub.reduce((m, c) => Math.min(m, c.low), Infinity);
      if (minLow <= prev.high) continue; // fully filled
      const remHigh = Math.min(minLow, curr.low);
      const remLow  = prev.high;
      const pct     = ((remHigh - remLow) / remLow) * 100;
      gaps.push({ type: 'up', date: curr.time, low: +remLow.toFixed(2), high: +remHigh.toFixed(2), pct: pct.toFixed(1), partial: minLow < curr.low });
    }

    // Gap down: curr.high < prev.low — the entire candle is below the previous candle's low.
    // Zone [curr.high, prev.low] is the price range that was never traded.
    if (curr.high < prev.low) {
      const origPct = ((prev.low - curr.high) / prev.low) * 100;
      if (origPct < minPct) continue;
      const sub     = candles.slice(i + 1);
      const maxHigh = sub.reduce((m, c) => Math.max(m, c.high), -Infinity);
      if (maxHigh >= prev.low) continue; // fully filled
      const remLow  = Math.max(maxHigh, curr.high);
      const remHigh = prev.low;
      const pct     = ((remHigh - remLow) / remHigh) * 100;
      gaps.push({ type: 'down', date: curr.time, high: +remHigh.toFixed(2), low: +remLow.toFixed(2), pct: pct.toFixed(1), partial: maxHigh > curr.high });
    }
  }
  return gaps;
}

// Draws dashed zone lines for each gap; returns price-line refs for later removal.
function drawGaps(series, gaps) {
  const lines = [];
  gaps.forEach(gap => {
    const color = gap.type === 'up' ? 'rgba(251,146,60,0.8)' : 'rgba(248,113,113,0.8)';
    const sign  = gap.type === 'up' ? '+' : '−';
    const label = `${sign}${gap.pct}%${gap.partial ? ' ▸' : ''}`;
    lines.push(series.createPriceLine({ price: gap.high, color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true,  title: label }));
    lines.push(series.createPriceLine({ price: gap.low,  color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false, title: '' }));
  });
  return lines;
}

function renderGapLegend(el, allGaps, lastClose, isMobile, displayFrom = null) {
  const gaps = displayFrom ? allGaps.filter(g => g.date >= displayFrom) : allGaps;
  if (!gaps.length || !showGapsEnabled) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  // Most recent gap first
  const sorted = [...gaps].sort((a, b) => b.date.localeCompare(a.date));
  el.innerHTML = sorted.map(g => {
    const sign    = g.type === 'up' ? '+' : '−';
    const arrow   = g.type === 'up' ? '↑' : '↓';
    // Distance from current price to the near edge of the remaining gap zone
    const nearEdge = g.type === 'up' ? g.high : g.low;
    const toFillPct = lastClose ? Math.abs((lastClose - nearEdge) / lastClose * 100).toFixed(1) : null;
    const fillDir   = g.type === 'up' ? '↓' : '↑';
    const fillTag   = toFillPct ? `<span class="gap-fill-pct">${fillDir}${toFillPct}% to fill</span>` : '';
    const partialTag = g.partial ? '<span class="gap-partial">partial</span>' : '';
    return `<span class="gap-tag ${g.type}" data-date="${g.date}" onclick="zoomToGap(this, '${isMobile ? 'mobile' : 'desktop'}')">
      ${arrow} ${sign}${g.pct}% &thinsp;₹${g.low}–₹${g.high}${fillTag}${partialTag}
    </span>`;
  }).join('');
}

function zoomToGap(el, target) {
  const date  = el.dataset.date;
  const chart = target === 'mobile' ? mobileCharts?.price : desktopCharts?.price;
  if (!chart || !date) return;
  const mid  = new Date(date);
  const from = new Date(mid); from.setDate(from.getDate() - 50);
  const to   = new Date(mid); to.setDate(to.getDate() + 50);
  chart.timeScale().setVisibleRange({
    from: from.toISOString().split('T')[0],
    to:   to.toISOString().split('T')[0],
  });
}

function toggleGaps() {
  showGapsEnabled = !showGapsEnabled;
  ['gapToggle', 'mobileGapToggle'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('active', showGapsEnabled);
  });

  // Show/hide lines on existing charts without refetching
  [
    { charts: desktopCharts,  legendEl: document.getElementById('gapLegend'),       isMobile: false },
    { charts: mobileCharts,   legendEl: document.getElementById('mobileGapLegend'), isMobile: true  },
  ].forEach(({ charts, legendEl, isMobile }) => {
    if (!charts) return;
    if (!showGapsEnabled) {
      charts.gapLines?.forEach(l => charts.candleSeries.removePriceLine(l));
      charts.gapLines = [];
      if (legendEl) legendEl.style.display = 'none';
    } else {
      charts.gapLines = drawGaps(charts.candleSeries, charts.gaps);
      if (legendEl) renderGapLegend(legendEl, charts.gaps, charts.lastClose, isMobile);
    }
  });
}

// ─────────────────────────────────────────────
//  INDICATORS
// ─────────────────────────────────────────────
// EMA: seed with SMA of first `period` candles, then apply exponential smoothing
function calcEMA(candles, period) {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  // seed
  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  const result = [{ time: candles[period - 1].time, value: +ema.toFixed(2) }];
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    result.push({ time: candles[i].time, value: +ema.toFixed(2) });
  }
  return result;
}

function calcRSI(candles, period = 14) {
  const result = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = Math.max(0, change), loss = Math.max(0, -change);
    if (i < period)       { avgGain += gain; avgLoss += loss; continue; }
    if (i === period)     { avgGain = (avgGain + gain) / period; avgLoss = (avgLoss + loss) / period; }
    else                  { avgGain = (avgGain * (period-1) + gain) / period; avgLoss = (avgLoss * (period-1) + loss) / period; }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ time: candles[i].time, value: +(100 - 100 / (1 + rs)).toFixed(2) });
  }
  return result;
}

// ─────────────────────────────────────────────
//  CHART FACTORY
// ─────────────────────────────────────────────
function destroyCharts(charts) {
  if (!charts) return;
  try { charts.removeOverlay?.(); } catch {}
  try { charts._ro?.disconnect(); charts.price?.remove(); charts.rsi?.remove(); } catch {}
  closeEarningsPopup();
}

// ─────────────────────────────────────────────
//  EARNINGS POPUP
// ─────────────────────────────────────────────
function closeEarningsPopup() {
  document.getElementById('earningsPopup')?.remove();
}

function showEarningsPopup(marker, anchorEl, container) {
  closeEarningsPopup();
  const popup = document.createElement('div');
  popup.id = 'earningsPopup';
  popup.className = 'earnings-popup';

  const fmtPct = n => n != null ? (n >= 0 ? '+' : '') + n + '%' : null;
  const cls    = n => n == null ? 'ep-flat' : n >= 0 ? 'up' : 'down';
  const fmtCr  = v => v == null ? null : Math.round(v).toLocaleString('en-IN') + ' Cr';

  if (marker.pending) {
    popup.innerHTML = `
      <div class="ep-quarter">⏳ ${marker.quarter}</div>
      <div class="ep-pending">Board meeting<br><b>${fmtDate(marker.time)}</b></div>`;
  } else {
    const revPct = fmtPct(marker.revGrowth);
    const netPct = fmtPct(marker.netGrowth);
    popup.innerHTML = `
      <div class="ep-quarter">${marker.quarter} Results</div>
      <div class="ep-row">
        <span class="ep-label">Revenue</span>
        ${fmtCr(marker.revenue) ? `<span class="ep-val">${fmtCr(marker.revenue)}</span>` : ''}
        ${revPct ? `<span class="ep-chg ${cls(marker.revGrowth)}">${revPct}</span>` : '<span class="ep-flat">—</span>'}
      </div>
      <div class="ep-row">
        <span class="ep-label">Net Profit</span>
        ${fmtCr(marker.netProfit) ? `<span class="ep-val">${fmtCr(marker.netProfit)}</span>` : ''}
        ${netPct ? `<span class="ep-chg ${cls(marker.netGrowth)}">${netPct}</span>` : '<span class="ep-flat">—</span>'}
      </div>`;
  }

  // Position: above the anchor circle, clamped within container
  const rect = anchorEl.getBoundingClientRect();
  const cRect = container.getBoundingClientRect();
  const x = Math.min(Math.max(rect.left - cRect.left - 60, 6), container.offsetWidth - 170);
  const y = Math.max(rect.top  - cRect.top  - 88, 6);
  popup.style.left = x + 'px';
  popup.style.top  = y + 'px';

  container.appendChild(popup);

  // Close if user clicks anywhere else on the chart
  setTimeout(() => {
    const close = e => { if (!popup.contains(e.target)) { closeEarningsPopup(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

// ─────────────────────────────────────────────
//  EARNINGS OVERLAY — CSS circles over chart
// ─────────────────────────────────────────────
function drawEarningsOverlay(priceWrap, priceChart, markers, displayFrom) {
  // Remove old overlay elements
  priceWrap.querySelectorAll('.e-marker').forEach(el => el.remove());

  const visMarkers = markers.filter(m => !displayFrom || m.time >= displayFrom);
  if (!visMarkers.length) return () => {};

  const ts = priceChart.timeScale();

  // Create one circle element per marker
  visMarkers.forEach(m => {
    const el = document.createElement('div');
    el.className = 'e-marker' + (m.pending ? ' e-marker-pending' : m.netGrowth == null ? ' e-marker-neutral' : m.netGrowth >= 0 ? ' e-marker-pos' : ' e-marker-neg');
    el.textContent = 'E';
    el.title = m.quarter;
    el.addEventListener('click', e => { e.stopPropagation(); showEarningsPopup(m, el, priceWrap); });
    priceWrap.appendChild(el);
    el._markerTime = m.time;
  });

  // Position each circle using LightweightCharts time→pixel mapping
  function reposition() {
    priceWrap.querySelectorAll('.e-marker').forEach(el => {
      const x = ts.timeToCoordinate(el._markerTime);
      if (x == null || x < 0 || x > priceWrap.offsetWidth) {
        el.style.display = 'none';
      } else {
        el.style.display = 'flex';
        el.style.left = Math.round(x - 11) + 'px'; // centre 22px circle
      }
    });
  }

  reposition();
  ts.subscribeVisibleLogicalRangeChange(reposition);

  return () => {
    try { ts.unsubscribeVisibleLogicalRangeChange(reposition); } catch {}
    priceWrap.querySelectorAll('.e-marker').forEach(el => el.remove());
  };
}

// allCandles = full 5Y history; displayFrom = YYYY-MM-DD viewport start
// Data is ALWAYS set for all candles — displayFrom only controls the initial visible range.
// This allows the user to scroll left past the initial window into full history.
function buildCharts(priceWrap, rsiWrap, allCandles, displayFrom, isMobile, markers = []) {
  priceWrap.innerHTML = '';
  rsiWrap.innerHTML   = '';

  const bg = '#ffffff', grid = '#f0f0f4', border = '#e4e4e9';
  const priceH = priceWrap.offsetHeight || (isMobile ? 280 : 400);
  const rsiH   = rsiWrap.offsetHeight   || (isMobile ? 80  : 90);

  // ── Price chart ──
  const priceChart = LightweightCharts.createChart(priceWrap, {
    width: priceWrap.offsetWidth, height: priceH,
    layout: { background: { type: 'solid', color: bg }, textColor: '#555560', fontSize: 10 },
    grid:   { vertLines: { color: grid }, horzLines: { color: grid } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: border, scaleMargins: { top: 0.04, bottom: 0.22 } },
    timeScale: { borderColor: border, timeVisible: true, secondsVisible: false },
    handleScroll: true, handleScale: true,
  });

  const candleSeries = priceChart.addCandlestickSeries({
    upColor: '#22c55e', downColor: '#ef4444',
    borderUpColor: '#22c55e', borderDownColor: '#ef4444',
    wickUpColor: '#22c55e', wickDownColor: '#ef4444',
  });
  // Set ALL candles — user can scroll anywhere in 5Y history
  candleSeries.setData(allCandles);

  const lastClose = allCandles.at(-1)?.close ?? null;

  // Detect gaps on full 5Y; lines drawn for all detected gaps (visible on price scale regardless of viewport)
  const allGaps  = detectUnfilledGaps(allCandles);
  const gapLines = showGapsEnabled ? drawGaps(candleSeries, allGaps) : [];

  // Volume — all candles
  const volSeries = priceChart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' } });
  priceChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
  volSeries.setData(allCandles.map(c => ({
    time: c.time, value: c.volume,
    color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
  })));

  // EMA computed on full history; set for full range so it renders wherever user scrolls
  const ema50All  = calcEMA(allCandles, 50);
  const ema200All = calcEMA(allCandles, 200);

  // 50 EMA (amber)
  const ma50 = priceChart.addLineSeries({ color: '#d97706', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  ma50.setData(ema50All);

  // 200 EMA (blue)
  const ma200 = priceChart.addLineSeries({ color: '#0284c7', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  ma200.setData(ema200All);

  // EMA legend — top-left overlay, updates on crosshair move
  const emaLegend = document.createElement('div');
  emaLegend.className = 'ema-legend';
  priceWrap.appendChild(emaLegend);

  const getEmaVal = (data, time) => {
    if (!data.length) return null;
    if (!time) return data.at(-1).value;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].time <= time) return data[i].value;
    }
    return data[0].value;
  };

  const updateEmaLegend = (time) => {
    const v50  = getEmaVal(ema50All,  time);
    const v200 = getEmaVal(ema200All, time);
    emaLegend.innerHTML =
      `<span class="ema-pill ema-50">EMA 50 &nbsp;${v50  != null ? v50.toFixed(2)  : '—'}</span>` +
      `<span class="ema-pill ema-200">EMA 200 &nbsp;${v200 != null ? v200.toFixed(2) : '—'}</span>`;
  };

  updateEmaLegend(null);
  priceChart.subscribeCrosshairMove(p => updateEmaLegend(p.time ?? null));

  // Set initial viewport (not fitContent — we want a specific date range)
  const todayStr = allCandles.at(-1)?.time ?? new Date().toISOString().split('T')[0];
  priceChart.timeScale().setVisibleRange({ from: displayFrom, to: todayStr });

  // Earnings overlay — CSS circles, drawn after setVisibleRange
  const removeOverlay = drawEarningsOverlay(priceWrap, priceChart, markers, displayFrom);

  // ── RSI chart ──
  const rsiChart = LightweightCharts.createChart(rsiWrap, {
    width: rsiWrap.offsetWidth, height: rsiH,
    layout: { background: { type: 'solid', color: bg }, textColor: '#6b7280', fontSize: 9 },
    grid:   { vertLines: { color: 'transparent' }, horzLines: { color: grid } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: border, scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { borderColor: border, visible: false },
    handleScroll: true, handleScale: true,
  });

  const rsiAll = calcRSI(allCandles);
  const rsiSeries = rsiChart.addLineSeries({ color: '#0284c7', lineWidth: 1, priceLineVisible: false, lastValueVisible: true });
  // Full RSI data — user can scroll anywhere
  rsiSeries.setData(rsiAll);
  [70, 30].forEach(lvl => rsiSeries.createPriceLine({
    price: lvl, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true,
    color: lvl === 70 ? 'rgba(239,68,68,.45)' : 'rgba(34,197,94,.45)',
    title: lvl === 70 ? 'OB' : 'OS',
  }));
  rsiChart.timeScale().setVisibleRange({ from: displayFrom, to: todayStr });

  // ── Sync ──
  let syncing = false;
  priceChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (syncing || !r) return; syncing = true; rsiChart.timeScale().setVisibleLogicalRange(r); syncing = false;
  });
  rsiChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (syncing || !r) return; syncing = true; priceChart.timeScale().setVisibleLogicalRange(r); syncing = false;
  });

  // ── Resize ──
  const ro = new ResizeObserver(() => {
    priceChart.applyOptions({ width: priceWrap.offsetWidth, height: priceWrap.offsetHeight || priceH });
    rsiChart.applyOptions({   width: rsiWrap.offsetWidth,   height: rsiWrap.offsetHeight   || rsiH  });
    // Reposition overlay dots after resize
    priceWrap.querySelectorAll('.e-marker').forEach(el => {
      const x = priceChart.timeScale().timeToCoordinate(el._markerTime);
      if (x == null || x < 0 || x > priceWrap.offsetWidth) { el.style.display = 'none'; }
      else { el.style.display = 'flex'; el.style.left = Math.round(x - 11) + 'px'; }
    });
  });
  ro.observe(priceWrap); ro.observe(rsiWrap);

  return { price: priceChart, rsi: rsiChart, _ro: ro, candleSeries, gaps: allGaps, gapLines, lastClose, removeOverlay, todayStr };
}

// ─────────────────────────────────────────────
//  CHART HEADER  (REQ-01: stripped to essentials)
// ─────────────────────────────────────────────
function renderChartHeader(info) {
  const chg    = info.changePercent;
  const chgAbs = info.change;
  const chgCls = chg != null ? (chg >= 0 ? 'up' : 'down') : 'flat';
  const chgStr = (chg != null && chgAbs != null)
    ? `${chgAbs >= 0 ? '+' : ''}${chgAbs.toFixed(2)} (${chg >= 0 ? '+' : ''}${chg}%)`
    : chg != null ? `${chg >= 0 ? '+' : ''}${chg}%` : '—';
  return `
    <div class="chart-hdr-row">
      <div class="chart-hdr-left">
        <div class="chart-hdr-inline">
          <span class="chart-stock-name">${info.symbol}</span>
          <span class="chart-price-val">${fmtPrice(info.price)}</span>
          <span class="chart-price-chg ${chgCls}">${chgStr}</span>
        </div>
        <div class="chart-stock-fullname">${info.name ?? ''}</div>
      </div>
      <button class="chart-alert-btn" title="Add Alert">
        <span class="material-symbols-outlined">notifications</span>Add Alert
      </button>
    </div>`;
}

/**
 * Update the chart panel's top header (stock name + price + change) for `symbol`.
 * Called from every stock-switch + tab-switch path so the header never drifts
 * out of sync with the body content. Guards against late returns by checking
 * selectedSymbol before writing.
 */
async function _updateChartHeader(symbol) {
  const el = document.getElementById('chartHeader');
  if (!el) return;
  if (!symbol) { el.innerHTML = ''; return; }
  try {
    const info = await getQuoteInfo(symbol);
    // Stock may have changed while we were awaiting — drop the stale write.
    if (selectedSymbol !== symbol) return;
    el.innerHTML = renderChartHeader(info);
  } catch {
    // Quote failed — still want a minimal header so the panel isn't blank.
    if (selectedSymbol !== symbol) return;
    el.innerHTML = renderChartHeader({ symbol, name: symbol, price: null, change: null, changePercent: null });
  }
}

// ─────────────────────────────────────────────
//  DESKTOP CHART
// ─────────────────────────────────────────────
// ── Display window helper ─────────────────────────────────────────────────
// Always uses millisecond arithmetic so fractional years (0.008 = ~3d) work.
function computeDisplayFrom(years) {
  return new Date(Date.now() - years * 365.25 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];
}

async function loadDesktopChart(symbol, years) {
  const inner   = document.getElementById('chartPanelInner');
  const empty   = document.getElementById('chartEmpty');
  const loading = document.getElementById('chartLoading');
  const area    = document.getElementById('chartArea');
  const priceW  = document.getElementById('priceWrap');
  const rsiW    = document.getElementById('rsiWrap');
  const legend  = document.getElementById('gapLegend');

  const displayFrom = computeDisplayFrom(years);

  // ── Fast path: same symbol, charts already built → just pan the viewport ──
  if (currentChartedSymbol === symbol && desktopCharts?.price && chartDataCache[symbol]) {
    // Always make sure the chart area is visible (it may have been hidden by tab switch)
    empty.style.display = 'none';
    inner.style.display = 'flex';
    area.style.display  = 'flex';
    // Refresh header — it may have been left stale by a Financials-tab stock switch.
    _updateChartHeader(symbol);
    const todayStr = desktopCharts.todayStr;
    desktopCharts.price.timeScale().setVisibleRange({ from: displayFrom, to: todayStr });
    desktopCharts.rsi.timeScale().setVisibleRange({ from: displayFrom, to: todayStr });
    // Resize charts in case the container size changed while hidden
    requestAnimationFrame(() => {
      const priceW = document.getElementById('priceWrap');
      const rsiW   = document.getElementById('rsiWrap');
      if (priceW) desktopCharts.price.applyOptions({ width: priceW.offsetWidth, height: priceW.offsetHeight || 400 });
      if (rsiW)   desktopCharts.rsi.applyOptions({   width: rsiW.offsetWidth,   height: rsiW.offsetHeight   || 90  });
      renderGapLegend(legend, desktopCharts.gaps, desktopCharts.lastClose, false, displayFrom);
    });
    return;
  }

  // ── Full rebuild path: new symbol or no charts yet ──
  const isCached = !!chartDataCache[symbol];
  empty.style.display   = 'none';
  inner.style.display   = 'flex';
  if (!isCached) {
    loading.style.display = 'flex';
    area.style.display    = 'none';
    legend.style.display  = 'none';
  }

  destroyCharts(desktopCharts); desktopCharts = null;
  currentChartedSymbol = null;

  try {
    let chartData = chartDataCache[symbol];
    if (!chartData) {
      chartData = await bxFetch(`/api/chart/${symbol}?years=5`).then(r => r.json());
      // User picked a different stock OR switched to a non-overview tab while we were
      // fetching — abandon this render to prevent chart bleeding over Financials content.
      if (selectedSymbol !== symbol) return;
      if (currentChartTab !== 'overview') return;
      if (chartData.error) throw new Error(chartData.error);
      chartDataCache[symbol] = chartData;
    }

    // Tab may have changed while the cached lookup happened synchronously above
    if (currentChartTab !== 'overview') return;

    const markers = portfolioData.find(s => s.symbol === symbol)?.earningsMarkers ?? [];

    // Header — uses shared helper; guards against stale write internally.
    _updateChartHeader(symbol);
    loading.style.display = 'none';
    area.style.display    = 'flex';

    requestAnimationFrame(() => {
      // Recheck: user may have switched stocks or tabs in the gap before the RAF fires.
      if (selectedSymbol !== symbol) return;
      if (currentChartTab !== 'overview') { area.style.display = 'none'; return; }
      desktopCharts        = buildCharts(priceW, rsiW, chartData.candles, displayFrom, false, markers);
      currentChartedSymbol = symbol;
      renderGapLegend(legend, desktopCharts.gaps, desktopCharts.lastClose, false, displayFrom);
    });
  } catch (e) {
    if (selectedSymbol !== symbol) return;
    loading.innerHTML = `<span class="chart-load-err">⚠ ${e.message}</span>`;
  }
}

const TF_YEARS = { '1H': 0.008, '1D': 0.019, '1W': 0.077, '1Y': 1, '3Y': 3, '5Y': 5 };

function switchTf(tf) {
  currentTf    = tf;
  currentYears = TF_YEARS[tf] ?? 1;
  document.querySelectorAll('#chartTfRow .tf-btn').forEach(b =>
    b.classList.toggle('active', b.id === 'tf' + tf.toLowerCase())
  );
  if (selectedSymbol) loadDesktopChart(selectedSymbol, currentYears);
}

// Tab placeholder content — stubs for tabs not yet implemented
const TAB_PLACEHOLDERS = {
  holders:  { icon: 'group',       label: 'Shareholders', desc: 'Promoter, FII, DII & retail holdings — coming soon' },
  analysis: { icon: 'query_stats', label: 'Analysis',     desc: 'Technical indicators & pattern analysis — coming soon' },
};

// Tabs with live content (not placeholders)
const LIVE_TABS = new Set(['financials']);

// Tabs where timeframe switcher is hidden
const TF_HIDDEN_TABS = new Set(['financials', 'holders', 'analysis']);

function switchChartTab(tab) {
  currentChartTab = tab;

  // Update active tab button
  document.querySelectorAll('#chartTabBar .chart-tab').forEach(b => {
    const btnTab = b.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    b.classList.toggle('active', btnTab === tab);
  });

  const tfRow      = document.getElementById('chartTfRow');
  const area       = document.getElementById('chartArea');
  const loading    = document.getElementById('chartLoading');
  const legend     = document.getElementById('gapLegend');
  const tabContent = document.getElementById('chartTabContent');
  const ph         = document.getElementById('chartTabPlaceholder');
  const phLbl      = document.getElementById('chartTabPlaceholderLabel');

  // Show/hide timeframe row inline (it lives in the same nav row now)
  if (tfRow) tfRow.style.display = TF_HIDDEN_TABS.has(tab) ? 'none' : 'flex';

  // Always hide content areas first, then selectively show
  if (area)       area.style.display       = 'none';
  if (loading)    loading.style.display    = 'none';
  if (legend)     legend.style.display     = 'none';
  if (tabContent) tabContent.style.display = 'none';
  if (ph)         ph.style.display         = 'none';

  if (tab === 'overview') {
    if (selectedSymbol) loadDesktopChart(selectedSymbol, currentYears);
  } else if (LIVE_TABS.has(tab)) {
    if (tabContent) {
      tabContent.style.display = 'block';
      tabContent.innerHTML = buildFinancialsTab(selectedSymbol);
    }
  } else {
    if (ph) {
      ph.style.display = 'flex';
      const cfg = TAB_PLACEHOLDERS[tab];
      if (phLbl && cfg) {
        phLbl.innerHTML = `
          <span class="material-symbols-outlined" style="font-size:32px;opacity:.25;display:block;margin:0 auto 10px">${cfg.icon}</span>
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">${cfg.label}</div>
          <div style="font-size:12px;font-weight:400;color:var(--muted);max-width:220px;line-height:1.5">${cfg.desc}</div>`;
      }
    }
  }
}

// ─────────────────────────────────────────────
//  FINANCIALS TAB  — 8Q summary + charts + table
// ─────────────────────────────────────────────
async function _fetchNonPortfolioFinancials(symbol) {
  try {
    const resp = await bxFetch(`/api/financials/${symbol}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    nonPortfolioFinCache[symbol] = data;
    // Re-render whichever tab is currently visible for this symbol
    if (selectedSymbol !== symbol) return;
    const tabContent = document.getElementById('chartTabContent');
    if (tabContent && currentChartTab === 'financials') {
      tabContent.innerHTML = buildFinancialsTab(symbol);
    }
  } catch (e) {
    if (selectedSymbol !== symbol) return;
    const tabContent = document.getElementById('chartTabContent');
    if (tabContent && currentChartTab === 'financials') {
      tabContent.innerHTML = _finEmpty(`Could not load financials for ${symbol}: ${e.message}`);
    }
  }
}

function buildFinancialsTab(symbol) {
  if (!symbol) return _finEmpty('Select a stock to view financials.');

  // Check portfolio first, then on-demand cache
  const stock = portfolioData?.find(s => s.symbol === symbol) ?? nonPortfolioFinCache[symbol] ?? null;

  if (!stock) {
    // Not cached yet — kick off background fetch; return spinner placeholder
    _fetchNonPortfolioFinancials(symbol);
    return `<div class="fin-load-wrap">
      <div class="chart-spinner" style="margin:0 auto"></div>
      <div class="fin-load-msg">Fetching quarterly data…</div>
    </div>`;
  }
  if (!stock.quarters8) return _finEmpty(`No quarterly data available for ${symbol} yet.`);

  const { quarters8: q8, latestQuarter: lq, yoyRevGrowth, yoyEarningsGrowth,
          isBanking, quarterStatus: qs, isConsolidated, name } = stock;
  const n = q8.labels.length;

  // Helpers
  const fmtCr      = v => v == null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN') + ' Cr';
  const fmtCrShort = v => v == null ? '' : Math.round(v).toLocaleString('en-IN');
  const growthBadge = v => {
    if (v == null) return '';
    const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    const sign = v > 0 ? '+' : '';
    return `<span class="fin-growth-badge ${cls}">${sign}${v}%</span>`;
  };
  const consNote = isConsolidated === true ? 'Consolidated' : isConsolidated === false ? 'Standalone' : '';

  // ── 1. SUMMARY CARD ────────────────────────────────────────────────────
  const quarterLabel = qs?.lastLabel ?? (lq ? 'Latest Quarter' : 'Results');

  // Build metric chips: Revenue, Op/Fin Profit, Net Profit, EPS
  let metrics = [];
  if (lq) {
    const opLabel = isBanking ? 'Fin. Profit' : 'Op. Profit';
    // Get op profit from latest position in q8
    const latestOpProfit = q8.coreProfit?.[n - 1];
    const prevOpProfit   = q8.coreProfit?.[n - 5] ?? null; // ~1Y ago
    let opYoy = null;
    if (latestOpProfit != null && prevOpProfit != null && prevOpProfit !== 0) {
      opYoy = +((latestOpProfit - prevOpProfit) / Math.abs(prevOpProfit) * 100).toFixed(1);
    }
    const latestMargin = q8.margin?.[n - 1];

    metrics = [
      { label: 'Revenue',   value: fmtCr(lq.revenue),   yoy: yoyRevGrowth,      sub: null },
      { label: opLabel,     value: fmtCr(latestOpProfit), yoy: opYoy,            sub: latestMargin != null ? latestMargin + '% margin' : null },
      { label: 'Net Profit',value: fmtCr(lq.netProfit),  yoy: yoyEarningsGrowth, sub: null },
      { label: 'EPS',       value: lq.eps != null ? '₹' + lq.eps : '—', yoy: null, sub: 'per share' },
    ];
  }

  // Next results status line
  let nextLine = '';
  if (qs) {
    const ns = qs.nextStatus;
    const dateStr = qs.nextBoardDate ? fmtDate(qs.nextBoardDate) : null;
    if (ns === 'awaiting' || ns === 'overdue') {
      nextLine = `<div class="fin-next-line">
        <span class="fin-next-badge ${ns}">⏳ ${ns}</span>
        <span>${qs.nextLabel} results awaited${dateStr ? ' · Board ' + dateStr : ''}</span>
      </div>`;
    } else if (ns === 'upcoming') {
      if (dateStr) {
        const boardTs   = new Date(qs.nextBoardDate + 'T00:00:00').getTime();
        const daysAway  = (boardTs - Date.now()) / 86400000;
        if (daysAway >= -1 && daysAway <= 30) {
          nextLine = `<div class="fin-next-line">
            <span class="fin-next-badge upcoming">Upcoming</span>
            <span>${qs.nextLabel} · Board ${dateStr}</span>
          </div>`;
        } else {
          nextLine = `<div class="fin-next-line"><span class="qs-no-event">No upcoming event in next 30 days</span></div>`;
        }
      } else {
        nextLine = `<div class="fin-next-line"><span class="qs-no-event">No upcoming event in next 30 days</span></div>`;
      }
    }
  }

  const summaryHtml = `
    <div class="fin-summary-card">
      <div class="fin-card-top">
        <div class="fin-card-quarter">${quarterLabel}${consNote ? ' · ' + consNote : ''}</div>
        <div class="fin-card-name">${name ?? symbol}</div>
      </div>
      ${metrics.length ? `
      <div class="fin-metrics-row">
        ${metrics.map(m => `
          <div class="fin-metric">
            <div class="fin-metric-label">${m.label}</div>
            <div class="fin-metric-value">${m.value}</div>
            <div class="fin-metric-sub">
              ${m.yoy != null ? growthBadge(m.yoy) + ' YoY' : (m.sub ? m.sub : '')}
            </div>
          </div>`).join('')}
      </div>` : '<div class="fin-no-data">Latest quarterly data not yet available.</div>'}
      ${nextLine}
    </div>`;

  // ── 2. DUAL BAR CHART — Revenue + Net Profit, 8 quarters ─────────────
  // Use common scale (max of all revenue values) so both bars are comparable
  const revVals = q8.revenue    ?? [];
  const npVals  = q8.netProfit  ?? [];
  const maxScale = Math.max(
    ...revVals.filter(v => v != null && v > 0),
    ...npVals.filter(v => v != null && v > 0),
    1
  );
  // Calculate YoY for each quarter (vs 4 quarters ago)
  const yoyFor = (arr, i) => {
    if (i < 4 || arr[i] == null || arr[i - 4] == null || arr[i - 4] === 0) return null;
    return +((arr[i] - arr[i - 4]) / Math.abs(arr[i - 4]) * 100).toFixed(1);
  };

  const cols = q8.labels.map((lbl, i) => {
    const isLatest = i === n - 1;
    const revH  = revVals[i] != null && revVals[i] > 0 ? Math.max(revVals[i] / maxScale * 100, 3) : 3;
    const npH   = npVals[i]  != null && npVals[i]  > 0 ? Math.max(npVals[i]  / maxScale * 100, 3) : 3;
    const npNeg = npVals[i]  != null && npVals[i]  < 0;
    const revYoy = yoyFor(revVals, i);
    const npYoy  = yoyFor(npVals, i);

    const badgeRow = (revYoy != null || npYoy != null) ? `
      <div class="fin-yoy-badges">
        ${revYoy != null ? `<span class="fin-yoy-badge rev ${revYoy >= 0 ? 'up' : 'down'}">${revYoy >= 0 ? '+' : ''}${revYoy}%</span>` : '<span class="fin-yoy-badge ph"></span>'}
        ${npYoy  != null ? `<span class="fin-yoy-badge np  ${npYoy  >= 0 ? 'up' : 'down'}">${npYoy  >= 0 ? '+' : ''}${npYoy }%</span>` : '<span class="fin-yoy-badge ph"></span>'}
      </div>` : '<div class="fin-yoy-badges ph-row"></div>';

    return `
      <div class="fin-qcol${isLatest ? ' latest' : ''}">
        ${badgeRow}
        <div class="fin-bars-area">
          <div class="fin-bar-col">
            <div class="fin-bar-val">${fmtCrShort(revVals[i])}</div>
            <div class="fin-bar-fill rev${isLatest ? ' latest' : ''}" style="height:${revH}%"></div>
          </div>
          <div class="fin-bar-col">
            <div class="fin-bar-val">${fmtCrShort(npVals[i])}</div>
            <div class="fin-bar-fill np${isLatest ? ' latest' : ''}${npNeg ? ' neg' : ''}" style="height:${npH}%"></div>
          </div>
        </div>
        <div class="fin-qlbl${isLatest ? ' latest' : ''}">${qlabel(lbl)}</div>
      </div>`;
  }).join('');

  const opLabel = isBanking ? 'Fin. Profit' : 'Net Profit';
  const chartsHtml = `
    <div class="fin-chart-section">
      <div class="fin-chart-header">
        <span class="fin-section-title">Revenue & ${opLabel} · 8Q</span>
        <div class="fin-legend">
          <span class="fin-legend-dot rev"></span><span class="fin-legend-lbl">Revenue</span>
          <span class="fin-legend-dot np"></span><span class="fin-legend-lbl">${opLabel}</span>
        </div>
      </div>
      <div class="fin-dual-chart">${cols}</div>
      <div class="fin-chart-note">Bars show YoY % vs same quarter last year</div>
    </div>`;

  // ── 3. FULL 8Q TABLE ────────────────────────────────────────────────────
  const tableHtml = `
    <div class="fin-table-section">
      <div class="fin-section-title">Detailed Results</div>
      ${qra_resultsTable(stock)}
    </div>`;

  return `<div class="fin-tab">${summaryHtml}${chartsHtml}${tableHtml}</div>`;
}

function _finEmpty(msg) {
  return `<div style="padding:40px 24px;text-align:center;color:var(--muted);font-size:14px">${msg}</div>`;
}

// ─────────────────────────────────────────────
//  MOBILE CHART SHEET
// ─────────────────────────────────────────────
async function openChartSheet(e, symbol) {
  e.stopPropagation();
  mobileSymbol = symbol; mobileTf = '1Y'; mobileYears = 1;
  document.querySelectorAll('.chart-tf-row .tf-btn[id^="mtf"]').forEach(b =>
    b.classList.toggle('active', b.id === 'mtf1y')
  );
  openSheet('chartSheet');
  await loadMobileChart(symbol, 1);
}

async function loadMobileChart(symbol, years) {
  const priceW  = document.getElementById('mobilePriceWrap');
  const rsiW    = document.getElementById('mobileRsiWrap');
  const loading = document.getElementById('mobileChartLoading');
  const legend  = document.getElementById('mobileGapLegend');
  const displayFrom = computeDisplayFrom(years);

  // Fast path: same symbol, charts built → just pan viewport
  if (mobileSymbol === symbol && mobileCharts?.price && chartDataCache[symbol]) {
    const todayStr = mobileCharts.todayStr;
    mobileCharts.price.timeScale().setVisibleRange({ from: displayFrom, to: todayStr });
    mobileCharts.rsi.timeScale().setVisibleRange({ from: displayFrom, to: todayStr });
    renderGapLegend(legend, mobileCharts.gaps, mobileCharts.lastClose, true, displayFrom);
    return;
  }

  loading.style.display = 'flex';
  priceW.style.display  = 'none';
  rsiW.style.display    = 'none';
  legend.style.display  = 'none';

  destroyCharts(mobileCharts); mobileCharts = null;

  try {
    let chartData = chartDataCache[symbol];
    if (!chartData) {
      chartData = await bxFetch(`/api/chart/${symbol}?years=5`).then(r => r.json());
      if (chartData.error) throw new Error(chartData.error);
      chartDataCache[symbol] = chartData;
    }

    const info    = await getQuoteInfo(symbol);
    const markers = portfolioData.find(s => s.symbol === symbol)?.earningsMarkers ?? [];

    document.getElementById('mobileChartHeader').innerHTML = renderChartHeader(info);
    loading.style.display = 'none';
    priceW.style.display  = 'block';
    rsiW.style.display    = 'block';

    requestAnimationFrame(() => {
      mobileCharts = buildCharts(priceW, rsiW, chartData.candles, displayFrom, true, markers);
      renderGapLegend(legend, mobileCharts.gaps, mobileCharts.lastClose, true, displayFrom);
    });
  } catch (e) {
    loading.innerHTML = `<span class="chart-load-err">⚠ ${e.message}</span>`;
  }
}

function switchMobileTf(tf) {
  mobileTf    = tf;
  mobileYears = TF_YEARS[tf] ?? 1;
  document.querySelectorAll('.chart-tf-row .tf-btn[id^="mtf"]').forEach(b =>
    b.classList.toggle('active', b.id === 'mtf' + tf.toLowerCase())
  );
  if (mobileSymbol) loadMobileChart(mobileSymbol, mobileYears);
}

// ─────────────────────────────────────────────
//  QUOTE INFO
// ─────────────────────────────────────────────
async function getQuoteInfo(symbol) {
  const p = portfolioData.find(s => s.symbol === symbol);
  if (p) return { symbol, name: p.name, ...p.marketData };
  return bxFetch(`/api/quote/${symbol}`).then(r => r.json());
}

// ─────────────────────────────────────────────
//  NSE STOCK UNIVERSE  (Nifty 500 + popular extras)
//  Loaded dynamically from /api/universe (NSE EQUITY_L.csv + bhavcopy mcap)
//  Format: [symbol, company_name, market_cap]  — fetched once on page load
// ─────────────────────────────────────────────
let NSE_UNIVERSE = [];   // populated by _loadUniverse() below

async function _loadUniverse() {
  try {
    const res  = await bxFetch('/api/universe');
    if (!res.ok) return;
    const data = await res.json();
    // Normalise to [symbol, company_name, ''] tuple so search code is unchanged
    NSE_UNIVERSE = data.map(r => [r.symbol, r.company_name ?? '', '']);
    console.log('[universe] loaded', NSE_UNIVERSE.length, 'stocks');
  } catch (e) {
    console.warn('[universe] load failed:', e.message);
  }
}

// ─────────────────────────────────────────────
//  WATCHLIST MUTATIONS (per-user, talks to /api/watchlist)
// ─────────────────────────────────────────────

/** True iff symbol is currently in the user's portfolio (client-side check). */
function isInWatchlist(symbol) {
  return Array.isArray(portfolioData) && portfolioData.some(s => s.symbol === symbol);
}

// Map of symbols currently being bootstrapped (data scrape in flight server-side).
// Used by renderRow to show a "loading" pill on the row.
const _bootstrappingSymbols = new Set();

/** True iff symbol is currently being bootstrapped (data not yet fetched). */
function isBootstrapping(symbol) {
  return _bootstrappingSymbols.has(symbol);
}

/**
 * Add a symbol to the user's watchlist. NON-BLOCKING:
 *   1. Server returns 200 instantly after inserting the watchlist row,
 *      even if the full scrape is still happening async.
 *   2. Client re-renders watchlist immediately (with a "loading" pill on
 *      the new row if bootstrapping).
 *   3. Client polls /api/portfolio every few seconds until stock.quarters8
 *      appears, then drops the badge.
 */
async function addToWatchlist(symbol, name) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return;
  if (isInWatchlist(sym)) { showToast(`${sym} is already in your watchlist`, 'info'); return; }

  showToast(`Adding ${sym}…`, 'info', 2500);
  try {
    const res = await bxFetch('/api/watchlist', {
      method: 'POST',
      body:   JSON.stringify({ symbol: sym, name: name || sym }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    // Refresh portfolio so the new row renders. If server says bootstrapping,
    // mark the symbol so renderRow shows the loading pill and kick off polling.
    if (json.bootstrapping) {
      _bootstrappingSymbols.add(sym);
      showToast(`${sym} added — fetching data…`, 'info', 4000);
    } else {
      showToast(`${sym} added to watchlist`, 'success');
    }
    await loadPortfolio();
    const listEl = document.getElementById('stockList');
    if (listEl) listEl.innerHTML = renderStockList(portfolioData);
    if (selectedSymbol === sym) renderDetailsPanel(sym);

    if (json.bootstrapping) _pollUntilBootstrapped(sym);
  } catch (err) {
    console.error('[addToWatchlist]', err);
    showToast(err.message || 'Could not add stock', 'error');
  }
}

/**
 * Poll /api/portfolio every few seconds until the symbol's quarters8 appears
 * (i.e. background scrape has finished writing financials + results). Gives
 * up after ~60s.
 */
async function _pollUntilBootstrapped(symbol, attempt = 0) {
  const MAX_ATTEMPTS = 12;
  if (attempt >= MAX_ATTEMPTS) {
    // Give up silently — drop the badge so it doesn't spin forever
    _bootstrappingSymbols.delete(symbol);
    const listEl = document.getElementById('stockList');
    if (listEl) listEl.innerHTML = renderStockList(portfolioData);
    return;
  }
  const delay = attempt === 0 ? 3000 : 5000;
  setTimeout(async () => {
    // Skip if user removed the stock in the meantime
    if (!isInWatchlist(symbol)) { _bootstrappingSymbols.delete(symbol); return; }

    try {
      const res = await bxFetch('/api/portfolio');
      if (!res.ok) { _pollUntilBootstrapped(symbol, attempt + 1); return; }
      const portfolio = await res.json();
      const stock = portfolio.find(s => s.symbol === symbol);
      if (!stock) { _bootstrappingSymbols.delete(symbol); return; }

      portfolioData = portfolio;

      if (stock.quarters8) {
        // Done — drop the badge and re-render
        _bootstrappingSymbols.delete(symbol);
        const listEl = document.getElementById('stockList');
        if (listEl) listEl.innerHTML = renderStockList(portfolioData);
        if (selectedSymbol === symbol) renderDetailsPanel(symbol);
        showToast(`${symbol} ready`, 'success', 2000);
      } else {
        // Still bootstrapping — keep polling
        _pollUntilBootstrapped(symbol, attempt + 1);
      }
    } catch {
      _pollUntilBootstrapped(symbol, attempt + 1);
    }
  }, delay);
}

/** Remove a symbol from the user's watchlist. */
async function removeFromWatchlist(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return;
  if (!confirm(`Remove ${sym} from your watchlist?`)) return;

  try {
    const res = await bxFetch(`/api/watchlist/${encodeURIComponent(sym)}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    showToast(`${sym} removed`, 'success');
    // Locally drop the row, no need to refetch
    portfolioData = portfolioData.filter(s => s.symbol !== sym);
    const listEl = document.getElementById('stockList');
    if (listEl) listEl.innerHTML = renderStockList(portfolioData);
    if (selectedSymbol === sym) {
      selectedSymbol = null;
      // Reset right-side details and chart
      const det = document.getElementById('detContent');
      const detEmpty = document.getElementById('detEmpty');
      if (det) det.style.display = 'none';
      if (detEmpty) detEmpty.style.display = 'flex';
    }
  } catch (err) {
    console.error('[removeFromWatchlist]', err);
    showToast(err.message || 'Could not remove stock', 'error');
  }
}

/** Lightweight toast — auto-dismisses. */
function showToast(message, kind = 'info', durationMs = 2400) {
  let host = document.getElementById('bxToastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'bxToastHost';
    document.body.appendChild(host);
  }
  const toast = document.createElement('div');
  toast.className = `bx-toast bx-toast-${kind}`;
  toast.textContent = message;
  host.appendChild(toast);
  // Force reflow then animate in
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 220);
  }, durationMs);
}

// Expose so inline onclick handlers can call them
window.addToWatchlist      = addToWatchlist;
window.removeFromWatchlist = removeFromWatchlist;
window.showToast           = showToast;

// ─────────────────────────────────────────────
//  SEARCH — state & logic
// ─────────────────────────────────────────────
let _searchDebounceTimer = null;
let _searchHighlightIdx  = -1;
let _searchResults       = [];

/**
 * Called oninput on both desktop and mobile search inputs.
 * Debounced 120ms to avoid excessive DOM mutations on fast typing.
 */
function onSearchInput(raw, context) {
  clearTimeout(_searchDebounceTimer);
  const q = (raw || '').trim();
  if (!q) { _closeSearchDropdown(context); return; }
  _searchDebounceTimer = setTimeout(() => _renderSearchDropdown(q, context), 120);
}

/**
 * Keyboard handler for search inputs.
 */
function onSearchKeydown(e, context) {
  const dropdown = _getDropdownEl(context);
  if (!dropdown || dropdown.style.display === 'none') {
    if (e.key === 'Enter') { _triggerFirstResult(context); }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _searchHighlightIdx = Math.min(_searchHighlightIdx + 1, _searchResults.length - 1);
    _applyHighlight(context);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _searchHighlightIdx = Math.max(_searchHighlightIdx - 1, 0);
    _applyHighlight(context);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (_searchHighlightIdx >= 0 && _searchResults[_searchHighlightIdx]) {
      const r = _searchResults[_searchHighlightIdx];
      selectSearchResult(r[0], r[1], context);
    } else {
      _triggerFirstResult(context);
    }
  } else if (e.key === 'Escape') {
    _closeSearchDropdown(context);
    _blurSearchInput(context);
  }
}

function _triggerFirstResult(context) {
  if (_searchResults.length > 0) {
    selectSearchResult(_searchResults[0][0], _searchResults[0][1], context);
  } else {
    // Fallback: bare symbol typed directly
    const inp = _getInputEl(context);
    const raw = (inp?.value || '').trim().toUpperCase();
    if (raw) selectSearchResult(raw, raw, context);
  }
}

function _getInputEl(context) {
  return context === 'mobile'
    ? document.getElementById('searchInputMobile')
    : document.getElementById('searchInput');
}

function _getDropdownEl(context) {
  return context === 'mobile'
    ? document.getElementById('searchDropdownMobile')
    : document.getElementById('searchDropdown');
}

/** Score + rank matches against the query */
function _scoreMatch(entry, q) {
  const sym  = entry[0].toUpperCase();
  const name = entry[1].toUpperCase();
  const uq   = q.toUpperCase();

  if (sym === uq)              return 100;   // exact symbol
  if (sym.startsWith(uq))     return 80;    // symbol prefix
  if (name.startsWith(uq))    return 60;    // name prefix
  if (sym.includes(uq))       return 40;    // symbol contains
  // multi-word name: every word of query must appear somewhere
  const words = uq.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every(w => name.includes(w))) return 35;
  if (name.includes(uq))      return 30;    // name substring
  return 0;
}

function _renderSearchDropdown(q, context) {
  const dropdown = _getDropdownEl(context);
  if (!dropdown) return;

  const scored = NSE_UNIVERSE
    .map(entry => ({ entry, score: _scoreMatch(entry, q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.entry[0].localeCompare(b.entry[0]));

  _searchResults       = scored.slice(0, 8).map(x => x.entry);
  _searchHighlightIdx  = _searchResults.length > 0 ? 0 : -1;

  if (!_searchResults.length) {
    dropdown.style.display = 'none';
    return;
  }

  dropdown.innerHTML = _searchResults.map((r, i) => {
    const inWl = isInWatchlist(r[0]);
    const btnTitle = inWl ? 'Already in watchlist' : 'Add to watchlist';
    const btnIcon  = inWl ? 'check' : 'add';
    const btnCls   = inWl ? 'srch-add in-wl' : 'srch-add';
    // onmousedown stops the row click from also firing
    const btn = `<button class="${btnCls}" title="${btnTitle}" ${inWl ? 'disabled' : ''}
        onmousedown="event.stopPropagation();event.preventDefault();addToWatchlist('${_esc(r[0])}','${_esc(r[1])}')">
        <span class="material-symbols-outlined">${btnIcon}</span>
      </button>`;
    return `
    <div class="srch-row${i === 0 ? ' srch-highlighted' : ''}"
         onmousedown="selectSearchResult('${r[0]}','${_esc(r[1])}','${context}')"
         onmouseover="this.parentElement.querySelectorAll('.srch-row').forEach((el,j)=>el.classList.toggle('srch-highlighted',j===${i}))||(_searchHighlightIdx=${i})">
      <span class="srch-sym">${_esc(r[0])}</span>
      <span class="srch-name">${_esc(r[1])}</span>
      <span class="srch-sector">${_esc(r[2])}</span>
      ${btn}
    </div>`;
  }).join('');

  dropdown.style.display = 'block';
}

function _applyHighlight(context) {
  const dropdown = _getDropdownEl(context);
  if (!dropdown) return;
  dropdown.querySelectorAll('.srch-row').forEach((el, i) => {
    el.classList.toggle('srch-highlighted', i === _searchHighlightIdx);
    if (i === _searchHighlightIdx) el.scrollIntoView({ block: 'nearest' });
  });
}

function _closeSearchDropdown(context) {
  const dropdown = _getDropdownEl(context);
  if (dropdown) dropdown.style.display = 'none';
  _searchResults      = [];
  _searchHighlightIdx = -1;
}

function _blurSearchInput(context) {
  const inp = _getInputEl(context);
  if (inp) inp.blur();
}

/**
 * Called when user clicks / presses Enter on a search result.
 * 1. Clears input + closes dropdown
 * 2. Deselects any watchlist row
 * 3. Auto-collapses watchlist panel
 * 4. Loads the chart (desktop or mobile)
 */
function selectSearchResult(symbol, name, context) {
  // 1. Clear search input + close dropdown
  const inp = _getInputEl(context);
  if (inp) inp.value = '';
  _closeSearchDropdown(context);

  // 2. Deselect any watchlist row, then re-highlight the searched symbol if present
  document.querySelectorAll('.stock-row.selected').forEach(el => el.classList.remove('selected'));
  selectedSymbol = symbol;
  const wlRow = document.getElementById('card-' + symbol);
  if (wlRow) {
    wlRow.classList.add('selected');
    // Stock is in watchlist — keep sidebar open and scroll row into view
    setTimeout(() => wlRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 80);
  } else {
    // Not in watchlist — collapse sidebar so chart gets full space
    const wlPanel = document.querySelector('.watchlist-panel');
    if (wlPanel && !wlPanel.classList.contains('collapsed')) toggleWatchlist();
  }

  // 3. Update right-side details panel
  renderDetailsPanel(symbol);

  // 4. Switch to Overview tab then load chart
  if (window.innerWidth >= 768) {
    if (currentChartTab !== 'overview') switchChartTab('overview');
    loadDesktopChart(symbol, currentYears);
  } else {
    openChartSheet({ stopPropagation: () => {} }, symbol);
  }
}

// Close dropdown when clicking outside
document.addEventListener('mousedown', function (e) {
  const insideDesktop = e.target.closest('#desktopSearch');
  const insideMobile  = e.target.closest('#mobileSearch');
  if (!insideDesktop) _closeSearchDropdown('desktop');
  if (!insideMobile)  _closeSearchDropdown('mobile');
});

// Legacy wrapper kept so any remaining callers don't break
function searchSymbol() {
  const inp = document.getElementById('searchInput');
  const raw = (inp?.value || '').trim().toUpperCase();
  if (!raw) return;
  selectSearchResult(raw, raw, 'desktop');
}

function searchSymbolMobile() {
  const inp = document.getElementById('searchInputMobile');
  const raw = (inp?.value || '').trim().toUpperCase();
  if (!raw) return;
  selectSearchResult(raw, raw, 'mobile');
}

// ─────────────────────────────────────────────
//  TIMELINE
//  Driven by real earningsMarkers from /api/portfolio — no static mock data.
//  earningsMarkers is already computed per-stock on the server from the
//  Supabase `results` table (reported_at + expected_at + financial data).
//
//  Phase 2: extend with /api/announcements/:symbol to add BSE filings,
//  order wins, regulatory events, etc. on top of earnings.
// ─────────────────────────────────────────────

const TL_CATEGORY = {
  EARNINGS:      { label: 'Earnings',      color: '#2563eb' },
  BOARD_MEETING: { label: 'Board Meeting', color: '#4b41e1' },
  GENERAL:       { label: 'General',       color: '#6d7a77' },
};

// Format a timestamp that may be:
//   • Full ISO  "2026-05-07T12:15:00.000Z" → "7 May, 12:15 PM"
//   • Date-only "2026-05-07"              → "7 May"
function fmtEventTs(isoStr) {
  if (!isoStr) return '';
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(isoStr);
  const d = isDateOnly ? new Date(isoStr + 'T00:00:00') : new Date(isoStr);
  if (isNaN(d)) return isoStr; // fallback: return raw string if unparseable
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = d.getDate();
  const mon = months[d.getMonth()];
  if (isDateOnly) return `${day} ${mon}`;
  const h    = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr   = h % 12 || 12;
  return `${day} ${mon}, ${hr}:${mins} ${ampm}`;
}

// "Mar 2026" → "Mar '26"
function qlabelFull(q) {
  if (!q) return q;
  const [m, y] = q.split(' ');
  return `${m} '${(y || '').slice(2)}`;
}

// Compact ₹ crore formatter for timeline headlines
function fmtCrTl(v) {
  if (v == null) return null;
  return '₹' + Math.round(v).toLocaleString('en-IN') + ' Cr';
}

function buildTimeline(symbol) {
  const stock = portfolioData.find(s => s.symbol === symbol)
                ?? nonPortfolioFinCache[symbol]
                ?? null;

  // Non-portfolio stock — no earnings markers in DB
  if (!stock) {
    return `<div class="det-tl-empty">Earnings timeline available after quarterly data loads.</div>`;
  }

  const markers = stock.earningsMarkers ?? [];

  if (!markers.length) {
    return `<div class="det-tl-empty">No results data yet for ${symbol}.<br>Run <code>node fetch.js ${symbol}</code> to fetch.</div>`;
  }

  // Convert each earningsMarker into a display event
  const events = markers.map(m => {
    if (m.pending) {
      // Upcoming board meeting — expected_at date set by fetch_ann.py
      return {
        category:    'BOARD_MEETING',
        ts:          m.time,
        headline:    `Board meeting — ${qlabelFull(m.quarter)} results to be considered`,
        is_upcoming: true,
      };
    }

    // Reported quarter: build headline from actual financial data
    const rev = fmtCrTl(m.revenue);
    const net = fmtCrTl(m.netProfit);
    const yoy = g => g != null ? ` (${g >= 0 ? '+' : ''}${g}% YoY)` : '';
    const parts = [];
    if (rev) parts.push(`Rev ${rev}${yoy(m.revGrowth)}`);
    if (net) parts.push(`NP ${net}${yoy(m.netGrowth)}`);
    const detail = parts.length ? ' · ' + parts.join(' · ') : '';

    return {
      category:    'EARNINGS',
      ts:          m.time,
      headline:    `${qlabelFull(m.quarter)} results${detail}`,
      is_upcoming: false,
    };
  });

  // Sort: upcoming first (soonest→latest), past most-recent first (newest→oldest)
  events.sort((a, b) => {
    if (a.is_upcoming !== b.is_upcoming) return a.is_upcoming ? -1 : 1;
    return a.is_upcoming
      ? new Date(a.ts) - new Date(b.ts)
      : new Date(b.ts) - new Date(a.ts);
  });

  const items = events.map((ev, i) => {
    const cfg  = TL_CATEGORY[ev.category] ?? TL_CATEGORY.GENERAL;
    const dot  = i === 0 ? 'active' : 'inactive';
    const ts   = fmtEventTs(ev.ts);
    const badge = ev.is_upcoming
      ? `<span class="det-tl-badge">Upcoming</span>`
      : '';
    return `<div class="det-tl-item">
      <div class="det-tl-dot ${dot}"></div>
      <div class="det-tl-meta">
        <span class="det-tl-cat" style="color:${cfg.color}">${cfg.label}${badge}</span>
        <span class="det-tl-time">${ts}</span>
      </div>
      <div class="det-tl-headline">${ev.headline}</div>
    </div>`;
  }).join('');

  return `<div class="det-timeline">${items}</div>`;
}

// ─────────────────────────────────────────────
//  DETAILS PANEL  (column 3, desktop ≥1200px)
// ─────────────────────────────────────────────
function buildDetMinichart(title, values, labels, cls) {
  if (!values || !values.some(v => v != null)) return '';
  const max = Math.max(...values.filter(v => v != null), 1);
  const n = values.length;
  const bars = values.map((v, i) => {
    const h = v != null ? Math.max((v / max) * 100, 3) : 3;
    const opacity = v == null ? .15 : i === n - 1 ? 1 : .55;
    return `<div class="det-minichart-col"><div class="det-minichart-bar ${cls}" style="height:${h}%;opacity:${opacity}"></div></div>`;
  }).join('');
  const lbls = labels.map(l => {
    if (!l) return '<div class="det-minichart-lbl"></div>';
    const [m, y] = l.split(' ');
    const s = ({Mar:'M',Jun:'J',Sep:'S',Dec:'D'}[m] || (m||'')[0] || '') + "'" + (y||'').slice(2);
    return `<div class="det-minichart-lbl">${s}</div>`;
  }).join('');
  return `<div class="det-minichart">
    <div class="det-minichart-title">${title}</div>
    <div class="det-minichart-bars">${bars}</div>
    <div class="det-minichart-lbls">${lbls}</div>
  </div>`;
}

/**
 * Build the dynamic About card from stock.analysis (pros/cons) and stock.CAGRs.
 * Falls back to a minimal card with sector + Screener link when no data.
 */
function _buildAboutCard(stock, symbol, name) {
  const analysis = stock?.analysis || {};
  const pros = Array.isArray(analysis.pros) ? analysis.pros : [];
  const cons = Array.isArray(analysis.cons) ? analysis.cons : [];
  const cagrs = stock?.CAGRs || {};

  const prosHtml = pros.length
    ? `<div class="det-prosncons">
         <div class="det-pnc-title det-pnc-pros">Pros</div>
         <ul class="det-pnc-list">${pros.map(p => `<li>${_esc(p)}</li>`).join('')}</ul>
       </div>`
    : '';
  const consHtml = cons.length
    ? `<div class="det-prosncons">
         <div class="det-pnc-title det-pnc-cons">Cons</div>
         <ul class="det-pnc-list">${cons.map(c => `<li>${_esc(c)}</li>`).join('')}</ul>
       </div>`
    : '';

  // CAGRs table — rows are metrics, columns are time horizons
  let cagrHtml = '';
  const cagrKeys = Object.keys(cagrs);
  if (cagrKeys.length) {
    // Discover all unique horizon labels across metrics
    const horizons = [];
    for (const k of cagrKeys) {
      for (const h of Object.keys(cagrs[k] || {})) {
        if (!horizons.includes(h)) horizons.push(h);
      }
    }
    // Preferred order
    const order = ['TTM', 'Last Year', '1 Year', '3 Years', '5 Years', '10 Years'];
    horizons.sort((a, b) => {
      const ai = order.indexOf(a); const bi = order.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    const head = `<tr><th></th>${horizons.map(h => `<th>${_esc(h)}</th>`).join('')}</tr>`;
    const rows = cagrKeys.map(k => {
      const cells = horizons.map(h => `<td>${_esc(cagrs[k]?.[h] ?? '—')}</td>`).join('');
      return `<tr><td class="det-cagr-row-lbl">${_esc(k)}</td>${cells}</tr>`;
    }).join('');
    cagrHtml = `<div class="det-cagr-wrap">
        <table class="det-cagr-tbl">${head}${rows}</table>
      </div>`;
  }

  // If no real analysis OR cagrs, show a minimal placeholder + link
  const hasContent = prosHtml || consHtml || cagrHtml;
  const body = hasContent
    ? `${prosHtml}${consHtml}${cagrHtml}`
    : `<p class="det-about-text">No company analysis available yet for ${_esc(name)}.</p>`;

  return `<div class="det-card">
    <div class="det-section-title-lg">About</div>
    ${body}
    <button class="det-about-link" onclick="window.open('https://www.screener.in/company/${encodeURIComponent(symbol)}/','_blank')">
      Read full profile on Screener →
    </button>
  </div>`;
}

function _buildDetSkeleton() {
  const rows = [90, 75, 85, 70];
  return `
    <div class="det-card">
      <div class="skel-line" style="width:55%;margin-bottom:18px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
        <div class="skel-block"></div><div class="skel-block"></div>
        <div class="skel-block"></div><div class="skel-block"></div>
      </div>
      <div class="skel-line" style="width:100%;height:5px;border-radius:99px;margin-top:4px"></div>
    </div>
    <div class="det-card">
      <div class="skel-line" style="width:40%;margin-bottom:22px"></div>
      ${rows.map(w => `<div class="skel-line" style="width:${w}%;margin-bottom:11px"></div>`).join('')}
    </div>
    <div class="det-card">
      <div class="skel-line" style="width:30%;margin-bottom:14px"></div>
      <div class="skel-line" style="width:95%;margin-bottom:8px"></div>
      <div class="skel-line" style="width:88%;margin-bottom:8px"></div>
      <div class="skel-line" style="width:72%"></div>
    </div>`;
}

async function renderDetailsPanel(symbol) {
  const detContent = document.getElementById('detContent');
  const detEmpty   = document.getElementById('detEmpty');
  if (!detContent) return;

  let stock = portfolioData.find(s => s.symbol === symbol);

  // If not in watchlist, show skeleton and fetch quote data
  if (!stock) {
    if (detEmpty) detEmpty.style.display = 'none';
    detContent.style.display = 'flex';
    detContent.innerHTML = _buildDetSkeleton();
    try {
      const info = await getQuoteInfo(symbol);
      if (selectedSymbol !== symbol) return; // user navigated away
      stock = {
        symbol,
        name:              info.name ?? symbol,
        marketData: {
          price:         info.price,
          change:        info.change,
          changePercent: info.changePercent,
          mcap:          info.mcap,
          pe:            info.pe,
          forwardPE:     info.forwardPE,
          week52High:    info.week52High,
          week52Low:     info.week52Low,
        },
        quarterStatus:     null,
        latestQuarter:     null,
        quarters8:         null,
        yoyRevGrowth:      null,
        yoyEarningsGrowth: null,
      };
    } catch {
      if (selectedSymbol !== symbol) return;
      detContent.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">Could not load data for ${symbol}</div>`;
      return;
    }
  }

  if (detEmpty) detEmpty.style.display = 'none';
  detContent.style.display = 'flex';

  const { name, marketData: md, quarterStatus: qs, latestQuarter: lq, yoyRevGrowth, yoyEarningsGrowth } = stock;

  // ── Key Statistics 2×2 grid ──────────────────────────────────────
  const keyStats = [];
  if (md?.mcap   != null) keyStats.push({ label: 'Mkt Cap',  value: fmtMcap(md.mcap) });
  if (md?.pe     != null) keyStats.push({ label: 'P/E Ratio',value: String(md.pe) });
  if (lq?.eps    != null) keyStats.push({ label: 'EPS',      value: '₹' + lq.eps });
  if (md?.forwardPE != null) keyStats.push({ label: 'Fwd P/E', value: String(md.forwardPE) + '×' });

  const keyStatsHtml = keyStats.length
    ? `<div class="det-key-stats-grid">${keyStats.map(s =>
        `<div class="det-key-stat">
           <div class="det-key-stat-lbl">${s.label}</div>
           <div class="det-key-stat-val">${s.value}</div>
         </div>`
      ).join('')}</div>`
    : '';

  // ── 52W Range bar ────────────────────────────────────────────────
  let rangeBarHtml = '';
  if (md?.week52High != null && md?.week52Low != null && md?.price != null) {
    const lo  = md.week52Low; const hi = md.week52High; const cur = md.price;
    const pct = Math.min(100, Math.max(0, ((cur - lo) / (hi - lo)) * 100));
    rangeBarHtml = `
      <div class="det-52w">
        <div class="det-52w-header">
          <span class="det-52w-lbl">52W Range</span>
          <span class="det-52w-vals">${fmtPrice(lo)} – ${fmtPrice(hi)}</span>
        </div>
        <div class="det-52w-track">
          <div class="det-52w-fill" style="width:${pct.toFixed(1)}%"></div>
          <div class="det-52w-dot"  style="left:${pct.toFixed(1)}%"></div>
        </div>
      </div>`;
  }

  // ── Quarter status badge ─────────────────────────────────────────
  let qsHtml = '';
  if (qs) {
    const nextDate = qs.nextBoardDate ? ` · ${fmtDate(qs.nextBoardDate)}` : '';
    const statusPart = (qs.nextStatus === 'awaiting' || qs.nextStatus === 'overdue')
      ? `<span style="color:var(--yellow);font-weight:700">⏳ ${qs.nextLabel}${nextDate}</span>`
      : `<span style="color:var(--muted)">Next: ${qs.nextLabel}${nextDate}</span>`;
    qsHtml = `<div style="font-size:12px;padding:6px 0 4px;display:flex;gap:8px;flex-wrap:wrap">
      <span>Last: <b>${qs.lastLabel}</b></span>${statusPart}
    </div>`;
  }

  // ── Latest quarter rows ──────────────────────────────────────────
  let earningsHtml = '';
  if (lq) {
    const fmtCr = v => v == null ? '—' : Math.round(v).toLocaleString('en-IN') + ' Cr';
    earningsHtml = [
      { label: 'Revenue',    value: fmtCr(lq.revenue) },
      { label: 'Net Profit', value: fmtCr(lq.netProfit) },
      { label: 'EPS',        value: lq.eps != null ? '₹' + lq.eps : '—' },
    ].map(r => `<div class="det-lq-row"><span class="det-lq-lbl">${r.label}</span><span class="det-lq-val">${r.value}</span></div>`).join('');
  }

  // ── 8Q mini bar charts — kept in memory, used inside Results card later ──
  let miniChartsHtml = '';
  if (stock.quarters8) {
    const q8  = stock.quarters8;
    const rev = buildDetMinichart('Revenue (Cr)',    q8.revenue,   q8.labels, 'dmc-rev');
    const net = buildDetMinichart('Net Profit (Cr)', q8.netProfit, q8.labels, 'dmc-net');
    if (rev || net) miniChartsHtml = rev + net;
  }

  // ── Timeline — built by buildTimeline() (Phase 2: live API) ──────
  const timelineHtml = `<div class="det-card">
    <div class="det-section-title-lg" style="margin-bottom:20px">Timeline</div>
    ${buildTimeline(symbol)}
  </div>`;

  // ── About — DYNAMIC: pros/cons + CAGRs from /api/portfolio ──────────
  const aboutHtml = _buildAboutCard(stock, symbol, name);

  // ── Assemble: 3 separate glass cards ─────────────────────────────
  detContent.innerHTML = [
    // Card 1: Key Statistics (no stock header — already shown in chart area above)
    `<div class="det-card det-card-stats">
       <div class="det-section-title">Key Statistics</div>
       ${keyStatsHtml}
       ${rangeBarHtml}
     </div>`,
    // Card 2: Latest Results — removed per design (will build in dedicated tab later)
    // Card 3: Timeline
    timelineHtml,
    // Card 4: About
    aboutHtml,
  ].filter(Boolean).join('');
}

// ─────────────────────────────────────────────
//  STOCK SELECTION
// ─────────────────────────────────────────────
async function selectStock(symbol) {
  if (selectedSymbol === symbol) return;
  // Clear previous selection
  document.querySelectorAll('.stock-row.selected').forEach(el => el.classList.remove('selected'));
  selectedSymbol = symbol;
  document.getElementById('card-' + symbol)?.classList.add('selected');
  renderDetailsPanel(symbol);

  if (window.innerWidth >= 768) {
    // Header must always reflect the SELECTED stock regardless of tab — otherwise
    // user sees Stock A's name above Stock B's financials. Fire-and-forget.
    _updateChartHeader(symbol);

    if (currentChartTab === 'financials') {
      // On Financials tab: rebuild content for new stock, don't touch the chart yet.
      // Chart will be loaded when user switches back to Overview.
      const tabContent = document.getElementById('chartTabContent');
      if (tabContent) tabContent.innerHTML = buildFinancialsTab(symbol);
      // Kick off chart data prefetch in background so Overview switch is instant.
      // Guard against stale writes if user picked yet another stock before we returned.
      if (!chartDataCache[symbol]) {
        bxFetch(`/api/chart/${symbol}?years=5`).then(r => r.json()).then(data => {
          if (selectedSymbol !== symbol) return;
          if (data && !data.error) chartDataCache[symbol] = data;
        }).catch(() => {});
      }
    } else {
      loadDesktopChart(symbol, currentYears);
    }
  }
}

// ─────────────────────────────────────────────
//  FRESHNESS
// ─────────────────────────────────────────────
function freshnessInfo(lastFetched) {
  if (!lastFetched) return { cls: 'stale', label: 'No data' };
  const days = (Date.now() - new Date(lastFetched)) / 86400000;
  if (days < 7)  return { cls: 'live',   label: `Updated ${Math.round(days)}d ago` };
  if (days < 30) return { cls: 'recent', label: `Updated ${Math.round(days)}d ago` };
  return { cls: 'stale', label: `Updated ${Math.round(days)}d ago` };
}

// ─────────────────────────────────────────────
//  CARD RENDER
// ─────────────────────────────────────────────
//  QUARTERLY RESULTS AGENT — renderer
//  Controls: card nudge strip, detail sheet results + 8Q charts
// ─────────────────────────────────────────────
function qra_consolidatedTag(stock) {
  if (stock.isConsolidated === null) return '';
  return stock.isConsolidated
    ? '<span class="cons-tag">C</span>'
    : '<span class="cons-tag standalone">S</span>';
}

function qra_nudge(stock) {
  const { symbol, yoyRevGrowth, yoyEarningsGrowth, quarterStatus: qs, lastFetched, isBanking } = stock;
  const fresh   = freshnessInfo(lastFetched);
  const ctaBtns = `<button class="nudge-cta nudge-chart-btn" onclick="openChartSheet(event,'${symbol}')">Chart ↗</button>`;

  if (!qs) {
    return `<span class="nudge-item flat" style="font-size:10px">No results fetched</span>
            <span class="nudge-spacer"></span>${ctaBtns}`;
  }

  const revLabel = isBanking ? 'Rev' : 'Rev';
  const revStr = fmtGrowth(yoyRevGrowth);
  const ernStr = fmtGrowth(yoyEarningsGrowth);
  const consTag = qra_consolidatedTag(stock);

  if (qs.nextStatus === 'awaiting' || qs.nextStatus === 'overdue') {
    const boardDate = fmtDate(qs.nextBoardDate);
    if (boardDate) {
      return `<span class="nudge-item flat awaiting">⏳ ${qs.nextLabel} · est. ${boardDate}</span>
              ${consTag}
              <span class="nudge-spacer"></span>
              <span class="freshness"><span class="dot ${fresh.cls}"></span>${fresh.label}</span>
              ${ctaBtns}`;
    }
    const dateStr = '';
    return `<span class="nudge-q">${qs.lastLabel}</span>
            <span class="nudge-sep">·</span>
            <span class="nudge-item ${growthCls(yoyRevGrowth)}">${revLabel} ${revStr}</span>
            <span class="nudge-sep">·</span>
            <span class="nudge-item ${growthCls(yoyEarningsGrowth)}">Net ${ernStr}</span>
            <span class="nudge-sep">·</span>
            <span class="nudge-item flat awaiting">⏳ ${qs.nextLabel}${dateStr}</span>
            ${consTag}
            <span class="nudge-spacer"></span>
            <span class="freshness"><span class="dot ${fresh.cls}"></span>${fresh.label}</span>
            ${ctaBtns}`;
  }

  const hasRes = revStr || ernStr;
  if (hasRes) {
    const boardDate = fmtDate(qs.nextBoardDate);
    const nextStr = boardDate
      ? `<span class="nudge-sep">·</span><span class="nudge-item flat" style="opacity:.55">Next ${qs.nextLabel} · est. ${boardDate}</span>`
      : '';
    return `<span class="nudge-q">${qs.lastLabel}</span>
            <span class="nudge-sep">·</span>
            <span class="nudge-item ${growthCls(yoyRevGrowth)}">${revLabel} ${revStr}</span>
            <span class="nudge-sep">·</span>
            <span class="nudge-item ${growthCls(yoyEarningsGrowth)}">Net ${ernStr}</span>
            ${nextStr}${consTag}
            <span class="nudge-spacer"></span>
            <span class="freshness"><span class="dot ${fresh.cls}"></span>${fresh.label}</span>
            ${ctaBtns}`;
  }

  return `<span class="nudge-item flat" style="font-size:10px">No results yet</span>
          <span class="nudge-spacer"></span>${ctaBtns}`;
}

function qra_resultsTable(stock) {
  const { quarters8: q8, isBanking, quarterStatus: qs, isConsolidated } = stock;
  if (!q8) return '';

  const n = q8.labels.length;
  const latestIdx = n - 1;

  // fmtCr: numeric → comma-formatted integer (en-IN style)
  const fmtCr  = v => v == null ? '—' : Math.round(v).toLocaleString('en-IN');
  // fmtPct: values may already contain '%' (stored as "34%") — don't double-append
  const fmtPct = v => { if (v == null) return '—'; const s = String(v); return s.endsWith('%') ? s : s + '%'; };
  const fmtEps = v => v != null ? '₹' + v : '—';

  const colCls = i => i === latestIdx ? ' class="col-latest"' : '';
  const headerCells = q8.labels.map((l, i) => `<th${colCls(i)}>${qlabel(l)}</th>`).join('');

  // Growth row helper — computes YoY (lag=4) or QoQ (lag=1) for numeric-only data
  const growthCells = (data, lag) => (data ?? []).map((v, i) => {
    const prev = i >= lag ? data[i - lag] : null;
    let cell = '—';
    if (v != null && prev != null && typeof v === 'number' && typeof prev === 'number' && prev !== 0) {
      const pct = +((v - prev) / Math.abs(prev) * 100).toFixed(1);
      cell = `<span class="${pct >= 0 ? 'tbl-up' : 'tbl-down'}">${pct >= 0 ? '+' : ''}${pct}%</span>`;
    }
    return `<td${colCls(i)} class="growth-cell">${cell}</td>`;
  }).join('');

  // Build metric groups: each group = value row + (optionally) YoY% + QoQ% rows
  const buildGroup = (label, data, fmt, showGrowth = false) => {
    const valueRow = `<tr><td class="row-label">${label}</td>${(data ?? []).map((v, i) => `<td${colCls(i)}>${fmt(v)}</td>`).join('')}</tr>`;
    if (!showGrowth || typeof data?.[0] !== 'number') return valueRow;
    const yoyRow = `<tr class="growth-row"><td class="row-label row-label-sub">↕ YoY %</td>${growthCells(data, 4)}</tr>`;
    const qoqRow = `<tr class="growth-row"><td class="row-label row-label-sub">↔ QoQ %</td>${growthCells(data, 1)}</tr>`;
    return valueRow + yoyRow + qoqRow;
  };

  let metricRows = '';
  if (isBanking) {
    metricRows =
      buildGroup('Revenue (Cr)',     q8.revenue,    fmtCr,  true)  +
      buildGroup('Fin. Profit (Cr)', q8.coreProfit, fmtCr,  true)  +
      buildGroup('Fin. Margin %',    q8.margin,     fmtPct, false) +
      buildGroup('Net Profit (Cr)',  q8.netProfit,  fmtCr,  true)  +
      buildGroup('EPS',              q8.eps,        fmtEps, false) +
      buildGroup('Gross NPA %',      q8.grossNpa,   fmtPct, false) +
      buildGroup('Net NPA %',        q8.netNpa,     fmtPct, false);
  } else {
    metricRows =
      buildGroup('Revenue (Cr)',     q8.revenue,    fmtCr,  true)  +
      buildGroup('Op. Profit (Cr)', q8.coreProfit, fmtCr,  true)  +
      buildGroup('OPM %',           q8.margin,     fmtPct, false) +
      buildGroup('Net Profit (Cr)', q8.netProfit,  fmtCr,  true)  +
      buildGroup('EPS',             q8.eps,        fmtEps, false);
  }

  // Board meeting / upcoming results row
  let upcomingRow = '';
  if (qs) {
    const ns = qs.nextStatus;
    let eventHtml = '';

    if (qs.nextBoardDate) {
      // Check if within 30 days from today
      const boardTs  = new Date(qs.nextBoardDate + 'T00:00:00').getTime();
      const daysAway = (boardTs - Date.now()) / 86400000;
      if (daysAway >= -1 && daysAway <= 30) {
        eventHtml = `<span class="qs-next-label">${qs.nextLabel}</span>
          <span class="qs-sep"> · </span>
          <span class="expected-date">Board ${fmtDate(qs.nextBoardDate)}</span>
          <span class="qs-badge qs-${ns}">${ns}</span>`;
      } else {
        eventHtml = `<span class="qs-no-event">No upcoming event in next 30 days</span>`;
      }
    } else if (ns === 'awaiting' || ns === 'overdue') {
      // Results due but date not yet announced
      eventHtml = `<span class="qs-next-label">${qs.nextLabel}</span>
        <span class="qs-sep"> · </span>
        <span class="expected-date">Date not announced</span>
        <span class="qs-badge qs-${ns}">${ns}</span>`;
    } else {
      // upcoming — quarter not ended yet, nothing to show
      eventHtml = `<span class="qs-no-event">No upcoming event in next 30 days</span>`;
    }

    upcomingRow = `<tr class="expected-row">
      <td class="row-label">Board Meeting</td>
      <td colspan="${n}" class="expected-cell">${eventHtml}</td>
    </tr>`;
  }

  const consLabel = isConsolidated === true ? ' · Consolidated' : isConsolidated === false ? ' · Standalone' : '';
  return `
    <div class="section-title">8-Quarter Results${consLabel}</div>
    <div class="table-scroll">
      <table class="results-table results-table-8q">
        <thead><tr><th class="row-label"></th>${headerCells}</tr></thead>
        <tbody>${metricRows}${upcomingRow}</tbody>
      </table>
    </div>`;
}

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

function qra_quarterStatus(qs) {
  if (!qs) return '';
  const parts = [`<span class="qs-last">Last: <b>${qs.lastLabel}</b></span>`];
  const nextDate = qs.nextBoardDate ? ` · ${fmtDate(qs.nextBoardDate)}` : '';
  if (qs.nextStatus === 'awaiting' || qs.nextStatus === 'overdue') {
    parts.push(`<span class="qs-awaiting">⏳ ${qs.nextLabel}${nextDate}</span>`);
  } else {
    parts.push(`<span class="qs-next">Next: ${qs.nextLabel}${nextDate}</span>`);
  }
  return `<div class="qs-bar">${parts.join('')}</div>`;
}

function qra_charts8(stock) {
  const { quarters8: q8, isBanking } = stock;
  if (!q8) return '';
  const mkBars = (vals, cls) => {
    const max = Math.max(...vals.filter(v => v != null), 1);
    return vals.map(v => `<div class="bar-col"><div class="bar ${cls}" style="height:${v != null ? Math.max(v/max*100,4) : 4}%;opacity:${v!=null?.8:.2}"></div></div>`).join('');
  };
  const lbls = q8.labels.map(l => `<div class="bar-label">${qlabel(l)}</div>`).join('');
  const revTitle  = isBanking ? 'Revenue · 8Q (₹ Cr)' : 'Revenue · 8Q (₹ Cr)';
  const profTitle = isBanking ? 'Financing Profit · 8Q (₹ Cr)' : 'Operating Profit · 8Q (₹ Cr)';
  let html = `
    <div class="chart-section"><div class="section-title">${revTitle}</div><div class="bar-chart">${mkBars(q8.revenue,'revenue')}</div><div class="bar-labels">${lbls}</div></div>
    <div class="chart-section"><div class="section-title">${profTitle}</div><div class="bar-chart">${mkBars(q8.coreProfit,'profit')}</div><div class="bar-labels">${lbls}</div></div>
    <div class="chart-section"><div class="section-title">Net Profit · 8Q (₹ Cr)</div><div class="bar-chart">${mkBars(q8.netProfit,'profit')}</div><div class="bar-labels">${lbls}</div></div>`;
  if (isBanking && q8.grossNpa?.some(v => v != null)) {
    html += `<div class="chart-section"><div class="section-title">Gross NPA % · 8Q</div><div class="bar-chart">${mkBars(q8.grossNpa,'npa')}</div><div class="bar-labels">${lbls}</div></div>`;
  }
  return html;
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  COMPACT ROW VIEW
// ─────────────────────────────────────────────
const AVATAR_PALETTE = [
  '#7c6ff7','#0284c7','#10b981','#f59e0b',
  '#ef4444','#8b5cf6','#f97316','#06b6d4',
  '#ec4899','#22c55e','#6366f1','#14b8a6',
];
function avatarBg(symbol) {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function avatarText(symbol) {
  // Use up to 2 meaningful chars
  return symbol.replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase();
}
function rowStatusCls(qs) {
  if (!qs) return 'none';
  if (qs.nextStatus === 'overdue')  return 'overdue';
  if (qs.nextStatus === 'awaiting') return 'awaiting';
  return 'none';
}

// REQ-05: simplified 3-col row; REQ-06: event flag
function renderRow(stock) {
  const { symbol, name, marketData: md, quarterStatus: qs } = stock;

  const price    = md?.price    != null ? fmtPrice(md.price) : '—';
  const chgPct   = md?.changePercent;
  const isUp     = chgPct != null && chgPct >= 0;
  const deltaCls = chgPct == null ? 'flat' : isUp ? 'up' : 'down';
  const pctStr   = chgPct != null ? (isUp ? '+' : '') + chgPct + '%' : '—';

  // Event flag: amber pill if board meeting is within 14 days
  const daysUntil = qs?.nextBoardDate
    ? Math.ceil((new Date(qs.nextBoardDate + 'T00:00:00') - Date.now()) / 86400000)
    : null;
  const eventFlagHtml = (daysUntil != null && daysUntil >= 0 && daysUntil <= 14)
    ? `<div class="event-flag">📅 ${fmtDate(qs.nextBoardDate)}</div>`
    : '';

  const selCls = selectedSymbol === symbol ? ' selected' : '';
  const statusCls = rowStatusCls(qs);
  // Show a "loading" pill if the row was just added and financials aren't ready yet.
  const bootstrappingPill = isBootstrapping(symbol)
    ? `<span class="row-bootstrap-pill" title="Fetching quarterly data…">
         <span class="row-bootstrap-dot"></span>loading
       </span>`
    : '';
  return `
    <div class="stock-row${selCls} status-${statusCls}" id="card-${symbol}" onclick="onRowClick(event,'${symbol}')">
      <div class="col-stock">
        <div class="row-symbol-row">
          <span class="row-symbol">${symbol}</span>
          ${bootstrappingPill}
          ${eventFlagHtml}
        </div>
        <div class="row-name">${name}</div>
      </div>
      <div class="col-price">
        <div class="row-price">${price}</div>
        <div class="row-delta ${deltaCls}">${pctStr}</div>
      </div>
      <button class="row-remove" title="Remove from watchlist"
              onclick="event.stopPropagation();removeFromWatchlist('${symbol}')">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>`;
}

function onRowClick(e, symbol) {
  if (window.innerWidth >= 768) {
    selectStock(symbol);
  } else {
    openDetailSheet(e, symbol);
  }
}

// ── Watchlist tabs (REQ-07): WL1 | WL2 | Kite ───────────────────────────────
function buildWatchlistTabs() {
  const tabsEl = document.getElementById('sectorTabs');
  if (!tabsEl) return;
  const tabs = [
    { id: 'wl1',  label: 'WL 1'  },
    { id: 'wl2',  label: 'WL 2'  },
    { id: 'kite', label: 'Kite'  },
  ];
  tabsEl.innerHTML = tabs.map(t =>
    `<button class="sector-tab${t.id === activeWatchlist ? ' active' : ''}" onclick="switchWatchlist('${t.id}')">${t.label}</button>`
  ).join('');
}

async function switchWatchlist(id) {
  activeWatchlist = id;
  buildWatchlistTabs();
  const listEl = document.getElementById('stockList');
  if (!listEl) return;

  if (id === 'wl1') {
    listEl.innerHTML = renderStockList(portfolioData);
  } else if (id === 'wl2') {
    listEl.innerHTML = `
      <div style="padding:32px 16px;text-align:center">
        <div style="font-size:26px;margin-bottom:10px">📋</div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:5px">Watchlist 2</div>
        <div style="font-size:12px;font-weight:400;color:var(--muted);line-height:1.5">No stocks added yet.<br>Build your second list here.</div>
      </div>`;
  } else if (id === 'kite') {
    await renderKiteWatchlist(listEl);
  }
}

async function renderKiteWatchlist(listEl) {
  listEl.innerHTML = `<div class="skeleton-card"></div><div class="skeleton-card"></div>`;
  try {
    const res = await bxFetch('/api/kite/holdings');
    if (!res.ok) throw new Error('not_connected');
    const holdings = await res.json();
    if (!Array.isArray(holdings) || !holdings.length) throw new Error('empty');

    listEl.innerHTML = holdings.map(h => {
      const pnl    = h.pnl ?? 0;
      const pnlCls = pnl >= 0 ? 'up' : 'down';
      const pnlStr = (pnl >= 0 ? '+₹' : '-₹') + Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 });
      const dayChg = h.day_change_pct ?? null;
      const dayCls = dayChg == null ? 'flat' : dayChg >= 0 ? 'up' : 'down';
      const dayStr = dayChg != null ? (dayChg >= 0 ? '+' : '') + dayChg + '%' : '—';
      const sym    = h.tradingsymbol ?? '';
      return `
        <div class="stock-row" id="card-${sym}" onclick="onRowClick(event,'${sym}')">
          <div class="col-stock">
            <div class="row-symbol">${sym}</div>
            <div class="row-name">${h.display_name ?? sym} · ${h.quantity ?? 0} qty</div>
          </div>
          <div class="col-price">
            <div class="row-price ${pnlCls}">${pnlStr}</div>
            <div class="row-delta ${dayCls}">${dayStr}</div>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = `
      <div style="padding:32px 16px;text-align:center">
        <div style="font-size:26px;margin-bottom:10px">🔗</div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:5px">Connect Kite</div>
        <div style="font-size:12px;font-weight:400;color:var(--muted);line-height:1.5;margin-bottom:16px">Link your Zerodha account<br>to see live holdings here.</div>
        <a href="/kite-connect" style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:var(--primary);color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700">Connect Kite →</a>
      </div>`;
  }
}

function renderStockList(data) {
  if (!data.length) {
    return `
      <div class="wl-empty">
        <span class="material-symbols-outlined wl-empty-icon">search</span>
        <div class="wl-empty-title">Your watchlist is empty</div>
        <div class="wl-empty-sub">Search for any NSE stock above and tap the + to start tracking.</div>
        <button class="wl-empty-cta" onclick="document.getElementById('searchInput')?.focus();document.getElementById('searchInputMobile')?.focus()">
          <span class="material-symbols-outlined">search</span> Search stocks
        </button>
      </div>`;
  }
  // Flat list — no sector groupings per Stitch design
  return data.map(renderRow).join('');
}

// ─────────────────────────────────────────────
//  SIDEBAR
// ─────────────────────────────────────────────
function openSidebar() {
  document.getElementById('agentList').innerHTML = AGENTS.map(renderAgentCard).join('<div class="sidebar-divider"></div>');
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('visible');
  document.body.style.overflow = 'hidden';
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('visible');
  document.body.style.overflow = '';
}

function renderAgentCard(agent) {
  if (agent.renderFn) {
    return `
      <div class="agent-card agent-live">
        <span class="corner tl"></span><span class="corner tr"></span>
        <span class="corner bl"></span><span class="corner br"></span>
        <div class="agent-name">${agent.name}</div>
        <div class="agent-tagline">${agent.tagline}</div>
        <div class="agent-live-body">${agent.renderFn(portfolioData)}</div>
      </div>`;
  }

  const skillsHtml = agent.skills.map(s => `
    <div class="skill-group">
      <div class="skill-group-label">${s.label}</div>
      <div class="skill-items">${s.items.map(i => `<span class="skill-pill">${i}</span>`).join('')}</div>
    </div>`).join('');

  const addHtml = agent.canAdd.map(i => `<span class="add-pill">+ ${i}</span>`).join('');

  return `
    <div class="agent-card">
      <span class="corner tl"></span><span class="corner tr"></span>
      <span class="corner bl"></span><span class="corner br"></span>
      <span class="agent-arrow">›</span>
      <div class="agent-name">${agent.name}</div>
      <div class="agent-tagline">${agent.tagline}</div>
      <div class="agent-skills">${skillsHtml}</div>
      <div class="agent-add-section">
        <div class="agent-add-label">Can be added</div>
        <div class="agent-add-items">${addHtml}</div>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────
//  DETAIL SHEET
// ─────────────────────────────────────────────
function openDetailSheet(e, symbol) {
  e.stopPropagation();
  const stock = portfolioData.find(s => s.symbol === symbol);
  if (!stock) {
    // Kite-only or searched stock — fall back to chart sheet
    openChartSheet(e, symbol);
    return;
  }
  document.getElementById('detailContent').innerHTML = renderDetailSheet(stock);
  openSheet('detailSheet');
}

function renderDetailSheet(stock) {
  const { name, symbol, marketData: md, CAGRs, analysis } = stock;
  const chips = [
    { label: 'Market Cap', value: fmtMcap(md?.mcap) },
    { label: 'Price',      value: fmtPrice(md?.price) },
    { label: 'Trailing PE',value: md?.pe        ? md.pe        + '×' : '—' },
    { label: 'Forward PE', value: md?.forwardPE ? md.forwardPE + '×' : '—' },
    { label: '52W High',   value: fmtPrice(md?.week52High) },
    { label: '52W Low',    value: fmtPrice(md?.week52Low)  },
  ];

  let cagrHtml = '';
  if (CAGRs) {
    const cards = Object.entries(CAGRs).map(([m, vals]) =>
      `<div class="cagr-chip"><div class="cagr-chip-title">${m}</div>${Object.entries(vals).map(([k,v]) => `<div class="cagr-chip-row"><span>${k}</span><span>${v}</span></div>`).join('')}</div>`
    ).join('');
    cagrHtml = `<div class="section-title">Growth CAGRs</div><div class="cagr-grid">${cards}</div>`;
  }

  let analysisHtml = '';
  if (analysis?.pros?.length || analysis?.cons?.length) {
    const pros = (analysis.pros||[]).map(p => `<div class="analysis-item pro"><span class="analysis-dot">✓</span><span>${p}</span></div>`).join('');
    const cons = (analysis.cons||[]).map(c => `<div class="analysis-item con"><span class="analysis-dot">✕</span><span>${c}</span></div>`).join('');
    analysisHtml = `<div class="section-title">Screener Analysis</div><div>${pros}${cons}</div>`;
  }

  return `
    <div class="sheet-stock-name">${name}</div><div class="sheet-symbol">${symbol} · NSE</div>
    <div class="market-row">${chips.map(c => `<div class="market-chip"><div class="market-chip-label">${c.label}</div><div class="market-chip-value">${c.value}</div></div>`).join('')}</div>
    <div class="divider"></div>
    ${qra_quarterStatus(stock.quarterStatus)}
    ${qra_resultsTable(stock)}
    ${qra_charts8(stock)}
    ${cagrHtml}${analysisHtml}`;
}

// ─────────────────────────────────────────────
//  SHEET HELPERS
// ─────────────────────────────────────────────
function openSheet(id) {
  document.getElementById('overlay').classList.add('visible');
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
  activeSheet = id;
}
function closeSheet() {
  if (activeSheet) document.getElementById(activeSheet).classList.remove('open');
  document.getElementById('overlay').classList.remove('visible');
  document.body.style.overflow = '';
  activeSheet = null;
}

// ─────────────────────────────────────────────
//  FORMAT HELPERS
// ─────────────────────────────────────────────
const fmtPrice  = n => n != null ? '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
const fmtMcap   = n => { if (n==null) return '—'; const cr=n/1e7; return cr>=100000 ? '₹'+(cr/100000).toFixed(1)+'L Cr' : '₹'+Math.round(cr).toLocaleString('en-IN')+' Cr'; };
const fmtGrowth = n => n != null ? (n >= 0 ? '+' : '') + n + '%' : null;
const growthCls = n => n == null ? 'flat' : n >= 0 ? 'up' : 'down';
const qlabel    = q => { if (!q) return ''; const [m,y]=q.split(' '); return ({Mar:'M',Jun:'J',Sep:'S',Dec:'D'}[m]||m[0])+"'"+y.slice(2); };

// ─────────────────────────────────────────────
//  BOOTSTRAP
// ─────────────────────────────────────────────
async function loadPortfolio() {
  try {
    const res = await bxFetch('/api/portfolio');
    if (!res.ok) {
      // Surface the actual backend error instead of generic "server error".
      // Try to parse JSON body for { error }, fall back to status text.
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.clone().json();
        if (body?.error) detail = body.error;
      } catch { /* not JSON */ }
      throw new Error(detail);
    }
    portfolioData = await res.json();
    document.getElementById('stockList').innerHTML = renderStockList(portfolioData);
    buildWatchlistTabs();
    if (window.innerWidth >= 768 && portfolioData.length > 0 && !selectedSymbol)
      selectStock(portfolioData[0].symbol);
  } catch (e) {
    console.error('[loadPortfolio]', e);
    document.getElementById('stockList').innerHTML =
      `<div style="padding:24px;color:#6b7280;font-size:12px;text-align:center">Could not load portfolio.<br><small>${e.message || 'Unknown error'}</small></div>`;
  }
}

async function refreshAll() {
  const btn = document.getElementById('refreshAllBtn');
  if (btn) btn.classList.add('spinning');
  selectedSymbol = null;
  chartDataCache = {}; // clear client-side chart cache so fresh data loads
  destroyCharts(desktopCharts); desktopCharts = null;
  const inner = document.getElementById('chartPanelInner');
  const empty = document.getElementById('chartEmpty');
  if (inner) inner.style.display = 'none';
  if (empty) empty.style.display = 'flex';
  // Reset details panel
  const detEmpty   = document.getElementById('detEmpty');
  const detContent = document.getElementById('detContent');
  if (detEmpty)   detEmpty.style.display   = 'flex';
  if (detContent) detContent.style.display = 'none';
  await loadPortfolio();
  if (btn) btn.classList.remove('spinning');
}

// ── Panel collapse / expand ──────────────────────────────────────────────────
function toggleWatchlist() {
  const panel       = document.querySelector('.watchlist-panel');
  const collapseBtn = document.getElementById('wlCollapseBtn');
  const expandBtn   = document.getElementById('wlExpandBtn');
  if (!panel) return;
  const collapsed = panel.classList.toggle('collapsed');
  if (expandBtn)   expandBtn.classList.toggle('visible', collapsed);
  // When panel is collapsed the collapse button is hidden anyway,
  // but update icon for when it re-opens
  if (collapseBtn) {
    collapseBtn.querySelector('.material-symbols-outlined').textContent =
      collapsed ? 'chevron_right' : 'chevron_left';
  }
}

function toggleDetails() {
  const panel       = document.getElementById('detailsPanel');
  const collapseBtn = document.getElementById('detCollapseBtn');
  const expandBtn   = document.getElementById('detExpandBtn');
  if (!panel) return;
  const collapsed = panel.classList.toggle('collapsed');
  if (expandBtn) expandBtn.classList.toggle('visible', collapsed);
  if (collapseBtn) {
    collapseBtn.querySelector('.material-symbols-outlined').textContent =
      collapsed ? 'chevron_left' : 'chevron_right';
  }
}

loadPortfolio().then(startPriceRefresh);
_loadUniverse();   // async — populates NSE_UNIVERSE for search dropdown

// ─────────────────────────────────────────────
//  LIVE PRICE REFRESH (every 60s)
//  - Updates price/delta cells in the list
//  - Patches today's last candle on the open chart
// ─────────────────────────────────────────────
let priceRefreshTimer = null;

function startPriceRefresh() {
  if (priceRefreshTimer) clearInterval(priceRefreshTimer);
  priceRefreshTimer = setInterval(refreshPrices, 60_000);
}

async function refreshPrices() {
  try {
    const quotes = await bxFetch('/api/prices').then(r => r.json());
    if (!Array.isArray(quotes)) return;

    for (const q of quotes) {
      // Update in-memory portfolioData so chart headers stay fresh
      const stock = portfolioData.find(s => s.symbol === q.symbol);
      if (stock) {
        stock.marketData = {
          ...stock.marketData,
          price:         q.price,
          change:        q.change,
          changePercent: q.changePercent,
        };
      }

      // Surgically update the price/delta cells in the DOM (no re-render)
      const row = document.getElementById('card-' + q.symbol);
      if (row) {
        const priceEl = row.querySelector('.row-price');
        const deltaEl = row.querySelector('.row-delta');
        if (priceEl) priceEl.textContent = q.price != null ? fmtPrice(q.price) : '—';
        if (deltaEl && q.changePercent != null) {
          const up = q.changePercent >= 0;
          deltaEl.textContent  = (up ? '+' : '') + q.changePercent + '%';
          deltaEl.className    = 'row-delta ' + (up ? 'up' : 'down');
        }
      }

      // Patch last candle on any open chart for this symbol
      if (q.candle && q.candle.open != null) {
        if (desktopCharts && selectedSymbol === q.symbol) {
          desktopCharts.candleSeries.update(q.candle);
          desktopCharts.lastClose = q.candle.close;
        }
        if (mobileCharts && mobileSymbol === q.symbol) {
          mobileCharts.candleSeries.update(q.candle);
          mobileCharts.lastClose = q.candle.close;
        }
        // Also patch the cached chart data so next open gets the latest candle
        const cached = chartDataCache[q.symbol];
        if (cached?.candles?.length) {
          const last = cached.candles.at(-1);
          if (last.time === q.candle.time) {
            Object.assign(last, q.candle);
          } else if (q.candle.time > last.time) {
            cached.candles.push(q.candle); // new day started
          }
        }
      }
    }

    // Refresh open chart header price
    if (selectedSymbol) {
      const stock = portfolioData.find(s => s.symbol === selectedSymbol);
      if (stock) document.getElementById('chartHeader').innerHTML = renderChartHeader({ symbol: selectedSymbol, name: stock.name, ...stock.marketData });
    }
    if (mobileSymbol) {
      const stock = portfolioData.find(s => s.symbol === mobileSymbol);
      if (stock) document.getElementById('mobileChartHeader').innerHTML = renderChartHeader({ symbol: mobileSymbol, name: stock.name, ...stock.marketData });
    }
  } catch (e) {
    console.warn('[prices] refresh failed:', e.message);
  }
}
