DROP TABLE IF EXISTS dhan_daily_candles;

CREATE TABLE IF NOT EXISTS dhan_daily_candle_series (
  instrument_id BIGINT PRIMARY KEY REFERENCES dhan_instruments(instrument_id),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  candle_count INTEGER NOT NULL,
  candles_gzip_base64 TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (candle_count > 0),
  CHECK (from_date <= to_date)
);

CREATE INDEX IF NOT EXISTS idx_dhan_daily_candle_series_to_date
  ON dhan_daily_candle_series(to_date DESC);

ALTER TABLE dhan_daily_candle_series ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dhan_daily_candle_series_read_all" ON dhan_daily_candle_series;
CREATE POLICY "dhan_daily_candle_series_read_all" ON dhan_daily_candle_series FOR SELECT USING (true);
GRANT ALL ON TABLE dhan_daily_candle_series TO service_role;
