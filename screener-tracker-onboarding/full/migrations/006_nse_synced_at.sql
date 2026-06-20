-- Migration 006: Add nse_synced_at to stocks table
-- Tracks when the NSE agent last synced board meetings for each stock.
-- Separate from financials.fetched_at (which tracks Screener.in only).
-- Enables independent scheduling of the Screener and NSE agents.

ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS nse_synced_at timestamptz;

-- Index: nulls first so bootstrap candidates (never synced) sort to the top
CREATE INDEX IF NOT EXISTS stocks_nse_synced_at_idx
  ON public.stocks (nse_synced_at NULLS FIRST);
