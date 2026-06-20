-- Migration 009: Add per-quarter completion flag to stocks
-- Phase-1 strategy: scrape each company exactly once for the latest quarter,
-- then leave it alone forever. Quarterly numbers are immutable once published.
--
-- mar_2026_complete = TRUE  → we have non-empty Mar 2026 data, skip forever
-- mar_2026_complete = FALSE → crawler should pick this up (subject to retry throttle)
--
-- When Jun 2026 season opens (~August 2026), add jun_2026_complete in a
-- separate migration. We do not pre-create columns for future quarters.

ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS mar_2026_complete   boolean      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_scrape_attempt timestamptz;

-- Index so the crawler's "pick next" query is O(log n)
CREATE INDEX IF NOT EXISTS stocks_mar_2026_picker_idx
  ON public.stocks (mar_2026_complete, last_scrape_attempt NULLS FIRST)
  WHERE mar_2026_complete = FALSE;

-- Backfill: any stock that has a non-empty Mar 2026 row in `results` is complete
UPDATE public.stocks s
SET mar_2026_complete = TRUE
WHERE EXISTS (
  SELECT 1 FROM public.results r
  WHERE r.symbol = s.symbol
    AND r.quarter = 'Mar 2026'
    AND r.data IS NOT NULL
    AND r.data::text != '{}'
);

COMMENT ON COLUMN public.stocks.mar_2026_complete IS
  'TRUE iff we have non-empty Mar 2026 quarterly data; crawler skips these.';
COMMENT ON COLUMN public.stocks.last_scrape_attempt IS
  'Updated by SCREENER agent on EVERY scrape attempt (success or fail) — throttles retries.';
