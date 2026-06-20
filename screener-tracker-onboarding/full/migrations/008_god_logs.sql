-- Migration 008: Persist god-mode log entries to DB
-- godLog() previously wrote only to an in-memory ring buffer (lost on every
-- server restart / deploy).  This table gives the God Mode feed a durable
-- 7-day history that survives restarts.
--
-- Sources: NSE_TICK | SCREENER
-- Types:   TICK_OK | TICK_FAIL | CIRCUIT_OPEN | SCRAPED | NOOP | ERROR

CREATE TABLE IF NOT EXISTS public.god_logs (
  id         bigserial    PRIMARY KEY,
  ts         timestamptz  NOT NULL DEFAULT now(),
  source     text         NOT NULL,   -- 'NSE_TICK' | 'SCREENER'
  symbol     text,
  type       text         NOT NULL,
  message    text,
  raw        jsonb,
  created_at timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS god_logs_source_ts_idx
  ON public.god_logs (source, ts DESC);

CREATE INDEX IF NOT EXISTS god_logs_symbol_ts_idx
  ON public.god_logs (symbol, ts DESC)
  WHERE symbol IS NOT NULL;

CREATE INDEX IF NOT EXISTS god_logs_ts_idx
  ON public.god_logs (ts DESC);

COMMENT ON TABLE public.god_logs IS
  'Durable god-mode event log — 7-day rolling window; cleared by server cleanup job';

-- PostgREST role grants (tables created via direct pg client need explicit grants)
GRANT ALL   ON public.god_logs TO service_role;
GRANT ALL   ON public.god_logs TO authenticated;
GRANT SELECT ON public.god_logs TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.god_logs_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.god_logs_id_seq TO authenticated;
