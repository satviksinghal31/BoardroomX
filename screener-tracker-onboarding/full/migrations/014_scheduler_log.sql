-- Migration 014: Persistent scheduler log
--
-- Stores one row per _schedLog() call so cron history survives server restarts.
-- Replaces the in-memory _schedulerLog[] array (which wiped on every Railway deploy).
--
-- Indexed on ts DESC for fast "last 50" queries.
-- RLS OFF — service-role only, never exposed to users directly.

CREATE TABLE IF NOT EXISTS scheduler_log (
  id       BIGSERIAL      PRIMARY KEY,
  job      TEXT           NOT NULL,
  status   TEXT           NOT NULL,  -- 'scheduled' | 'running' | 'ok' | 'error'
  message  TEXT,
  ts       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduler_log_ts_idx  ON scheduler_log (ts DESC);
CREATE INDEX IF NOT EXISTS scheduler_log_job_idx ON scheduler_log (job, ts DESC);

-- Grant access to Supabase roles (required for REST API / JS client access)
GRANT ALL ON TABLE public.scheduler_log TO service_role;
GRANT ALL ON TABLE public.scheduler_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.scheduler_log_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.scheduler_log_id_seq TO authenticated;

-- RLS ON — service_role bypasses RLS by nature; no policy for authenticated
-- (this is a server-side-only internal table)
ALTER TABLE public.scheduler_log ENABLE ROW LEVEL SECURITY;
