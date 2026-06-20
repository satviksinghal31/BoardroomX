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

DO $$
BEGIN
  IF to_regclass('public.nse_universe') IS NOT NULL THEN
    INSERT INTO dhan_instruments (
      symbol,
      isin,
      company_name,
      display_name,
      dhan_security_id,
      dhan_exchange_segment,
      is_active,
      last_synced_at,
      updated_at
    )
    SELECT
      symbol,
      isin,
      company_name,
      company_name,
      dhan_security_id,
      COALESCE(dhan_exchange_segment, 'NSE_EQ'),
      COALESCE(is_active, true),
      updated_at,
      updated_at
    FROM nse_universe
    ON CONFLICT (symbol) DO UPDATE SET
      isin = COALESCE(EXCLUDED.isin, dhan_instruments.isin),
      company_name = COALESCE(EXCLUDED.company_name, dhan_instruments.company_name),
      display_name = COALESCE(EXCLUDED.display_name, dhan_instruments.display_name),
      dhan_security_id = COALESCE(EXCLUDED.dhan_security_id, dhan_instruments.dhan_security_id),
      dhan_exchange_segment = COALESCE(EXCLUDED.dhan_exchange_segment, dhan_instruments.dhan_exchange_segment),
      is_active = EXCLUDED.is_active,
      last_synced_at = COALESCE(EXCLUDED.last_synced_at, dhan_instruments.last_synced_at),
      updated_at = now();

    INSERT INTO nse_eod_market_caps (
      trade_date,
      symbol,
      series,
      security_name,
      face_value,
      market_cap,
      source_file,
      fetched_at
    )
    SELECT
      COALESCE(updated_at::date, CURRENT_DATE),
      symbol,
      'EQ',
      company_name,
      face_value,
      market_cap,
      'legacy_migration',
      COALESCE(updated_at, now())
    FROM nse_universe
    WHERE market_cap IS NOT NULL
    ON CONFLICT (trade_date, symbol, series) DO UPDATE SET
      security_name = COALESCE(EXCLUDED.security_name, nse_eod_market_caps.security_name),
      face_value = COALESCE(EXCLUDED.face_value, nse_eod_market_caps.face_value),
      market_cap = COALESCE(EXCLUDED.market_cap, nse_eod_market_caps.market_cap),
      fetched_at = EXCLUDED.fetched_at;
  END IF;
END $$;

ALTER TABLE IF EXISTS dhan_daily_candles DROP CONSTRAINT IF EXISTS dhan_daily_candles_symbol_fkey;
ALTER TABLE IF EXISTS dhan_daily_candles
  ADD CONSTRAINT dhan_daily_candles_symbol_fkey
  FOREIGN KEY (symbol) REFERENCES dhan_instruments(symbol);

ALTER TABLE IF EXISTS dhan_live_today DROP CONSTRAINT IF EXISTS dhan_live_today_symbol_fkey;
ALTER TABLE IF EXISTS dhan_live_today
  ADD CONSTRAINT dhan_live_today_symbol_fkey
  FOREIGN KEY (symbol) REFERENCES dhan_instruments(symbol);

CREATE INDEX IF NOT EXISTS idx_dhan_instruments_symbol ON dhan_instruments(symbol);
CREATE INDEX IF NOT EXISTS idx_dhan_instruments_company_gin ON dhan_instruments
  USING gin (to_tsvector('simple', coalesce(company_name, '') || ' ' || coalesce(display_name, '')));
CREATE INDEX IF NOT EXISTS idx_nse_eod_market_caps_symbol_date_desc
  ON nse_eod_market_caps(symbol, trade_date DESC);

DROP VIEW IF EXISTS market_universe;
CREATE VIEW market_universe AS
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
