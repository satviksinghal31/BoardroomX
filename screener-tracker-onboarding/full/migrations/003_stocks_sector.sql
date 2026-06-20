-- ─────────────────────────────────────────────────────────────────────────────
-- 003: Add `sector` column to stocks.
--
-- Before this: sectorMap was built server-side from portfolio.json (14 stocks).
-- For every other catalog symbol the client received `sector: null`, so the
-- watchlist filter chips and details "About" were degraded for ~96% of stocks.
--
-- Historical sector backfills were data-source specific and now run outside
-- migrations. This migration only adds the column.
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.stocks ADD COLUMN IF NOT EXISTS sector text;

-- Lightweight index for filter-by-sector queries (small cardinality but
-- helpful when watchlist gets larger).
CREATE INDEX IF NOT EXISTS stocks_sector_idx ON public.stocks (sector);
