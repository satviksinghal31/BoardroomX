# BoardroomX UI — Product Requirements v1.1
**Date**: 2026-05-21  
**Source**: User review session feedback  
**Status**: IN PROGRESS

---

## Background

The cockpit (4-column layout) shipped in v3.0. This PRD captures six targeted UX improvements from the first real-use review, plus one new feature (user watchlists).

---

## REQ-01 · Simplify Chart Header

| Field | Value |
|---|---|
| **Problem** | Chart header repeats MCap, PE, Forward PE — same data the details panel already shows. |
| **Solution** | Strip chart top-bar to essentials: **Name · Symbol · Price · Day change %** only. Remove MCap, PE, Forward PE stat rows. |
| **File** | `public/app.js` → `renderChartHeader()` |
| **Acceptance** | Chart bar shows: big name, symbol+NSE+live dot, price chip with % change. Nothing else. |

---

## REQ-02 · Details Panel — Minimalist Key Stats

| Field | Value |
|---|---|
| **Problem** | `.det-stat` chips have grey surface backgrounds — feels heavy and card-within-card. |
| **Solution** | Replace 2-col card grid with a lean **label : value** inline list. No background on each item — just padding + bottom border. |
| **File** | `public/style.css` → `.det-stat*` classes; `public/app.js` → `renderDetailsPanel()` |
| **Acceptance** | Stats render as clean two-col rows: muted label left, bold value right. Zero background blocks. |

---

## REQ-03 · Details Panel — 8-Quarter Trend Bars

| Field | Value |
|---|---|
| **Problem** | Details panel shows only the single latest quarter. 8Q history is already in `stock.quarters8`. |
| **Solution** | In the earnings section, render **two compact bar charts** (Revenue 8Q + Net Profit 8Q) inside the details panel. Max 48px tall. Same visual language as existing `bar-chart` in detail sheets. |
| **File** | `public/app.js` → `renderDetailsPanel()`; `public/style.css` → `.det-minichart-*` |
| **Acceptance** | When `stock.quarters8` exists, show two mini bar rows with Q labels. Latest bar highlighted. Graceful no-data state. |

---

## REQ-04 · Details Panel — Latest Announcements (Mock → NSE API)

| Field | Value |
|---|---|
| **Problem** | No news/announcements surface anywhere in the UI. NSE API is already wired server-side (`fetch_ann.py`). |
| **Solution** | Add an "**Announcements**" section at the bottom of the details panel. **Phase 1**: 2–3 clearly-labelled mock rows with date + headline + NSE badge. **Phase 2** (later): replace with live `/api/announcements/:symbol` endpoint. |
| **File** | `public/app.js` → `renderDetailsPanel()`; `public/style.css` → `.det-ann-*` |
| **Acceptance** | Section visible with 3 rows showing: date pill, short headline, NSE tag. Code comment marks as `// MOCK`. |

---

## REQ-05 · Watchlist — Remove Rev / Net Columns

| Field | Value |
|---|---|
| **Problem** | Rev% and Net% columns are redundant with the details panel; clutter the slim watchlist. |
| **Solution** | Stock row becomes **3-column only**: `[status-bar] [symbol + name + event-flag] [price + delta]`. |
| **File** | `public/style.css` → stock row / list-header grids; `public/app.js` → `renderRow()`; `public/index.html` → `.list-header` HTML |
| **Acceptance** | Watchlist is visibly simpler. Selected state, hover shadow, sector headers unchanged. |

---

## REQ-06 · Watchlist — Upcoming Event Flag

| Field | Value |
|---|---|
| **Problem** | No visual cue when something is imminent for a stock (board meeting, earnings date). |
| **Solution** | When `stock.quarterStatus.nextBoardDate` is within **14 days**, show a small amber **`📅 May 28`** pill inside the stock name cell (below the name). |
| **File** | `public/app.js` → `renderRow()`; `public/style.css` → `.event-flag` |
| **Acceptance** | Amber pill appears only when board date ≤14 days out. Disappears otherwise. Clicking the row still works normally. |

---

## REQ-07 · Watchlist — User Watchlists + Kite Tab

| Field | Value |
|---|---|
| **Problem** | Sector tabs auto-generate from industry — not user-controllable. No way to have custom lists. |
| **Solution** | Replace `buildSectorTabs()` with 3 **fixed watchlist tabs**: **WL1** (current portfolio, same stocks as today, sector groups kept inside), **WL2** (empty, shows "No stocks yet" empty state with "+Add" placeholder), **Kite** (shows Kite holdings if `kiteConnected`, else shows a "Connect Kite →" CTA that links to `/kite-connect`). |
| **File** | `public/app.js` → new `buildWatchlistTabs()` + `switchWatchlist()` + Kite content renderer; `public/index.html` → sector-tabs container label |
| **Acceptance** | Three tabs always visible. WL1 default selected. WL2 empty state. Kite tab shows holdings list (symbol + qty + P&L from `kiteHoldings`) or connect CTA. |

---

## REQ-08 · Remove Duplicate AI Agents from Utility Sidebar

| Field | Value |
|---|---|
| **Problem** | AI Agents appears in header nav **and** utility sidebar. |
| **Solution** | Remove the AI Agents `util-btn` from the utility sidebar. Keep: Portfolio icon, Kite icon, spacer, Refresh icon. |
| **File** | `public/index.html` → `.utility-sidebar` |
| **Acceptance** | Utility sidebar has 4 items: Portfolio, Kite, spacer, Refresh. No AI Agents. |

---

## Implementation Workstreams

Three parallel streams, merged after all complete.

### Stream A — `stream/a-chart-nav` (REQ-01, REQ-08)
- **Scope**: `renderChartHeader()` in app.js + utility sidebar HTML only
- **Risk**: Very low — isolated to one function + one HTML block
- **Estimated**: Small

### Stream B — `stream/b-watchlist` (REQ-05, REQ-06, REQ-07)
- **Scope**: Stock row rendering, CSS grid, sector tab replacement with watchlist tabs
- **Risk**: Medium — touches 3 files but well-isolated functions
- **Estimated**: Medium

### Stream C — `stream/c-details-panel` (REQ-02, REQ-03, REQ-04)
- **Scope**: `renderDetailsPanel()` rewrite + new CSS namespace `.det-*`
- **Risk**: Medium — large function rewrite, new CSS classes
- **Estimated**: Medium

### Merge Order
A → B → C (A has no conflicts, B and C overlap only in minor CSS namespace)

---

## Out of Scope (this sprint)
- Live NSE announcements API endpoint (Phase 2 of REQ-04)
- WL2 stock-add UI (future)
- Custom watchlist persistence (future — Supabase table needed)
