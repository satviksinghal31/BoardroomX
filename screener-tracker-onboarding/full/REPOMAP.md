# REPOMAP — BoardroomX
> Auto-generated 2026-05-25 04:00 by `scripts/build-repomap.mjs`
> **Read this before grepping.** Find the right file first, then Read it.

---

### `auth_middleware.js`
*44 lines · 2KB*

**Routes:** GET /api/portfolio
**Symbols:** `requireAuth`

---

### `auth_migrate.sql`
*74 lines · 3KB*

**Symbols:** `profiles`

---

### `auth_routes.js`
*221 lines · 9KB*

**Routes:** POST /api/auth/signup · POST /api/auth/signin · POST /api/auth/signout · GET /api/auth/me · POST /api/auth/refresh
**Symbols:** `registerAuthRoutes` · `_extractBearer` · `_buildSession`

---

### `fetch.js`
*147 lines · 5KB*

**Symbols:** `quarterSort` · `toConsolidatedUrl` · `scrapeWithFallback` · `fetchAndStore` · `main`

---

### `kite_migrate.sql`
*49 lines · 2KB*

**Symbols:** `kite_accounts` · `kite_holdings`

---

### `kite_routes.js`
*518 lines · 20KB*

**Routes:** GET /kite/login · GET /kite/callback · POST /api/kite/connect · GET /api/kite/status · POST /api/kite/sync · GET /api/kite/holdings · DELETE /api/kite/disconnect
**Symbols:** `registerKiteRoutes` · `getEncryptionKey` · `encrypt` · `decrypt` · `kiteChecksum` · `nextTokenExpiry` · `resolveUserId` · `syncHoldings`

---

### `migrate.js`
*106 lines · 4KB*

**Symbols:** `main`

---

### `migrations/001_multitenant.sql`
*96 lines · 5KB*

**Symbols:** `watchlists` · `watchlists_user_position_idx`

---

### `migrations/002_grant_watchlists.sql`
*18 lines · 1KB*

**Symbols:** `runs`

---

### `migrations/003_stocks_sector.sql`
*20 lines · 1KB*

**Symbols:** `stocks` · `stocks_sector_idx`

---

### `migrations/004_results_purpose.sql`
*11 lines · 0KB*

**Symbols:** `results` · `results_category_idx` · `results_reported_at_idx`

---

### `migrations/006_nse_synced_at.sql`
*12 lines · 1KB*

**Symbols:** `stocks` · `stocks_nse_synced_at_idx`

---

### `migrations/007_agent_state.sql`
*40 lines · 2KB*

**Symbols:** `agent_state` · `agent_state_status_idx`

---

### `migrations/008_god_logs.sql`
*39 lines · 1KB*

**Symbols:** `god_logs` · `god_logs_source_ts_idx` · `god_logs_symbol_ts_idx` · `god_logs_ts_idx`

---

### `migrations/009_mar_2026_complete.sql`
*35 lines · 1KB*

**Symbols:** `stocks` · `stocks_mar_2026_picker_idx`

---

### `migrations/010_nse_board_meetings.sql`
*61 lines · 3KB*

**Symbols:** `nse_board_meetings` · `nse_bm_runs` · `nse_bm_symbol_idx` · `nse_bm_date_idx` · `nse_bm_cluster_idx` · `nse_bm_ingested_idx`

---

### `migrations/011_nse_universe.sql`
*34 lines · 2KB*

**Symbols:** `nse_universe` · `idx_nse_universe_symbol` · `idx_nse_universe_company_gin`

---

### `migrations/012_nse_events.sql`
*36 lines · 2KB*

**Symbols:** `nse_events` · `idx_nse_events_symbol` · `idx_nse_events_ingested` · `idx_nse_events_date`

---

### `migrations/014_scheduler_log.sql`
*29 lines · 1KB*

**Symbols:** `scheduler_log` · `scheduler_log_ts_idx` · `scheduler_log_job_idx`

---

### `nse_announcements.js`
*214 lines · 9KB*

**Symbols:** `categorizePurpose` · `fetchBoardMeetings` · `syncBoardMeetings` · `NSE_BM` · `parseBmDate` · `boardDateToQuarter` · `isFinancialResult` · `readCookieJar`

---

### `nse_bulk_agent.js`
*493 lines · 21KB*

**Symbols:** `runNseAgentTick` · `NSE_BM` · `NSE_ANN` · `toNseDate` · `fromNseDate` · `boardDateToQuarter` · `getCookieHeaders` · `fetchBMBulk` · `fetchAnnBulk` · `fetchCorpBulk` · `processBoardMeetings` · `classifyAnnDesc` · `processAnnouncements` · `classifyCorpSubject` · `processCorpActions` · `diffAndUpsert` · `readState` · `writeState`

---

### `nse_events_cron.js`
*212 lines · 9KB*

**Symbols:** `runEventsCron` · `scheduleEventsCron` · `fmtDate` · `daysOffset` · `_warmCookie` · `fetchEventWindow` · `buildRow`

---

### `portfolio.json`
*17 lines · 2KB*

**Symbols:** `[Array length=14]`

---

### `public/app.js`
*2577 lines · 113KB*

**Symbols:** `renderResultsStatusAgent` · `detectUnfilledGaps` · `drawGaps` · `renderGapLegend` · `zoomToGap` · `toggleGaps` · `calcEMA` · `calcRSI` · `destroyCharts` · `closeEarningsPopup` · `showEarningsPopup` · `drawEarningsOverlay` · `buildCharts` · `renderChartHeader` · `_updateChartHeader` · `computeDisplayFrom` · `loadDesktopChart` · `switchTf` · `switchChartTab` · `_fetchNonPortfolioFinancials` · `buildFinancialsTab` · `_finEmpty` · `openChartSheet` · `loadMobileChart` · `switchMobileTf` · `getQuoteInfo` · `_loadUniverse` · `isInWatchlist` · `isBootstrapping` · `addToWatchlist` · `_pollUntilBootstrapped` · `removeFromWatchlist` · `showToast` · `onSearchInput` · `onSearchKeydown` · `_triggerFirstResult` · `_getInputEl` · `_getDropdownEl` · `_scoreMatch` · `_renderSearchDropdown` · `_applyHighlight` · `_closeSearchDropdown` · `_blurSearchInput` · `selectSearchResult` · `searchSymbol` · `searchSymbolMobile` · `fmtEventTs` · `qlabelFull` · `fmtCrTl` · `buildTimeline` · `buildDetMinichart` · `_buildAboutCard` · `_buildDetSkeleton` · `renderDetailsPanel` · `selectStock` · `freshnessInfo` · `qra_consolidatedTag` · `qra_nudge` · `qra_resultsTable` · `fmtDate` · `qra_quarterStatus` · `qra_charts8` · `avatarBg` · `avatarText` · `rowStatusCls` · `renderRow` · `onRowClick` · `buildWatchlistTabs` · `switchWatchlist` · `renderKiteWatchlist` · `renderStockList` · `openSidebar` · `closeSidebar` · `renderAgentCard` · `openDetailSheet` · `renderDetailSheet` · `openSheet` · `closeSheet` · `loadPortfolio` · `refreshAll` · `toggleWatchlist` · `toggleDetails` · `startPriceRefresh` · `refreshPrices`

---

### `public/auth.js`
*413 lines · 16KB*

**Symbols:** `getSession` · `_storeSession` · `_clearSession` · `_authRedirectUrl` · `authGuard` · `getUser` · `isLoggedIn` · `_post` · `_get` · `signIn` · `signUp` · `signOut` · `refreshSession` · `fetchMe` · `bxFetch` · `_scheduleRefresh` · `_authPageInit` · `handleSignIn` · `handleSignUp` · `switchTab` · `_setLoading` · `_showError` · `_showSuccess` · `_clearMsg` · `togglePw` · `_updatePwStrength` · `renderUserPill` · `_esc`

---

### `scraper.js`
*178 lines · 7KB*

**Symbols:** `scrapeScreener` · `scrapeAndStore` · `toConsolidatedUrl` · `scrapeWithFallback` · `classifyError`

---

### `scripts/backfill-events.mjs`
*186 lines · 8KB*

**Symbols:** `fmtDate` · `fetchWindow` · `buildRow` · `main`

---

### `scripts/qa-full.mjs`
*392 lines · 20KB*

**Symbols:** `ok` · `fail` · `group` · `api`

---

### `scripts/refresh-universe.mjs`
*242 lines · 10KB*

**Symbols:** `refreshUniverse` · `refreshMcapOnly` · `pad2` · `bhavZipDate` · `bhavFileDate` · `fetchText` · `fetchEquityList` · `fetchMcapMap`

---

### `server.js`
*1326 lines · 54KB*

**Routes:** GET /auth · GET /kite-connect · GET /godmode · GET /api/config · GET /api/portfolio · POST /api/watchlist · DELETE /api/watchlist/:symbol · PATCH /api/watchlist/reorder · GET /api/chart/:symbol · GET /api/prices · GET /api/quote/:symbol · GET /api/financials/:symbol · POST /api/refresh/:symbol · GET /api/events/purposes · GET /api/events/list · GET /api/events/grouped · GET /api/universe · GET /api/scheduler/log
**Symbols:** `_evInvalidateCache` · `toYahooTicker` · `refreshMarketCache` · `refreshAllMarketCache` · `getCachedMarketData` · `fetchChartData` · `refreshChartCache` · `refreshAllChartCache` · `_verifyDbPool` · `calcGrowth` · `quarterSort` · `shortLabel` · `nextQuarterHeader` · `quarterStatus` · `getMarketData` · `_parseEvDate` · `_evType` · `_evFetchAll` · `_evValidateCache` · `_loadUniverseCache` · `_schedLog` · `_loadSchedulerLog` · `_scheduleDaily` · `_midnightMcapRefresh`

---

### `show.js`
*147 lines · 5KB*

**Symbols:** `bold` · `cyan` · `yellow` · `green` · `red` · `gray` · `white` · `pad` · `fmtVal` · `yoy` · `printTable` · `showCompany` · `main`

---
*51 files scanned · regenerate with `npm run repomap`*
