authGuard();

function initialState() {
  return {
    q: '',
    quarter: '',
    reportedDate: '',
    watchlist: false,
    marketCapBucket: '',
    marketCapMin: '',
    marketCapMax: '',
    sort: 'reported_at',
    order: 'desc',
    page: 1,
    limit: 25,
  };
}

const state = initialState();
const els = {};
let searchTimer;
let activeRequest;
let requestSequence = 0;
let hasRendered = false;
let latestMeta;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function number(value) {
  if (value == null) return 'N/A';
  return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function growth(value) {
  if (value == null) return '<span class="growth na">N/A</span>';
  const direction = value >= 0 ? 'up' : 'down';
  const arrow = value >= 0 ? '↑' : '↓';
  return `<span class="growth ${direction}">${arrow} ${esc(Math.abs(value).toFixed(1))}%</span>`;
}

function quarter(value) {
  if (!value) return 'N/A';
  const [year, month] = value.split('-');
  return `${{ '03': 'Mar', '06': 'Jun', '09': 'Sep', '12': 'Dec' }[month] ?? month} ${year}`;
}

function metricRow(label, values, qoq, yoy, formula) {
  const info = formula ? `
    <span class="ebitda-info">
      <button type="button" data-ebitda-info aria-expanded="false" aria-label="Calculated EBITDA formula">i</button>
      <span class="ebitda-tooltip" role="tooltip">${esc(formula)}</span>
    </span>` : '';
  return `
    <tr>
      <td>${esc(label)}${info}</td>
      <td>${growth(qoq)}</td>
      <td>${growth(yoy)}</td>
      <td>${number(values.current)}</td>
      <td>${number(values.previous)}</td>
      <td>${number(values.priorYear)}</td>
    </tr>`;
}

function renderItem(item) {
  const sourceLink = item.sources.current
    ? `<a class="quarterly-source-link" href="${esc(item.sources.current)}" target="_blank" rel="noopener noreferrer">NSE XBRL ↗</a>`
    : '';
  return `
    <article class="quarterly-card">
      <div class="quarterly-card-head">
        <div class="quarterly-company">
          <strong>${esc(item.companyName || item.symbol)}</strong>
          <span>${esc(item.symbol)} · Reported ${esc(new Date(item.reportedAt).toLocaleString('en-IN'))}</span>
        </div>
        <span class="quarterly-basis">${esc(item.basis)} · ₹ crore</span>
        ${sourceLink}
      </div>
      <div class="quarterly-table-wrap">
        <table class="quarterly-table">
          <thead><tr>
            <th>Metric</th><th>QoQ</th><th>YoY</th>
            <th>${esc(quarter(item.periods.current))}</th>
            <th>${esc(quarter(item.periods.previous))}</th>
            <th>${esc(quarter(item.periods.priorYear))}</th>
          </tr></thead>
          <tbody>
            ${metricRow('Revenue', item.metrics.revenue, item.growth.revenueQoq, item.growth.revenueYoy)}
            ${metricRow('Calculated EBITDA', item.metrics.calculatedEbitda, item.growth.ebitdaQoq, item.growth.ebitdaYoy, item.ebitdaFormula)}
            ${metricRow('Net profit', item.metrics.netProfit, item.growth.profitQoq, item.growth.profitYoy)}
          </tbody>
        </table>
      </div>
    </article>`;
}

function requestParamsFor(filterState) {
  const params = new URLSearchParams({
    q: filterState.q,
    sort: filterState.sort,
    order: filterState.order,
    page: String(filterState.page),
    limit: String(filterState.limit),
  });
  if (filterState.quarter) params.set('quarter', filterState.quarter);
  if (filterState.reportedDate) params.set('reported_date', filterState.reportedDate);
  if (filterState.watchlist) params.set('watchlist', 'true');
  if (filterState.marketCapBucket) params.set('market_cap_bucket', filterState.marketCapBucket);
  if (filterState.marketCapMin !== '') params.set('market_cap_min', String(filterState.marketCapMin));
  if (filterState.marketCapMax !== '') params.set('market_cap_max', String(filterState.marketCapMax));
  return params;
}

function requestParams() {
  return requestParamsFor(state);
}

function stateAfterQuarterChange(current, quarterValue) {
  return { ...current, quarter: quarterValue, reportedDate: '', page: 1 };
}

function stateAfterFilterRemoval(current, key) {
  const next = { ...current, page: 1 };
  if (key === 'q') next.q = '';
  if (key === 'quarter') {
    next.quarter = '';
    next.reportedDate = '';
  }
  if (key === 'reportedDate') next.reportedDate = '';
  if (key === 'watchlist') next.watchlist = false;
  if (key === 'marketCap') {
    next.marketCapBucket = '';
    next.marketCapMin = '';
    next.marketCapMax = '';
  }
  if (key === 'sorting') {
    next.sort = 'reported_at';
    next.order = 'desc';
  }
  return next;
}

function clearedState() {
  return initialState();
}

function filterChanged() {
  state.page = 1;
  syncControls();
  renderChips();
  loadResults();
}

function renderMeta(meta) {
  latestMeta = meta;
  els.heading.textContent = `${meta.activeQuarterLabel} quarterly results`;
  els.quarters.innerHTML = (meta.quarters || []).map((item) => {
    const active = (state.quarter || meta.activeQuarter) === item.periodEnd;
    return `<button type="button" class="quarterly-quarter-tag${active ? ' active' : ''}" data-quarter="${esc(item.periodEnd)}" aria-pressed="${active}">${esc(item.label)} <span>${Number(item.companies).toLocaleString('en-IN')}</span></button>`;
  }).join('');
  els.reportedDates.innerHTML = [
    `<label><input type="radio" name="quarterlyReportedDate" value="" ${state.reportedDate ? '' : 'checked'} /> All reporting dates</label>`,
    ...(meta.reportedDates || [])
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((item) => `<label><input type="radio" name="quarterlyReportedDate" value="${esc(item.date)}" ${state.reportedDate === item.date ? 'checked' : ''} /> ${esc(item.label)} — ${Number(item.companies).toLocaleString('en-IN')} companies</label>`),
  ].join('');
  els.watchlistLabel.textContent = `My watchlist — ${Number(meta.watchlistCompanies || 0).toLocaleString('en-IN')}`;
}

function filterChipsFor(filterState) {
  const chips = [];
  if (filterState.q) chips.push(['q', `Search: ${filterState.q}`]);
  if (filterState.quarter) chips.push(['quarter', `Quarter: ${quarter(filterState.quarter)}`]);
  if (filterState.reportedDate) chips.push(['reportedDate', `Reported: ${filterState.reportedDate}`]);
  if (filterState.watchlist) chips.push(['watchlist', 'My watchlist']);
  if (filterState.marketCapBucket || filterState.marketCapMin !== '' || filterState.marketCapMax !== '') {
    const labels = { under_50: 'Under ₹50 Cr', '50_500': '₹50–<₹500 Cr', '500_5000': '₹500–<₹5,000 Cr', '5000_plus': '₹5,000 Cr and above' };
    const custom = `₹${filterState.marketCapMin || 0}–${filterState.marketCapMax || 'any'} crore`;
    chips.push(['marketCap', labels[filterState.marketCapBucket] || custom]);
  }
  if (filterState.sort !== 'reported_at' || filterState.order !== 'desc') chips.push(['sorting', 'Custom sorting']);
  return chips;
}

function renderChips() {
  const chips = filterChipsFor(state);
  els.chips.innerHTML = chips.map(([key, label]) => `<span class="quarterly-filter-chip">${esc(label)}<button type="button" data-remove-filter="${key}" aria-label="Remove ${esc(label)} filter">×</button></span>`).join('');
  els.clearFilters.hidden = chips.length === 0;
}

function emptyResultsMessage(filterState, meta, pagination) {
  if (filterState.watchlist) {
    if (Number(meta.watchlistCompanies || 0) === 0) {
      return 'Your watchlist is empty. Add companies to see their quarterly results here.';
    }
    return 'No watchlist companies match the selected filters.';
  }
  const hasNarrowerFilter = Boolean(
    filterState.q || filterState.reportedDate || filterState.marketCapBucket
    || filterState.marketCapMin !== '' || filterState.marketCapMax !== '',
  );
  const periodEnd = filterState.quarter || meta.activeQuarter;
  const quarterAvailable = (meta.quarters || []).some(
    (item) => item.periodEnd === periodEnd && Number(item.companies) > 0,
  );
  if (!hasNarrowerFilter && !quarterAvailable && Number(pagination?.total || 0) === 0) {
    return `No results are available for ${meta.activeQuarterLabel}.`;
  }
  return 'No matching quarterly results.';
}

function toggleFilterPanel(panel, toggle) {
  const open = !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
  return open;
}

function shouldClearResultsOnFailure(alreadyRendered) {
  return !alreadyRendered;
}

function clearFilter(key) {
  Object.assign(state, stateAfterFilterRemoval(state, key));
  filterChanged();
}

function clearAllFilters() {
  Object.assign(state, clearedState());
  syncControls();
  renderChips();
  loadResults();
}

function syncControls() {
  els.search.value = state.q;
  els.sort.value = state.sort;
  els.order.value = state.order;
  const watchlistValue = state.watchlist ? 'watchlist' : 'all';
  document.querySelectorAll('[name="quarterlyWatchlist"]').forEach((input) => { input.checked = input.value === watchlistValue; });
  document.querySelectorAll('[name="quarterlyReportedDate"]').forEach((input) => { input.checked = input.value === state.reportedDate; });
  if (latestMeta) {
    const activeQuarter = state.quarter || latestMeta.activeQuarter;
    document.querySelectorAll('[data-quarter]').forEach((button) => {
      const active = button.dataset.quarter === activeQuarter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  const marketValue = state.marketCapBucket || ((state.marketCapMin !== '' || state.marketCapMax !== '') ? 'custom' : 'all');
  document.querySelectorAll('[name="quarterlyMarketCap"]').forEach((input) => { input.checked = input.value === marketValue; });
  els.customMarketCap.hidden = marketValue !== 'custom';
  els.marketCapMin.value = state.marketCapMin;
  els.marketCapMax.value = state.marketCapMax;
}

async function loadResults() {
  if (activeRequest) activeRequest.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const sequence = ++requestSequence;
  const params = requestParams();
  els.error.hidden = true;
  els.busy.hidden = false;
  els.results.setAttribute('aria-busy', 'true');
  if (!hasRendered) els.results.innerHTML = '<div class="quarterly-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>';

  try {
    const response = await bxFetch(`/api/quarterly-results?${params.toString()}`, { signal: controller.signal });
    const payload = await response.json();
    if (sequence !== requestSequence) return;
    if (!response.ok) throw new Error(payload.error || 'Quarterly results could not be loaded');
    els.results.innerHTML = payload.items.length
      ? payload.items.map(renderItem).join('')
      : `<div class="quarterly-empty">${esc(emptyResultsMessage(state, payload.meta, payload.pagination))}</div>`;
    renderMeta(payload.meta);
    renderChips();
    els.count.textContent = `${payload.pagination.total.toLocaleString('en-IN')} companies`;
    els.page.textContent = `Page ${payload.pagination.page} of ${Math.max(payload.pagination.totalPages, 1)}`;
    els.previous.disabled = payload.pagination.page <= 1;
    els.next.disabled = payload.pagination.page >= payload.pagination.totalPages;
    hasRendered = true;
  } catch (error) {
    if (error.name === 'AbortError' || sequence !== requestSequence) return;
    if (shouldClearResultsOnFailure(hasRendered)) els.results.innerHTML = '';
    els.error.innerHTML = `${esc(error.message)} <button type="button" data-retry-results>Retry</button>`;
    els.error.hidden = false;
  } finally {
    if (sequence === requestSequence) {
      els.busy.hidden = true;
      els.results.setAttribute('aria-busy', 'false');
      activeRequest = null;
    }
  }
}

function bindInfoButtons() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ebitda-info]');
    if (!button) return;
    const container = button.closest('.ebitda-info');
    const open = !container.classList.contains('open');
    container.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
  });
}

function init() {
  els.search = document.getElementById('quarterlySearch');
  els.sort = document.getElementById('quarterlySort');
  els.order = document.getElementById('quarterlyOrder');
  els.results = document.getElementById('quarterlyResults');
  els.heading = document.getElementById('quarterlyHeading');
  els.quarters = document.getElementById('quarterlyQuarters');
  els.reportedDates = document.getElementById('quarterlyReportedDates');
  els.watchlistLabel = document.getElementById('quarterlyWatchlistLabel');
  els.filters = document.getElementById('quarterlyFilters');
  els.filterToggle = document.getElementById('quarterlyFilterToggle');
  els.chips = document.getElementById('quarterlyFilterChips');
  els.clearFilters = document.getElementById('quarterlyClearFilters');
  els.busy = document.getElementById('quarterlyBusy');
  els.customMarketCap = document.getElementById('quarterlyCustomMarketCap');
  els.marketCapMin = document.getElementById('quarterlyMarketCapMin');
  els.marketCapMax = document.getElementById('quarterlyMarketCapMax');
  els.marketCapError = document.getElementById('quarterlyMarketCapError');
  els.error = document.getElementById('quarterlyError');
  els.count = document.getElementById('quarterlyCount');
  els.previous = document.getElementById('quarterlyPrevious');
  els.next = document.getElementById('quarterlyNext');
  els.page = document.getElementById('quarterlyPage');
  document.getElementById('quarterlyHeaderActions').innerHTML = renderUserPill();

  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = els.search.value.trim();
      filterChanged();
    }, 250);
  });
  els.sort.addEventListener('change', () => { state.sort = els.sort.value; filterChanged(); });
  els.order.addEventListener('change', () => { state.order = els.order.value; filterChanged(); });
  els.previous.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadResults(); } });
  els.next.addEventListener('click', () => { state.page += 1; loadResults(); });
  els.filterToggle.addEventListener('click', () => {
    toggleFilterPanel(els.filters, els.filterToggle);
  });
  els.clearFilters.addEventListener('click', clearAllFilters);
  document.addEventListener('change', (event) => {
    if (event.target.name === 'quarterlyReportedDate') { state.reportedDate = event.target.value; filterChanged(); }
    if (event.target.name === 'quarterlyWatchlist') { state.watchlist = event.target.value === 'watchlist'; filterChanged(); }
    if (event.target.name === 'quarterlyMarketCap') {
      const value = event.target.value;
      els.customMarketCap.hidden = value !== 'custom';
      if (value !== 'custom') {
        state.marketCapBucket = value === 'all' ? '' : value;
        state.marketCapMin = '';
        state.marketCapMax = '';
        filterChanged();
      }
    }
  });
  document.addEventListener('click', (event) => {
    const quarterButton = event.target.closest('[data-quarter]');
    if (quarterButton) {
      Object.assign(state, stateAfterQuarterChange(state, quarterButton.dataset.quarter));
      filterChanged();
    }
    const removeButton = event.target.closest('[data-remove-filter]');
    if (removeButton) clearFilter(removeButton.dataset.removeFilter);
    if (event.target.closest('[data-retry-results]')) loadResults();
  });
  document.getElementById('quarterlyApplyMarketCap').addEventListener('click', () => {
    const min = els.marketCapMin.value.trim();
    const max = els.marketCapMax.value.trim();
    const minNumber = min === '' ? null : Number(min);
    const maxNumber = max === '' ? null : Number(max);
    const invalid = (minNumber != null && (!Number.isFinite(minNumber) || minNumber < 0))
      || (maxNumber != null && (!Number.isFinite(maxNumber) || maxNumber < 0))
      || (minNumber != null && maxNumber != null && minNumber > maxNumber);
    if (invalid || (minNumber == null && maxNumber == null)) {
      els.marketCapError.textContent = 'Enter non-negative values with minimum no greater than maximum.';
      els.marketCapError.hidden = false;
      return;
    }
    els.marketCapError.hidden = true;
    state.marketCapBucket = '';
    state.marketCapMin = min;
    state.marketCapMax = max;
    filterChanged();
  });
  bindInfoButtons();
  syncControls();
  renderChips();
  loadResults();
}

document.addEventListener('DOMContentLoaded', init);
