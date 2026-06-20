-- ─────────────────────────────────────────────────────────────────────────────
-- 003: Add `sector` column to stocks + backfill from data/nse_universe.json.
--
-- Before this: sectorMap was built server-side from portfolio.json (14 stocks).
-- For every other catalog symbol the client received `sector: null`, so the
-- watchlist filter chips and details "About" were degraded for ~96% of stocks.
--
-- The backfill UPDATE runs from the seed script (scripts/seed-stub-catalog.mjs)
-- so it picks up future universe additions automatically. This migration only
-- adds the column.
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.stocks ADD COLUMN IF NOT EXISTS sector text;

-- Lightweight index for filter-by-sector queries (small cardinality but
-- helpful when watchlist gets larger).
CREATE INDEX IF NOT EXISTS stocks_sector_idx ON public.stocks (sector);
