ALTER TABLE dhan_instruments
  ADD COLUMN IF NOT EXISTS instrument_id BIGINT;

CREATE SEQUENCE IF NOT EXISTS dhan_instruments_instrument_id_seq;

UPDATE dhan_instruments
SET instrument_id = nextval('dhan_instruments_instrument_id_seq')
WHERE instrument_id IS NULL;

SELECT setval(
  'dhan_instruments_instrument_id_seq',
  GREATEST((SELECT COALESCE(MAX(instrument_id), 0) FROM dhan_instruments), 1),
  true
);

ALTER TABLE dhan_instruments
  ALTER COLUMN instrument_id SET DEFAULT nextval('dhan_instruments_instrument_id_seq');

ALTER TABLE dhan_instruments
  ALTER COLUMN instrument_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dhan_instruments_instrument_id
  ON dhan_instruments(instrument_id);

DROP TABLE IF EXISTS dhan_daily_candles;

CREATE TABLE dhan_daily_candles (
  instrument_id BIGINT NOT NULL REFERENCES dhan_instruments(instrument_id),
  trade_date DATE NOT NULL,
  open_paise INTEGER NOT NULL,
  high_paise INTEGER NOT NULL,
  low_paise INTEGER NOT NULL,
  close_paise INTEGER NOT NULL,
  volume BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (instrument_id, trade_date)
);

CREATE INDEX idx_dhan_daily_instrument_date_desc
  ON dhan_daily_candles(instrument_id, trade_date DESC);

ALTER TABLE dhan_daily_candles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dhan_daily_candles_read_all" ON dhan_daily_candles;
CREATE POLICY "dhan_daily_candles_read_all" ON dhan_daily_candles FOR SELECT USING (true);
GRANT ALL ON TABLE dhan_daily_candles TO service_role;
