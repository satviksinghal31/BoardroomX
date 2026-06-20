-- Migration 013: Drop deprecated NSE board-meetings tables
--
-- nse_board_meetings — was written by nse_bm_cron.js (deleted in Phase 6).
--   No active code writes to this table. nse_events is the replacement.
--
-- nse_bm_runs — single-row cron health state for the old BM cron.
--   /api/bm/status (removed in this phase) was the only reader.
--
-- Both are safe to drop: all board meeting data lives in nse_events now.

DROP TABLE IF EXISTS nse_board_meetings;
DROP TABLE IF EXISTS nse_bm_runs;
