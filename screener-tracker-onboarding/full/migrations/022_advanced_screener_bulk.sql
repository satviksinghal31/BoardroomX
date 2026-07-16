-- Migration 022: Advanced Screener snapshots + bulk refresh progress

BEGIN;

CREATE TABLE IF NOT EXISTS public.screener_company_snapshots (
  symbol                    text        NOT NULL,
  statement_type            text        NOT NULL DEFAULT 'consolidated',
  company_name              text,
  source_url                text,
  is_consolidated           boolean     NOT NULL DEFAULT false,
  parser_version            text,
  section_status            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  latest_profit_loss_period text,
  latest_quarter_period     text,
  payload                   jsonb       NOT NULL,
  scraped_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, statement_type),
  CONSTRAINT screener_company_snapshots_statement_chk
    CHECK (statement_type IN ('consolidated', 'standalone'))
);

CREATE TABLE IF NOT EXISTS public.screener_bulk_runs (
  id              bigserial   PRIMARY KEY,
  status          text        NOT NULL DEFAULT 'pending',
  statement_type  text        NOT NULL DEFAULT 'consolidated',
  delay_seconds   numeric     NOT NULL DEFAULT 1,
  sections        text[]      NOT NULL DEFAULT '{}'::text[],
  requested_total integer     NOT NULL DEFAULT 0,
  completed_count integer     NOT NULL DEFAULT 0,
  failed_count    integer     NOT NULL DEFAULT 0,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screener_bulk_runs_status_chk
    CHECK (status IN ('pending', 'running', 'complete', 'partial', 'failed')),
  CONSTRAINT screener_bulk_runs_statement_chk
    CHECK (statement_type IN ('consolidated', 'standalone')),
  CONSTRAINT screener_bulk_runs_delay_chk
    CHECK (delay_seconds >= 0)
);

CREATE TABLE IF NOT EXISTS public.screener_bulk_run_items (
  run_id              bigint      NOT NULL REFERENCES public.screener_bulk_runs(id) ON DELETE CASCADE,
  symbol              text        NOT NULL,
  status              text        NOT NULL DEFAULT 'pending',
  attempts            integer     NOT NULL DEFAULT 0,
  error               text,
  started_at          timestamptz,
  finished_at         timestamptz,
  snapshot_updated_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, symbol),
  CONSTRAINT screener_bulk_run_items_status_chk
    CHECK (status IN ('pending', 'running', 'complete', 'retry', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS screener_company_snapshots_updated_idx
  ON public.screener_company_snapshots (updated_at DESC);
CREATE INDEX IF NOT EXISTS screener_company_snapshots_latest_pnl_idx
  ON public.screener_company_snapshots (latest_profit_loss_period);
CREATE INDEX IF NOT EXISTS screener_bulk_runs_status_created_idx
  ON public.screener_bulk_runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS screener_bulk_run_items_status_idx
  ON public.screener_bulk_run_items (run_id, status, created_at);
CREATE INDEX IF NOT EXISTS screener_bulk_run_items_symbol_idx
  ON public.screener_bulk_run_items (symbol, created_at DESC);

ALTER TABLE public.screener_company_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screener_bulk_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screener_bulk_run_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY screener_company_snapshots_select_authenticated
    ON public.screener_company_snapshots
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY screener_bulk_runs_select_authenticated
    ON public.screener_bulk_runs
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY screener_bulk_run_items_select_authenticated
    ON public.screener_bulk_run_items
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT ALL ON public.screener_company_snapshots TO service_role;
GRANT ALL ON public.screener_bulk_runs TO service_role;
GRANT ALL ON public.screener_bulk_run_items TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.screener_bulk_runs_id_seq TO service_role;

GRANT SELECT ON public.screener_company_snapshots TO authenticated;
GRANT SELECT ON public.screener_bulk_runs TO authenticated;
GRANT SELECT ON public.screener_bulk_run_items TO authenticated;

COMMIT;
