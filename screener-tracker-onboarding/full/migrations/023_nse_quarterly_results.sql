BEGIN;

CREATE TABLE public.quarterly_results (
  nse_seq_id text PRIMARY KEY,
  symbol text NOT NULL REFERENCES public.dhan_instruments(symbol),
  period_end date NOT NULL,
  basis text NOT NULL CHECK (basis IN ('consolidated', 'standalone')),
  taxonomy text NOT NULL CHECK (taxonomy IN ('indas', 'banking')),
  source_xbrl_url text NOT NULL,
  reported_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'processed', 'failed')),
  revenue_inr numeric,
  calculated_ebitda_inr numeric,
  net_profit_inr numeric,
  ebitda_components_inr jsonb,
  last_attempt_at timestamptz,
  attempt_count smallint NOT NULL DEFAULT 0
    CHECK (attempt_count BETWEEN 0 AND 3),
  next_retry_at timestamptz,
  error text,
  superseded_by_seq_id text REFERENCES public.quarterly_results(nse_seq_id),
  CHECK (superseded_by_seq_id IS NULL OR superseded_by_seq_id <> nse_seq_id)
);

CREATE INDEX quarterly_results_symbol_period_basis_idx
  ON public.quarterly_results (symbol, period_end, basis);

CREATE INDEX quarterly_results_worker_idx
  ON public.quarterly_results (status, next_retry_at, reported_at);

ALTER TABLE public.quarterly_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.quarterly_results FROM anon, authenticated;
GRANT ALL ON public.quarterly_results TO service_role;

COMMIT;
