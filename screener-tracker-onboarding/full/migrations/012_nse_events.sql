-- ─────────────────────────────────────────────────────────────────────────────
--  012_nse_events.sql
--
--  Replaces nse_board_meetings with a simpler table sourced from NSE
--  /api/event-calendar (covers ALL listed companies including large-caps).
--
--  Dedup key: symbol | purpose | bm_desc | date
--  No clustering, no flags — raw NSE data as-is.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nse_events (
  unique_key   TEXT PRIMARY KEY,          -- symbol|purpose|bm_desc|date
  symbol       TEXT        NOT NULL,
  company      TEXT,
  purpose      TEXT,                      -- raw NSE value e.g. "Financial Results/Dividend"
  bm_desc      TEXT,                      -- full description text
  date         TEXT,                      -- "DD-Mon-YYYY" as returned by NSE
  ingested_at  TIMESTAMPTZ DEFAULT now()
);

-- Fast lookups by symbol (for per-company expand)
CREATE INDEX IF NOT EXISTS idx_nse_events_symbol     ON nse_events (symbol);
-- Fast sort by ingested_at for grouped feed
CREATE INDEX IF NOT EXISTS idx_nse_events_ingested   ON nse_events (ingested_at DESC);
-- Fast date filtering (upcoming vs past)
CREATE INDEX IF NOT EXISTS idx_nse_events_date       ON nse_events (date);

-- RLS: service_role writes, authenticated users read
ALTER TABLE nse_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_read_auth" ON nse_events
  FOR SELECT TO authenticated USING (true);

GRANT ALL  ON TABLE nse_events TO service_role;
GRANT SELECT ON TABLE nse_events TO authenticated;
