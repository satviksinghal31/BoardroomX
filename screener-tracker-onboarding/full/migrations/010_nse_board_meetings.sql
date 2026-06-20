-- Migration 010: NSE Board Meetings table + cron run state
-- Stores filtered, classified board meeting intimations from NSE.
-- Primary key is the business-unique key (symbol+date+purpose+desc).
-- No updates — identical unique_key rows are silently skipped on conflict.

-- ── Main board meetings table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nse_board_meetings (
  unique_key         text        PRIMARY KEY,
  bm_symbol          text        NOT NULL,
  bm_date            text        NOT NULL,   -- "29-May-2026" as received from NSE
  bm_purpose         text        NOT NULL,
  bm_desc            text        NOT NULL,
  bm_timestamp       text,                   -- "30-Apr-2026 13:03:54"
  sm_name            text,
  sm_isin            text,
  sm_industry        text,                   -- normalized from NSE's sm_indusrty typo
  attachment         text,
  ixbrl              text,
  sys_time           text,                   -- NSE's sysTime field
  cluster            text,                   -- human label e.g. "Board Meeting - Earnings / Financial Results"
  financial_results  boolean     NOT NULL DEFAULT false,
  dividend           boolean     NOT NULL DEFAULT false,
  fund_raising       boolean     NOT NULL DEFAULT false,
  buyback            boolean     NOT NULL DEFAULT false,
  bonus              boolean     NOT NULL DEFAULT false,
  stock_split        boolean     NOT NULL DEFAULT false,
  rescheduled        boolean     NOT NULL DEFAULT false,
  source_payload     jsonb,                  -- original NSE row, preserved for debugging
  ingested_at        timestamptz NOT NULL DEFAULT now()
);

-- Indexes for God Mode event feed queries
CREATE INDEX IF NOT EXISTS nse_bm_symbol_idx     ON public.nse_board_meetings (bm_symbol);
CREATE INDEX IF NOT EXISTS nse_bm_date_idx       ON public.nse_board_meetings (bm_date);
CREATE INDEX IF NOT EXISTS nse_bm_cluster_idx    ON public.nse_board_meetings (cluster);
CREATE INDEX IF NOT EXISTS nse_bm_ingested_idx   ON public.nse_board_meetings (ingested_at DESC);

GRANT ALL ON public.nse_board_meetings TO service_role;
GRANT SELECT ON public.nse_board_meetings TO authenticated, anon;

-- ── Cron run state (single row, upserted on every run) ───────────────────────
CREATE TABLE IF NOT EXISTS public.nse_bm_runs (
  id              int         PRIMARY KEY DEFAULT 1,  -- always row id=1
  last_run_at     timestamptz,
  next_run_at     timestamptz,
  last_status     text,        -- "ok" | "error"
  last_fetched    int,         -- total rows returned by NSE endpoint
  last_kept       int,         -- rows passing purpose filter
  last_new        int,         -- net new inserts (unique_key not already in DB)
  last_skipped    int,         -- skipped (unique_key already existed)
  last_error      text,
  total_runs      int          NOT NULL DEFAULT 0,
  total_inserted  int          NOT NULL DEFAULT 0
);

-- Seed the single state row so upsert always finds it
INSERT INTO public.nse_bm_runs (id) VALUES (1) ON CONFLICT DO NOTHING;

GRANT ALL ON public.nse_bm_runs TO service_role;
GRANT SELECT ON public.nse_bm_runs TO authenticated, anon;
