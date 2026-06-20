-- Migration 015: Screener annual financials + polite fetch queue

BEGIN;

CREATE TABLE IF NOT EXISTS public.annual_fundamentals (
  symbol                  text        NOT NULL,
  fiscal_year             text        NOT NULL,
  period_order            integer     NOT NULL DEFAULT 0,
  sales                   numeric,
  revenue                 numeric,
  expenses                numeric,
  operating_profit        numeric,
  opm_percent             numeric,
  other_income            numeric,
  interest                numeric,
  depreciation            numeric,
  profit_before_tax       numeric,
  tax_percent             numeric,
  net_profit              numeric,
  eps                     numeric,
  dividend_payout_percent numeric,
  raw_json                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source                  text        NOT NULL DEFAULT 'screener',
  source_url              text,
  is_consolidated         boolean,
  parser_version          text        NOT NULL DEFAULT 'screener-annuals-v1',
  fetched_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, fiscal_year)
);

CREATE TABLE IF NOT EXISTS public.annual_ratios (
  symbol                  text        NOT NULL,
  fiscal_year             text        NOT NULL,
  period_order            integer     NOT NULL DEFAULT 0,
  roce_percent            numeric,
  roe_percent             numeric,
  debt_to_equity          numeric,
  book_value              numeric,
  pe                      numeric,
  market_cap              numeric,
  working_capital_days    numeric,
  cash_conversion_cycle   numeric,
  inventory_days          numeric,
  debtor_days             numeric,
  raw_json                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source                  text        NOT NULL DEFAULT 'screener',
  source_url              text,
  fetched_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, fiscal_year)
);

CREATE TABLE IF NOT EXISTS public.annual_balance_sheet (
  symbol            text        NOT NULL,
  fiscal_year       text        NOT NULL,
  period_order      integer     NOT NULL DEFAULT 0,
  equity_capital    numeric,
  reserves          numeric,
  borrowings        numeric,
  other_liabilities numeric,
  total_liabilities numeric,
  fixed_assets      numeric,
  cwip              numeric,
  investments       numeric,
  other_assets      numeric,
  total_assets      numeric,
  raw_json          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source            text        NOT NULL DEFAULT 'screener',
  source_url        text,
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, fiscal_year)
);

CREATE TABLE IF NOT EXISTS public.annual_cash_flows (
  symbol                         text        NOT NULL,
  fiscal_year                    text        NOT NULL,
  period_order                   integer     NOT NULL DEFAULT 0,
  cash_from_operating_activity   numeric,
  cash_from_investing_activity   numeric,
  cash_from_financing_activity   numeric,
  net_cash_flow                  numeric,
  raw_json                       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source                         text        NOT NULL DEFAULT 'screener',
  source_url                     text,
  fetched_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, fiscal_year)
);

CREATE TABLE IF NOT EXISTS public.shareholding_pattern (
  symbol                 text        NOT NULL,
  period                 text        NOT NULL,
  period_order           integer     NOT NULL DEFAULT 0,
  promoters_percent      numeric,
  fii_percent            numeric,
  dii_percent            numeric,
  public_percent         numeric,
  government_percent     numeric,
  others_percent         numeric,
  pledged_percent        numeric,
  number_of_shareholders numeric,
  raw_json               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source                 text        NOT NULL DEFAULT 'screener',
  source_url             text,
  fetched_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, period)
);

CREATE TABLE IF NOT EXISTS public.screener_fetch_queue (
  symbol              text        PRIMARY KEY,
  company_name        text,
  status              text        NOT NULL DEFAULT 'pending',
  priority            integer     NOT NULL DEFAULT 0,
  attempts            integer     NOT NULL DEFAULT 0,
  last_attempt_at     timestamptz,
  last_success_at     timestamptz,
  next_attempt_at     timestamptz,
  last_error          text,
  history_years_count integer     NOT NULL DEFAULT 0,
  history_complete    boolean     NOT NULL DEFAULT false,
  latest_period       text,
  latest_fy_available boolean     NOT NULL DEFAULT false,
  latest_fy_missing   boolean     NOT NULL DEFAULT false,
  source_url          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screener_fetch_queue_status_chk CHECK (
    status IN ('pending', 'fetching', 'complete', 'retry', 'failed', 'skipped')
  )
);

CREATE TABLE IF NOT EXISTS public.screener_fetch_runs (
  id             bigserial   PRIMARY KEY,
  symbol         text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  status         text        NOT NULL,
  message        text,
  duration_ms    integer,
  rows_written   integer     NOT NULL DEFAULT 0,
  parser_version text        NOT NULL DEFAULT 'screener-annuals-v1'
);

CREATE INDEX IF NOT EXISTS screener_fetch_queue_status_idx
  ON public.screener_fetch_queue (status, next_attempt_at, priority DESC, updated_at);
CREATE INDEX IF NOT EXISTS annual_fundamentals_symbol_order_idx
  ON public.annual_fundamentals (symbol, period_order);
CREATE INDEX IF NOT EXISTS annual_ratios_symbol_order_idx
  ON public.annual_ratios (symbol, period_order);
CREATE INDEX IF NOT EXISTS shareholding_pattern_symbol_order_idx
  ON public.shareholding_pattern (symbol, period_order);
CREATE INDEX IF NOT EXISTS screener_fetch_runs_symbol_started_idx
  ON public.screener_fetch_runs (symbol, started_at DESC);

ALTER TABLE public.annual_fundamentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annual_ratios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annual_balance_sheet ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annual_cash_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shareholding_pattern ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screener_fetch_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screener_fetch_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY annual_fundamentals_select_authenticated ON public.annual_fundamentals
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY annual_ratios_select_authenticated ON public.annual_ratios
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY annual_balance_sheet_select_authenticated ON public.annual_balance_sheet
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY annual_cash_flows_select_authenticated ON public.annual_cash_flows
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY shareholding_pattern_select_authenticated ON public.shareholding_pattern
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY screener_fetch_queue_select_authenticated ON public.screener_fetch_queue
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY screener_fetch_runs_select_authenticated ON public.screener_fetch_runs
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT ALL ON public.annual_fundamentals TO service_role;
GRANT ALL ON public.annual_ratios TO service_role;
GRANT ALL ON public.annual_balance_sheet TO service_role;
GRANT ALL ON public.annual_cash_flows TO service_role;
GRANT ALL ON public.shareholding_pattern TO service_role;
GRANT ALL ON public.screener_fetch_queue TO service_role;
GRANT ALL ON public.screener_fetch_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.screener_fetch_runs_id_seq TO service_role;

GRANT SELECT ON public.annual_fundamentals TO authenticated;
GRANT SELECT ON public.annual_ratios TO authenticated;
GRANT SELECT ON public.annual_balance_sheet TO authenticated;
GRANT SELECT ON public.annual_cash_flows TO authenticated;
GRANT SELECT ON public.shareholding_pattern TO authenticated;
GRANT SELECT ON public.screener_fetch_queue TO authenticated;
GRANT SELECT ON public.screener_fetch_runs TO authenticated;

COMMIT;
