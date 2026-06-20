-- Migration 007: Create agent_state table
-- Tracks per-agent state for catch-up windows and circuit-breaker logic.
-- Each agent does a simple UPSERT on every tick — no INSERT/UPDATE branching.
--
-- Agents: NSE_BULK (2-min tick), SCREENER (60s tick)
-- Fields:
--   last_successful_run   — advanced ONLY on full success (atomic guarantee)
--   consecutive_failures  — reset to 0 on success; circuit opens at 3
--   status                — 'idle' | 'running' | 'error'
--   last_summary          — jsonb of last tick stats

CREATE TABLE IF NOT EXISTS public.agent_state (
  agent                 text PRIMARY KEY,
  last_successful_run   timestamptz,
  last_attempt_at       timestamptz,
  consecutive_failures  int  NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'idle',
  last_error            text,
  last_summary          jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Seed rows so agents can always UPDATE (never need to INSERT first)
INSERT INTO public.agent_state (agent) VALUES ('NSE_BULK'), ('SCREENER')
ON CONFLICT (agent) DO NOTHING;

-- Index for the monitoring dashboard
CREATE INDEX IF NOT EXISTS agent_state_status_idx ON public.agent_state (status);

COMMENT ON TABLE public.agent_state IS
  'Per-agent runtime state — catch-up window tracking + circuit breaker';

-- Grant PostgREST roles access so the Supabase JS client (service_role key)
-- can read and write this table. Tables created via direct Postgres connection
-- (pg Client) don't get the automatic Supabase grants that the dashboard applies.
GRANT ALL ON public.agent_state TO service_role;
GRANT ALL ON public.agent_state TO authenticated;
GRANT SELECT ON public.agent_state TO anon;
