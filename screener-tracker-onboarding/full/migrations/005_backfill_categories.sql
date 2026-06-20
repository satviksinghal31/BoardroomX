-- Migration 005: Backfill category for existing NSE-synced results rows
--
-- Context: Before migration 004 added the `category` column, all NSE rows
-- were synced without category info. The old fetcher also only captured
-- EARNINGS (financial result) board meetings — so every row that has an
-- actual NSE date (reported_at OR expected_at) is an EARNINGS row.
--
-- Rows with no dates are financial-data stubs (Screener quarters without
-- a matching NSE board-meeting entry) — leave those as NULL.
--
-- Future non-earnings events (DIVIDEND, AGM, etc.) will be populated by the
-- worker as it cycles through stocks with the new categorizePurpose() logic.

UPDATE public.results
SET    category = 'EARNINGS'
WHERE  category IS NULL
  AND  (reported_at IS NOT NULL OR expected_at IS NOT NULL)
  AND  quarter ~ '^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4}$';
