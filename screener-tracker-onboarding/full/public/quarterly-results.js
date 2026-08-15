authGuard();

const state = { q: '', sort: 'reported_at', order: 'desc', page: 1, limit: 50 };
const els = {};
let searchTimer;

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

async function loadResults() {
  const params = new URLSearchParams({
    q: state.q,
    sort: state.sort,
    order: state.order,
    page: String(state.page),
    limit: String(state.limit),
  });
  els.error.hidden = true;
  els.results.innerHTML = '<div class="quarterly-empty">Loading quarterly results…</div>';

  try {
    const response = await bxFetch(`/api/quarterly-results?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Quarterly results could not be loaded');
    els.results.innerHTML = payload.items.length
      ? payload.items.map(renderItem).join('')
      : '<div class="quarterly-empty">No matching quarterly results.</div>';
    els.count.textContent = `${payload.pagination.total.toLocaleString('en-IN')} companies`;
    els.page.textContent = `Page ${payload.pagination.page} of ${Math.max(payload.pagination.totalPages, 1)}`;
    els.previous.disabled = payload.pagination.page <= 1;
    els.next.disabled = payload.pagination.page >= payload.pagination.totalPages;
  } catch (error) {
    els.results.innerHTML = '';
    els.error.textContent = error.message;
    els.error.hidden = false;
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
      state.page = 1;
      loadResults();
    }, 250);
  });
  els.sort.addEventListener('change', () => { state.sort = els.sort.value; state.page = 1; loadResults(); });
  els.order.addEventListener('change', () => { state.order = els.order.value; state.page = 1; loadResults(); });
  els.previous.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadResults(); } });
  els.next.addEventListener('click', () => { state.page += 1; loadResults(); });
  bindInfoButtons();
  loadResults();
}

document.addEventListener('DOMContentLoaded', init);
