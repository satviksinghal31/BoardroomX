CREATE TABLE IF NOT EXISTS dhan_instruments (
  symbol TEXT PRIMARY KEY,
  isin TEXT,
  company_name TEXT,
  display_name TEXT,
  dhan_security_id TEXT,
  dhan_exchange_segment TEXT DEFAULT 'NSE_EQ',
  instrument TEXT DEFAULT 'EQUITY',
  series TEXT DEFAULT 'EQ',
  lot_size NUMERIC,
  tick_size NUMERIC,
  upper_limit NUMERIC,
  lower_limit NUMERIC,
  freeze_qty NUMERIC,
  is_active BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dhan_instruments_symbol ON dhan_instruments(symbol);
CREATE INDEX IF NOT EXISTS idx_dhan_instruments_company_gin ON dhan_instruments
  USING gin (to_tsvector('simple', coalesce(company_name, '') || ' ' || coalesce(display_name, '')));

CREATE TABLE IF NOT EXISTS nse_eod_market_caps (
  trade_date DATE NOT NULL,
  symbol TEXT NOT NULL,
  series TEXT NOT NULL DEFAULT 'EQ',
  security_name TEXT,
  category TEXT,
  last_trade_date DATE,
  face_value NUMERIC,
  issue_size NUMERIC,
  close_price NUMERIC,
  market_cap NUMERIC,
  source_file TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trade_date, symbol, series)
);

CREATE INDEX IF NOT EXISTS idx_nse_eod_market_caps_symbol_date_desc
  ON nse_eod_market_caps(symbol, trade_date DESC);

CREATE OR REPLACE VIEW market_universe AS
WITH latest_mcap AS (
  SELECT DISTINCT ON (symbol)
    symbol,
    trade_date AS market_cap_trade_date,
    market_cap,
    issue_size,
    close_price,
    face_value,
    fetched_at AS market_cap_updated_at
  FROM nse_eod_market_caps
  WHERE series = 'EQ'
  ORDER BY symbol, trade_date DESC
)
SELECT
  d.symbol,
  d.company_name,
  d.display_name,
  d.isin,
  d.dhan_security_id,
  d.dhan_exchange_segment,
  d.instrument,
  d.series,
  d.lot_size,
  d.tick_size,
  d.upper_limit,
  d.lower_limit,
  d.freeze_qty,
  d.is_active,
  d.last_synced_at,
  m.market_cap,
  m.issue_size,
  m.close_price,
  m.face_value,
  m.market_cap_trade_date,
  m.market_cap_updated_at
FROM dhan_instruments d
LEFT JOIN latest_mcap m ON m.symbol = d.symbol;

ALTER TABLE dhan_instruments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dhan_instruments_read_all" ON dhan_instruments;
CREATE POLICY "dhan_instruments_read_all" ON dhan_instruments FOR SELECT USING (true);

ALTER TABLE nse_eod_market_caps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nse_eod_market_caps_read_all" ON nse_eod_market_caps;
CREATE POLICY "nse_eod_market_caps_read_all" ON nse_eod_market_caps FOR SELECT USING (true);

GRANT ALL ON TABLE dhan_instruments TO service_role;
GRANT ALL ON TABLE nse_eod_market_caps TO service_role;
GRANT SELECT ON market_universe TO service_role, anon, authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
