# REPOMAP — BoardroomX
> Auto-generated 2026-06-20 11:09 by `scripts/build-repomap.mjs`
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

### `dhan_auth.mjs`
*126 lines · 4KB*

**Symbols:** `createDhanAuth` · `createSupabaseDhanAuthStateStore` · `requireEnv` · `defaultTotp` · `tokenReusable` · `responseText`

---

### `dhan_live_feed.mjs`
*156 lines · 4KB*

**Symbols:** `validateWorkerEnv` · `buildSubscriptionMessages` · `runDhanLiveFeed` · `createSupabase` · `createPool` · `loadInstruments` · `upsertLiveRows` · `packetToTick`

---

### `dhan_market_data.js`
*116 lines · 4KB*

**Symbols:** `createDhanMarketData` · `normalizeSymbol` · `displayFromYearsAgo` · `uniqueSymbols`

---

### `dhan_routes.js`
*42 lines · 1KB*

**Routes:** GET /api/chart/:symbol · GET /api/prices · GET /api/quote/:symbol · GET /api/dhan/health
**Symbols:** `registerDhanRoutes`

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
*19 lines · 1KB*

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

### `migrations/011_market_sources.sql`
*95 lines · 3KB*

**Symbols:** `dhan_instruments` · `nse_eod_market_caps` · `idx_dhan_instruments_symbol` · `idx_dhan_instruments_company_gin` · `idx_nse_eod_market_caps_symbol_date_desc`

---

### `migrations/012_nse_events.sql`
*36 lines · 2KB*

**Symbols:** `nse_events` · `idx_nse_events_symbol` · `idx_nse_events_ingested` · `idx_nse_events_date`

---

### `migrations/014_scheduler_log.sql`
*29 lines · 1KB*

**Symbols:** `scheduler_log` · `scheduler_log_ts_idx` · `scheduler_log_job_idx`

---

### `migrations/015_screener_annuals.sql`
*213 lines · 9KB*

**Symbols:** `annual_fundamentals` · `annual_ratios` · `annual_balance_sheet` · `annual_cash_flows` · `shareholding_pattern` · `screener_fetch_queue` · `screener_fetch_runs` · `screener_fetch_queue_status_idx` · `annual_fundamentals_symbol_order_idx` · `annual_ratios_symbol_order_idx` · `shareholding_pattern_symbol_order_idx` · `screener_fetch_runs_symbol_started_idx`

---

### `migrations/016_dhan_market_data.sql`
*54 lines · 2KB*

**Symbols:** `dhan_daily_candles` · `dhan_live_today` · `dhan_auth_state` · `idx_dhan_daily_symbol_date_desc` · `idx_dhan_live_today_tick_at`

---

### `migrations/017_dhan_universe_eod_market_caps.sql`
*171 lines · 5KB*

**Symbols:** `dhan_instruments` · `nse_eod_market_caps` · `idx_dhan_instruments_symbol` · `idx_dhan_instruments_company_gin` · `idx_nse_eod_market_caps_symbol_date_desc`

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
*209 lines · 8KB*

**Symbols:** `buildRow` · `runEventsCron` · `fmtDate` · `daysOffset` · `cleanText` · `validIsoDate` · `canonicalEventDate` · `_warmCookie` · `fetchEventWindow`

---

### `portfolio.json`
*17 lines · 2KB*

**Symbols:** `[Array length=14]`

---

### `public/annuals.js`
*328 lines · 11KB*

**Symbols:** `fmt` · `esc` · `statusLabel` · `uiStatus` · `renderStatusGrid` · `applyFilters` · `renderSymbolList` · `loadStatus` · `loadSymbols` · `ratioMap` · `table` · `renderFinancialTable` · `renderShareholdingTable` · `renderRuns` · `renderDetails` · `selectSymbol` · `refreshAll` · `scheduleLiveRefresh` · `startAnnualEvents` · `bindEvents` · `initEls`

---

### `public/app.js`
*2589 lines · 113KB*

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

### `scripts/dhan-eod-update.mjs`
*82 lines · 3KB*

**Symbols:** `buildEodRows` · `runDhanEodUpdate` · `main` · `candleFromLive` · `createSupabase`

---

### `scripts/dhan-historical-backfill.mjs`
*85 lines · 3KB*

**Symbols:** `buildHistoricalRows` · `runDhanHistoricalBackfill` · `main` · `createSupabase`

---

### `scripts/dhan-instrument-sync.mjs`
*114 lines · 4KB*

**Symbols:** `filterDhanEquityRows` · `buildInactiveSymbols` · `parseCsvRows` · `runDhanInstrumentSync` · `main` · `pick` · `createSupabase`

---

### `scripts/eod-market-cap.mjs`
*144 lines · 5KB*

**Symbols:** `bhavZipDate` · `bhavFileDate` · `parseMarketCapCsv` · `buildBhavcopyCandidates` · `fetchLatestMarketCapCsv` · `runEodMarketCap` · `main` · `pad2` · `parseNseDate` · `toNumber` · `createSupabase`

---

### `scripts/lib/dhan-client.mjs`
*66 lines · 2KB*

**Symbols:** `chunkSecurityIds` · `createDhanClient` · `parseResponse`

---

### `scripts/lib/dhan-feed-decoder.mjs`
*54 lines · 2KB*

**Symbols:** `decodeFeedPacket` · `toBuffer` · `readHeader`

---

### `scripts/lib/dhan-live-aggregate.mjs`
*49 lines · 1KB*

**Symbols:** `applyTick` · `serializeLiveState` · `round`

---

### `scripts/lib/dhan-normalize.mjs`
*107 lines · 3KB*

**Symbols:** `normalizeHistoricalResponse` · `toChartCandle` · `appendFreshLiveCandle` · `toPriceResponse` · `toQuoteResponse` · `round` · `epochToDateString`

---

### `scripts/lib/dhan-time.mjs`
*37 lines · 1KB*

**Symbols:** `todayIstDate` · `isNseMarketOpenIst` · `isFreshLiveTick` · `istParts`

---

### `scripts/lib/indicators.mjs`
*123 lines · 4KB*

**Symbols:** `sma` · `atr` · `addIndicators` · `crossedAbove` · `ret` · `maxDrawdown` · `avg`

---

### `scripts/lib/market-data.mjs`
*70 lines · 2KB*

**Symbols:** `yahooSymbol` · `getNifty500Symbols` · `fetchChart`

---

### `scripts/lib/rolling-simulator.mjs`
*239 lines · 8KB*

**Symbols:** `simulateRollingPath` · `summarizeRollingResults` · `round2` · `percentile` · `supertrendGreenFlip` · `supertrendRedFlip` · `exitSignal` · `computeMaxDrawdown`

---

### `scripts/lib/screener-annuals.mjs`
*263 lines · 11KB*

**Symbols:** `fetchAndStoreScreenerAnnuals` · `classifyScreenerError` · `toConsolidatedUrl` · `toNumber` · `getMetric` · `rawForPeriod` · `periodYear` · `latestAnnualYearExpected` · `tablePeriods` · `annualRows` · `ratioRows` · `balanceSheetRows` · `cashFlowRows` · `shareholdingRows` · `scrapeWithFallback` · `dedupeRows` · `upsertRows`

---

### `scripts/qa-full.mjs`
*392 lines · 20KB*

**Symbols:** `ok` · `fail` · `group` · `api`

---

### `scripts/rolling-supertrend-research.mjs`
*315 lines · 9KB*

**Symbols:** `uniq` · `pct` · `latestState` · `chooseFinalUniverse` · `rollingAnchors` · `toCsv` · `loadAnalyzedUniverse` · `main`

---

### `scripts/run-cron.mjs`
*191 lines · 6KB*

**Symbols:** `nextIstRunIso` · `getCronJobs` · `formatTerminalMessage` · `withAdvisoryLock` · `main` · `requireEnv` · `createSupabaseClient` · `createPool` · `writeLog` · `runWithTimeout` · `runJob`

---

### `scripts/screener-worker.mjs`
*255 lines · 7KB*

**Symbols:** `main` · `requireEnv` · `createSupabaseClient` · `createPool` · `withTimeout` · `seedQueue` · `claimNextSymbol` · `updateQueueSuccess` · `updateQueueFailure` · `insertRun` · `runOnce`

---

### `scripts/seed-stub-catalog.mjs`
*81 lines · 3KB*

**Symbols:** `fetchMarketUniverse`

---

### `scripts/supertrend-research.mjs`
*515 lines · 16KB*

**Symbols:** `uniq` · `yahooSymbol` · `fmtPct` · `avg` · `sma` · `atr` · `addIndicators` · `crossedAbove` · `ret` · `maxDrawdown` · `backtest` · `getNifty500Symbols` · `fetchChart` · `main`

---

### `scripts/verify-dhan-market-data.mjs`
*91 lines · 3KB*

**Symbols:** `main` · `requireEnv` · `fetchJson` · `verifyDb` · `verifyApi`

---

### `server.js`
*1212 lines · 48KB*

**Routes:** GET /auth · GET /kite-connect · GET /godmode · GET /api/config · GET /api/portfolio · POST /api/watchlist · DELETE /api/watchlist/:symbol · PATCH /api/watchlist/reorder · GET /api/financials/:symbol · POST /api/refresh/:symbol · GET /api/events/purposes · GET /api/events/list · GET /api/events/grouped · GET /api/universe · GET /api/annuals/status · GET /api/annuals/symbols · GET /api/annuals/events · GET /api/annuals/:symbol · GET /api/scheduler/log
**Symbols:** `_evInvalidateCache` · `_verifyDbPool` · `getRequiredDbPool` · `calcGrowth` · `quarterSort` · `shortLabel` · `nextQuarterHeader` · `quarterStatus` · `_parseEvDate` · `_evType` · `_evFetchAll` · `_evValidateCache` · `_loadUniverseCache` · `_loadSchedulerLog` · `_annualNoStore` · `_validateAnnualsStreamToken`

---

### `show.js`
*147 lines · 5KB*

**Symbols:** `bold` · `cyan` · `yellow` · `green` · `red` · `gray` · `white` · `pad` · `fmtVal` · `yoy` · `printTable` · `showCompany` · `main`

---

### `tests/dhan-auth.test.mjs`
*147 lines · 5KB*

**Symbols:** `createStateStore`

---

### `tests/dhan-feed.test.mjs`
*84 lines · 3KB*

**Symbols:** `header`

---

### `tests/dhan-routes.test.mjs`
*146 lines · 5KB*

**Symbols:** `createFakePool`

---

### `tests/rolling-simulator.test.mjs`
*151 lines · 5KB*

**Symbols:** `row`

---
*88 files scanned · regenerate with `npm run repomap`*
