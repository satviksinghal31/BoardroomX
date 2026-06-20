-- Migration 004: Add purpose + category to results table
-- Allows storing all NSE board meeting types (not just earnings)

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS purpose  text,
  ADD COLUMN IF NOT EXISTS category text;

-- Index for God Mode feed filtering by category
CREATE INDEX IF NOT EXISTS results_category_idx ON public.results (category);
CREATE INDEX IF NOT EXISTS results_reported_at_idx ON public.results (reported_at DESC NULLS LAST);
