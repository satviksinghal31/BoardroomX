import fs from 'fs';
const html = fs.readFileSync('public/godmode.html', 'utf8');

const headRegex = /([\s\S]*?)<!-- ──────── VIEW 1: NSE TICKS ──────── -->/;
const match = html.match(headRegex);
let newHtml = match[1];

newHtml += `
      <!-- ──────── VIEW 1: NSE TICKS ──────── -->
      <div class="feed-body view-body" data-view="ticks" id="feed-ticks"></div>

      <!-- ──────── VIEW 2: NSE EVENTS (Recent sub-tab default) ──────── -->
      <div class="feed-body view-body" data-view="events" data-sub="recent" id="feed-events-recent" style="display:none"></div>

      <!-- ──────── VIEW 2: NSE EVENTS (Upcoming sub-tab) ──────── -->
      <div class="feed-body view-body" data-view="events" data-sub="upcoming" id="feed-events-upcoming" style="display:none"></div>

      <!-- ──────── VIEW 3: SCREENER ──────── -->
      <div class="feed-body view-body" data-view="screener" id="feed-screener" style="display:none"></div>
    </div>
  </div>

  <div class="legend">
    <h4>Three monitoring dimensions — switch tabs to see each</h4>
    <p><code>📡 NSE Ticks</code> — system heartbeat. Each tick = one cycle of the NSE bulk agent (2-min interval). Tells the admin "the agent IS alive" with aggregate counts. If you see no Tick rows for >5 min → something's broken.</p>
    <p><code>⚡ NSE Events</code> — actual signal. Per-company corporate events (dividends, earnings, AGMs, etc.).</p>
    <p><code>📊 Screener</code> — financial-numbers freshness. Each row = one Screener.in scrape. Shows whether numbers actually changed, were bootstrapped fresh, were unchanged (no-op), or failed (with reason).</p>
  </div>
</div>

<script src="/auth.js"></script>
<script>
  let isPaused = false;
  let activeView = 'ticks';
  let activeSub = 'recent';
  let currentFilter = '';

  const primary = document.querySelectorAll('.feed-tab-primary');
  const subTabs = document.querySelectorAll('.sub-tab');
  const eventsSubRow = document.getElementById('eventsSubRow');
  const feedCount = document.getElementById('feedCount');
  const pauseBtn = document.querySelector('.feed-pause');
  const filterInput = document.querySelector('.filter-input');

  pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
    pauseBtn.style.color = isPaused ? 'var(--warning)' : '';
  });

  filterInput.addEventListener('input', (e) => {
    currentFilter = e.target.value.trim().toUpperCase();
    loadFeed();
  });

  function show(view, sub) {
    activeView = view;
    activeSub = sub;
    document.querySelectorAll('.view-body').forEach(b => {
      const v = b.dataset.view;
      const s = b.dataset.sub;
      const match = v === view && (!s || s === sub);
      b.style.display = match ? 'block' : 'none';
    });
    eventsSubRow.style.display = (view === 'events') ? 'flex' : 'none';
    loadFeed();
  }

  primary.forEach(btn => btn.addEventListener('click', () => {
    primary.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    show(btn.dataset.tab, document.querySelector('.sub-tab.active')?.dataset.sub || 'recent');
  }));

  subTabs.forEach(btn => btn.addEventListener('click', () => {
    subTabs.forEach(b => b.classList.remove('active', 'recent'));
    btn.classList.add('active');
    if (btn.dataset.sub === 'recent') btn.classList.add('recent');
    show('events', btn.dataset.sub);
  }));

  // Render entries
  function formatTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour12: false });
  }
  function formatDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function timeAgo(ts) {
    if (!ts) return "";
    const seconds = Math.floor((new Date() - new Date(ts)) / 1000);
    if (seconds < 60) return "just now";
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return mins + "m ago";
    return Math.floor(mins / 60) + "h ago";
  }

  function renderFeed(items) {
    const targetId = activeView === 'events' ? 'feed-events-' + activeSub : 'feed-' + activeView;
    const container = document.getElementById(targetId);
    container.innerHTML = '';
    feedCount.textContent = items.length + " entries";
    
    items.forEach(item => {
      let html = '';
      if (activeView === 'ticks') {
        html = \`
          <div class="feed-entry tick-summary">
            <div class="fe-fetched">
              <span class="fe-fetched-time">\${formatTime(item.ts)}</span>
              <span class="fe-fetched-rel">\${timeAgo(item.ts)}</span>
            </div>
            <div class="fe-edate"><span class="fe-edate-main" style="color:var(--faint)">—</span></div>
            <div class="fe-src TICK">TICK</div>
            <div class="fe-sym empty"></div>
            <div>
              <div class="fe-msg">\${item.message || ''} <span class="fe-type SUMMARY">SUMMARY</span></div>
              <div class="tick-stats">
                 <span class="tick-stat-noop">\${JSON.stringify(item.raw)}</span>
              </div>
            </div>
          </div>\`;
      } else if (activeView === 'screener') {
        let typeCls = 'SCRAPED', typeTxt = 'SCRAPED', actCls = 'noop', actTxt = '✓ NOOP';
        if (item.type === 'ERROR') { typeCls = 'ERROR'; actCls = 'err'; actTxt = '✗ FAILED'; typeTxt = 'ERROR'; }
        else if (item.type === 'NOOP') { actCls = 'noop'; actTxt = '✓ NOOP'; }
        else {
          actCls = item.raw?.reason === 'S1_BOOTSTRAP' ? 'add' : 'upd';
          actTxt = item.raw?.reason === 'S1_BOOTSTRAP' ? '✚ NEW' : '✎ UPDATED';
        }
        
        html = \`
          <div class="feed-entry">
            <div class="fe-fetched">
              <span class="fe-fetched-time">\${formatTime(item.ts)}</span>
              <span class="fe-fetched-rel">\${timeAgo(item.ts)}</span>
            </div>
            <div class="fe-edate"><span class="fe-edate-main" style="color:var(--faint)">—</span></div>
            <div class="fe-src SCREENER">SCREENER</div>
            <div class="fe-sym">\${item.symbol || '—'}</div>
            <div>
              <div class="fe-msg">
                <span class="fe-action \${actCls}">\${actTxt}</span> \${item.message || ''} <span class="fe-type \${typeCls}">\${typeTxt}</span>
              </div>
              <div class="fe-raw">\${JSON.stringify(item.raw)}</div>
            </div>
          </div>\`;
      } else {
        const isUpcoming = activeSub === 'upcoming';
        const pendingChip = (!isUpcoming && item.reported_at === null && new Date(item.expected_at) < new Date()) ? '<span class="pending-chip">⏳ OUTCOME PENDING</span>' : '';
        const actionHtml = item.created_at === item.updated_at ? '<span class="fe-action add">✚ ADDED</span>' : '<span class="fe-action upd">✎ UPDATED</span>';

        html = \`
          <div class="feed-entry">
            <div class="fe-fetched">
              <span class="fe-fetched-time">\${formatTime(item.updated_at)}</span>
              <span class="fe-fetched-rel">\${timeAgo(item.updated_at)}</span>
            </div>
            <div class="fe-edate">
              <span class="fe-edate-main">\${formatDate(isUpcoming ? item.expected_at : item.reported_at || item.expected_at)}</span>
              <span class="fe-edate-rel \${isUpcoming ? 'future' : ''}">\${isUpcoming ? '→ SCHED' : ''}</span>
            </div>
            <div class="fe-src NSE">NSE</div>
            <div class="fe-sym">\${item.symbol}</div>
            <div>
              <div class="fe-msg">\${actionHtml} \${item.purpose || ''} \${pendingChip} <span class="fe-type \${item.category}">\${item.category}</span></div>
              <div class="fe-raw">reported_at=\${item.reported_at || 'null'} · expected_at=\${item.expected_at || 'null'}</div>
            </div>
          </div>\`;
      }
      container.insertAdjacentHTML('beforeend', html);
    });
  }

  async function loadFeed() {
    if (isPaused) return;
    let url = \`/api/godmode/feed?tab=\${activeView}\`;
    if (activeView === 'events') url += \`&view=\${activeSub}\`;
    if (currentFilter) url += \`&symbol=\${currentFilter}\`;
    try {
      const res = await window.bxFetch(url);
      if (res.ok) {
        const json = await res.json();
        renderFeed(json.data || []);
      }
    } catch(e) {
      console.error(e);
    }
  }

  async function loadStats() {
    if (isPaused) return;
    try {
      const res = await window.bxFetch('/api/godmode/stats');
      if (res.ok) {
        const d = await res.json();
        document.querySelector('.stat-row').innerHTML = \`
          <div class="stat-card">
            <div class="stat-val">\${d.totalStocks || 0}</div>
            <div class="stat-lbl">Total Stocks</div>
            <div class="stat-sub">NSE catalog</div>
          </div>
          <div class="stat-card">
            <div class="stat-val">\${d.scrapedStocks || 0}</div>
            <div class="stat-lbl">Scraped</div>
            <div class="stat-sub">Catalog parsed</div>
          </div>
          <div class="stat-card">
            <div class="stat-val">\${d.totalRows || 0}</div>
            <div class="stat-lbl">Ann. Rows</div>
            <div class="stat-sub">Events logged</div>
          </div>
          <div class="stat-card">
            <div class="stat-val">\${d.earningsToday || 0}</div>
            <div class="stat-lbl">Earnings Today</div>
          </div>
          <div class="stat-card stat-health ok">
            <div class="stat-val">\${d.updated1h || 0}</div>
            <div class="stat-lbl">Updated Last 1h</div>
          </div>\`;
          
        renderAgents(d.agent_state || []);
      }
    } catch(e) {
      console.error(e);
    }
  }

  function renderAgents(states) {
    const nse = states.find(s => s.agent === 'NSE_BULK') || {};
    const scr = states.find(s => s.agent === 'SCREENER') || {};
    
    const row = document.querySelector('.agent-row');
    if (!row) return;
    row.innerHTML = \`
      <div class="agent-card screener">
        <div class="agent-head">
          <div class="agent-name"><span class="ico">📊</span> SCREENER AGENT</div>
          <div class="agent-status \${scr.status==='running'?'busy':'healthy'}">\${scr.status || 'idle'}</div>
        </div>
        <div class="agent-grid">
          <div class="agent-field"><div class="agent-field-k">Last run</div><div class="agent-field-v">\${timeAgo(scr.last_successful_run) || 'never'}</div></div>
          <div class="agent-field"><div class="agent-field-k">Failures</div><div class="agent-field-v">\${scr.consecutive_failures || 0}</div></div>
        </div>
        <div class="agent-summary">\${JSON.stringify(scr.last_summary || {})}</div>
      </div>
      <div class="agent-card nse">
        <div class="agent-head">
          <div class="agent-name"><span class="ico">📡</span> NSE BULK AGENT</div>
          <div class="agent-status \${nse.status==='running'?'busy':'healthy'}">\${nse.status || 'idle'}</div>
        </div>
        <div class="agent-grid">
          <div class="agent-field"><div class="agent-field-k">Last tick</div><div class="agent-field-v">\${timeAgo(nse.last_successful_run) || 'never'}</div></div>
          <div class="agent-field"><div class="agent-field-k">Failures</div><div class="agent-field-v">\${nse.consecutive_failures || 0}</div></div>
        </div>
        <div class="agent-summary">\${JSON.stringify(nse.last_summary || {})}</div>
      </div>
    \`;
  }

  (async () => {
    if (!window.isLoggedIn()) {
      // Just redirect or let the user figure it out for now.
      console.warn("User not logged in.");
      // window.location.href = '/login.html';
    }
    
    await loadStats();
    await loadFeed();
    
    setInterval(loadStats, 20000);
    setInterval(loadFeed, 20000);

    const s = window.getSession();
    if (s && s.access_token) {
      const source = new EventSource(\`/api/godmode/stream?token=\${s.access_token}\`);
      source.addEventListener('godlog', (e) => {
        loadStats();
        if (!isPaused) loadFeed();
      });
    }
  })();
</script>
</body>
</html>
`;

fs.writeFileSync('public/godmode.html', newHtml);
