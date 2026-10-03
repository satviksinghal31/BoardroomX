-- Stop old deployed workers before applying. Never use CASCADE.
-- Preserve profiles, auth schemas, dhan_instruments, nse_universe,
-- market_universe and its nse_eod_market_caps dependency.
BEGIN;
DROP TABLE IF EXISTS public.quarterly_results;
DROP TABLE IF EXISTS public.screener_fetch_runs;
DROP TABLE IF EXISTS public.screener_fetch_queue;
DROP TABLE IF EXISTS public.annual_fundamentals;
DROP TABLE IF EXISTS public.annual_ratios;
DROP TABLE IF EXISTS public.annual_balance_sheet;
DROP TABLE IF EXISTS public.annual_cash_flows;
DROP TABLE IF EXISTS public.shareholding_pattern;
DROP TABLE IF EXISTS public.scheduler_log;
DROP TABLE IF EXISTS public.god_logs;
DROP TABLE IF EXISTS public.agent_state;
DROP TABLE IF EXISTS public.nse_events;
DROP TABLE IF EXISTS public.nse_board_meetings;
DROP TABLE IF EXISTS public.nse_bm_runs;
DROP TABLE IF EXISTS public.kite_holdings;
DROP TABLE IF EXISTS public.kite_accounts;
DROP TABLE IF EXISTS public.dhan_daily_candle_series;
DROP TABLE IF EXISTS public.dhan_daily_candles;
DROP TABLE IF EXISTS public.dhan_live_today;
DROP TABLE IF EXISTS public.dhan_auth_state;
DROP TABLE IF EXISTS public.watchlists;
DROP TABLE IF EXISTS public.financials;
DROP TABLE IF EXISTS public.results;
DROP TABLE IF EXISTS public.stocks;
COMMIT;
