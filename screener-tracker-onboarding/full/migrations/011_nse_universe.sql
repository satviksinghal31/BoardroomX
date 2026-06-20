-- ─────────────────────────────────────────────────────────────────────────────
--  011_nse_universe.sql
--  NSE EQ stock universe — sourced from:
--    • EQUITY_L.csv        (NSE archives) — symbol, company, isin, face_value
--    • bhavcopy mcap CSV   (daily ZIP)    — market_cap
--
--  Refreshed nightly at midnight IST by the universe-refresh worker in server.js
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nse_universe (
  symbol           TEXT PRIMARY KEY,
  company_name     TEXT,
  isin             TEXT,
  face_value       NUMERIC,
  date_of_listing  TEXT,
  market_cap       NUMERIC,          -- latest EOD mcap in INR (from bhavcopy)
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Index for fast case-insensitive symbol/name search
CREATE INDEX IF NOT EXISTS idx_nse_universe_symbol      ON nse_universe (symbol);
CREATE INDEX IF NOT EXISTS idx_nse_universe_company_gin ON nse_universe
  USING gin (to_tsvector('simple', coalesce(company_name, '')));

-- RLS: public read (universe is not sensitive), no write from client
ALTER TABLE nse_universe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "universe_read_all" ON nse_universe
  FOR SELECT USING (true);

-- Grant write access to service_role (needed for server-side upserts)
GRANT ALL ON TABLE nse_universe TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;
