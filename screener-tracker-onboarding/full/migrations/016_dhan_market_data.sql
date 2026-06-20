ALTER TABLE nse_universe
  ADD COLUMN IF NOT EXISTS dhan_security_id TEXT,
  ADD COLUMN IF NOT EXISTS dhan_exchange_segment TEXT DEFAULT 'NSE_EQ',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS dhan_daily_candles (
  symbol TEXT NOT NULL REFERENCES nse_universe(symbol),
  trade_date DATE NOT NULL,
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  volume BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_dhan_daily_symbol_date_desc
  ON dhan_daily_candles(symbol, trade_date DESC);

CREATE TABLE IF NOT EXISTS dhan_live_today (
  symbol TEXT PRIMARY KEY REFERENCES nse_universe(symbol),
  trade_date DATE NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  ltp NUMERIC,
  prev_close NUMERIC,
  volume BIGINT,
  last_tick_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dhan_live_today_tick_at
  ON dhan_live_today(last_tick_at DESC);

CREATE TABLE IF NOT EXISTS dhan_auth_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token TEXT,
  issued_at TIMESTAMPTZ,
  expiry_time TIMESTAMPTZ,
  last_refresh_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dhan_daily_candles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dhan_daily_candles_read_all" ON dhan_daily_candles;
CREATE POLICY "dhan_daily_candles_read_all" ON dhan_daily_candles FOR SELECT USING (true);
GRANT ALL ON TABLE dhan_daily_candles TO service_role;

ALTER TABLE dhan_live_today ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dhan_live_today_read_all" ON dhan_live_today;
CREATE POLICY "dhan_live_today_read_all" ON dhan_live_today FOR SELECT USING (true);
GRANT ALL ON TABLE dhan_live_today TO service_role;

ALTER TABLE dhan_auth_state ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE dhan_auth_state TO service_role;
