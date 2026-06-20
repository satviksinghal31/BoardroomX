const token = authGuard();

let allSymbols = [];
let filteredSymbols = [];
let selectedSymbol = null;
let currentFilter = 'all';
let searchTerm = '';
let annualEvents = null;
let liveRefreshTimer = null;

const els = {};

function fmt(value, suffix = '') {
  if (value == null || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${suffix}`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusLabel(status) {
  if (status === 'complete') return 'fetched';
  if (status === 'fetching') return 'fetching';
  if (status === 'retry') return 'retry';
  if (status === 'failed' || status === 'skipped') return 'issue';
  return 'pending';
}

function uiStatus(row) {
  if (row?.has_annual_data || Number(row?.history_years_count ?? 0) > 0) return 'complete';
  return row?.status ?? 'pending';
}

function renderStatusGrid(status = {}) {
  const fetched = status.fetched ?? status.complete ?? 0;
  const items = [
    ['Total', status.total],
    ['Fetched', fetched],
    ['Pending', status.pending],
    ['Retry', status.retry],
    ['Issues', (status.failed ?? 0) + (status.skipped ?? 0)],
    ['FY Missing', status.latest_fy_missing],
  ];
  els.statusGrid.innerHTML = items.map(([label, value]) => `
    <div class="annual-stat">
      <span>${esc(label)}</span>
      <strong>${fmt(value ?? 0)}</strong>
    </div>
  `).join('');
  els.progressText.textContent = `${fmt(fetched)} fetched of ${fmt(status.total ?? allSymbols.length)} NSE stocks`;
}

function applyFilters() {
  const q = searchTerm.trim().toLowerCase();
  filteredSymbols = allSymbols.filter(row => {
    const rawStatus = row.status ?? 'pending';
    const hasAnnualData = row.has_annual_data || Number(row.history_years_count ?? 0) > 0;
    const issue = rawStatus === 'failed' || rawStatus === 'skipped';
    const filterOk =
      currentFilter === 'all' ||
      (currentFilter === 'complete' ? hasAnnualData :
        currentFilter === 'pending' ? !hasAnnualData && rawStatus === 'pending' :
          currentFilter === 'failed' ? issue :
            rawStatus === currentFilter);
    if (!filterOk) return false;
    if (!q) return true;
    return row.symbol.toLowerCase().includes(q) ||
      String(row.company_name ?? '').toLowerCase().includes(q);
  });
}

function renderSymbolList() {
  applyFilters();
  const rows = filteredSymbols.slice(0, 700);
  els.stockList.innerHTML = rows.map(row => `
    <button class="annual-stock-row ${row.symbol === selectedSymbol ? 'active' : ''}" data-symbol="${esc(row.symbol)}">
      <div>
        <div class="annual-stock-symbol">${esc(row.symbol)}</div>
        <div class="annual-stock-name">${esc(row.company_name ?? row.symbol)}</div>
      </div>
      <span class="annual-stock-status ${esc(uiStatus(row))}">${esc(statusLabel(uiStatus(row)))}</span>
    </button>
  `).join('');

  if (filteredSymbols.length > rows.length) {
    els.stockList.insertAdjacentHTML('beforeend', `
      <div class="annual-stock-name" style="padding:10px 12px">Showing first ${rows.length}. Use search to narrow.</div>
    `);
  }
}

async function loadStatus() {
  const res = await bxFetch('/api/annuals/status');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Status load failed');
  renderStatusGrid(json);
}

async function loadSymbols() {
  const res = await bxFetch('/api/annuals/symbols');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Universe load failed');
  allSymbols = json;
  if (!selectedSymbol) {
    selectedSymbol = allSymbols.find(r => uiStatus(r) === 'complete')?.symbol ?? allSymbols[0]?.symbol ?? null;
  }
  renderSymbolList();
}

function ratioMap(rows) {
  return Object.fromEntries((rows ?? []).map(r => [r.fiscal_year, r]));
}

function table(headers, rows) {
  if (!rows.length) return '<tbody><tr><td>No data fetched yet.</td></tr></tbody>';
  return `
    <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  `;
}

function renderFinancialTable(data) {
  const ratiosByYear = ratioMap(data.ratios);
  const annuals = [...(data.fundamentals ?? [])].sort((a, b) => {
    const ao = Number(a.period_order ?? 0);
    const bo = Number(b.period_order ?? 0);
    if (ao !== bo) return ao - bo;
    return String(a.fiscal_year).localeCompare(String(b.fiscal_year));
  });
  if (!annuals.length) {
    els.financialTable.innerHTML = '<tbody><tr><td>No data fetched yet.</td></tr></tbody>';
    els.yearsCount.textContent = '0 years';
    return;
  }

  const metrics = [
    ['Sales', row => fmt(row.sales ?? row.revenue)],
    ['Operating Profit', row => fmt(row.operating_profit)],
    ['OPM %', row => fmt(row.opm_percent, '%')],
    ['Net Profit', row => fmt(row.net_profit)],
    ['EPS in Rs', row => fmt(row.eps)],
    ['ROCE %', row => fmt(ratiosByYear[row.fiscal_year]?.roce_percent, '%')],
    ['ROE %', row => fmt(ratiosByYear[row.fiscal_year]?.roe_percent, '%')],
    ['Debt / Equity', row => fmt(ratiosByYear[row.fiscal_year]?.debt_to_equity)],
  ];

  const headers = ['Metric', ...annuals.map(row => row.fiscal_year)];
  const rows = metrics.map(([label, getter]) => `
    <tr>
      <td>${esc(label)}</td>
      ${annuals.map(row => `<td>${getter(row)}</td>`).join('')}
    </tr>
  `);

  els.financialTable.innerHTML = table(headers, rows);
  els.yearsCount.textContent = `${annuals.length} years`;
}

function renderShareholdingTable(data) {
  const rows = (data.shareholding ?? []).map(row => `
    <tr>
      <td>${esc(row.period)}</td>
      <td>${fmt(row.promoters_percent, '%')}</td>
      <td>${fmt(row.fii_percent, '%')}</td>
      <td>${fmt(row.dii_percent, '%')}</td>
      <td>${fmt(row.public_percent, '%')}</td>
      <td>${fmt(row.pledged_percent, '%')}</td>
      <td>${fmt(row.number_of_shareholders)}</td>
    </tr>
  `);
  els.shareholdingTable.innerHTML = table(
    ['Period', 'Promoters', 'FII', 'DII', 'Public', 'Pledged', 'Shareholders'],
    rows,
  );
  els.shareholdingCount.textContent = `${data.shareholding?.length ?? 0} periods`;
}

function renderRuns(data) {
  const runs = data.runs ?? [];
  els.runCount.textContent = `${runs.length} runs`;
  if (!runs.length) {
    els.runLog.innerHTML = '<div class="annual-run"><strong>No fetch run yet</strong><span>Waiting for worker.</span></div>';
    return;
  }
  els.runLog.innerHTML = runs.map(run => `
    <div class="annual-run">
      <strong>${esc(run.status)} · ${fmt(run.rows_written)} rows</strong>
      <span>${esc(new Date(run.started_at).toLocaleString())}</span>
      <span>${esc(run.message ?? '')}</span>
    </div>
  `).join('');
}

function renderDetails(data) {
  const q = data.queue ?? {};
  const hasAnnualData = (data.fundamentals?.length ?? 0) > 0;
  const displayStatus = hasAnnualData ? 'complete' : q.status;
  els.empty.style.display = 'none';
  els.detail.style.display = 'block';
  els.symbol.textContent = data.symbol;
  els.company.textContent = data.stock?.company_name ?? data.symbol;
  els.statusPill.textContent = statusLabel(displayStatus);
  els.statusPill.className = `annual-status-pill ${displayStatus ?? 'pending'}`;
  els.meta.innerHTML = `
    <div>Latest: <strong>${esc(q.latest_period ?? '—')}</strong></div>
    <div>History: <strong>${fmt(q.history_years_count ?? data.fundamentals?.length ?? 0)} years</strong></div>
    <div>Last fetch: <strong>${q.last_success_at ? esc(new Date(q.last_success_at).toLocaleString()) : '—'}</strong></div>
  `;
  renderFinancialTable(data);
  renderShareholdingTable(data);
  renderRuns(data);
}

async function selectSymbol(symbol) {
  selectedSymbol = symbol;
  renderSymbolList();
  els.empty.style.display = 'flex';
  els.detail.style.display = 'none';
  els.empty.querySelector('p').textContent = `Loading ${symbol}…`;

  const res = await bxFetch(`/api/annuals/${encodeURIComponent(symbol)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Could not load ${symbol}`);
  renderDetails(json);
}

async function refreshAll() {
  els.refreshBtn.classList.add('spinning');
  try {
    await Promise.all([loadStatus(), loadSymbols()]);
    if (selectedSymbol) await selectSymbol(selectedSymbol);
  } catch (err) {
    els.progressText.textContent = err.message;
  } finally {
    els.refreshBtn.classList.remove('spinning');
  }
}

function scheduleLiveRefresh() {
  if (liveRefreshTimer) return;
  liveRefreshTimer = setTimeout(async () => {
    liveRefreshTimer = null;
    try {
      await Promise.all([loadStatus(), loadSymbols()]);
      if (selectedSymbol) await selectSymbol(selectedSymbol);
    } catch {
      // Keep the SSE connection alive even if one refresh fails.
    }
  }, 600);
}

function startAnnualEvents() {
  if (!token || annualEvents || !window.EventSource) return;
  annualEvents = new EventSource(`/api/annuals/events?token=${encodeURIComponent(token)}`);
  annualEvents.addEventListener('annuals', scheduleLiveRefresh);
  annualEvents.onerror = () => {
    annualEvents?.close();
    annualEvents = null;
    setTimeout(startAnnualEvents, 10_000);
  };
}

function bindEvents() {
  els.search.addEventListener('input', (event) => {
    searchTerm = event.target.value;
    renderSymbolList();
  });
  els.filters.addEventListener('click', (event) => {
    const btn = event.target.closest('.annual-filter');
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    els.filters.querySelectorAll('.annual-filter').forEach(b => b.classList.toggle('active', b === btn));
    renderSymbolList();
  });
  els.stockList.addEventListener('click', (event) => {
    const row = event.target.closest('.annual-stock-row');
    if (row?.dataset.symbol) selectSymbol(row.dataset.symbol).catch(err => {
      els.progressText.textContent = err.message;
    });
  });
  els.refreshBtn.addEventListener('click', refreshAll);
}

function initEls() {
  els.headerActions = document.getElementById('annualHeaderActions');
  els.refreshBtn = document.getElementById('annualRefreshBtn');
  els.progressText = document.getElementById('annualProgressText');
  els.search = document.getElementById('annualSearchInput');
  els.filters = document.getElementById('annualFilters');
  els.statusGrid = document.getElementById('annualStatusGrid');
  els.stockList = document.getElementById('annualStockList');
  els.empty = document.getElementById('annualEmpty');
  els.detail = document.getElementById('annualDetail');
  els.symbol = document.getElementById('annualSymbol');
  els.company = document.getElementById('annualCompany');
  els.statusPill = document.getElementById('annualStatusPill');
  els.meta = document.getElementById('annualMeta');
  els.yearsCount = document.getElementById('annualYearsCount');
  els.financialTable = document.getElementById('annualFinancialTable');
  els.shareholdingCount = document.getElementById('annualShareholdingCount');
  els.shareholdingTable = document.getElementById('annualShareholdingTable');
  els.runCount = document.getElementById('annualRunCount');
  els.runLog = document.getElementById('annualRunLog');
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!token) return;
  initEls();
  els.headerActions.insertAdjacentHTML('afterbegin', renderUserPill());
  bindEvents();
  await refreshAll();
  startAnnualEvents();
  setInterval(() => {
    loadStatus().catch(() => {});
    loadSymbols().then(async () => {
      renderSymbolList();
      if (selectedSymbol) await selectSymbol(selectedSymbol);
    }).catch(() => {});
  }, 60_000);
});
