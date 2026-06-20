-- ─────────────────────────────────────────────────────────────────────────────
-- BoardroomX M1: Multi-tenant migration
--
-- Design:
--   stocks / financials / results stay GLOBAL (symbol-level market data).
--   New `watchlists` table links users to symbols they track (per-user state).
--   RLS:
--     • watchlists      → users may read/write only their own rows.
--     • stocks/fin/res  → authenticated users may READ all rows (read-only catalog).
--                         Writes only via service_role (background scraper).
--     • service_role    → bypasses RLS implicitly; explicit policies added too.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. watchlists table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.watchlists (
  user_id    uuid        NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  symbol     text        NOT NULL REFERENCES public.stocks(symbol) ON DELETE CASCADE,
  position   integer     NOT NULL DEFAULT 0,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, symbol)
);

CREATE INDEX IF NOT EXISTS watchlists_user_position_idx
  ON public.watchlists (user_id, position);

-- ── 2. Enable RLS on watchlists ─────────────────────────────────────────────
ALTER TABLE public.watchlists ENABLE ROW LEVEL SECURITY;

-- ── 3. RLS policies on watchlists (users see/manage only their rows) ────────
DROP POLICY IF EXISTS watchlists_select_own ON public.watchlists;
CREATE POLICY watchlists_select_own ON public.watchlists
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS watchlists_insert_own ON public.watchlists;
CREATE POLICY watchlists_insert_own ON public.watchlists
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS watchlists_update_own ON public.watchlists;
CREATE POLICY watchlists_update_own ON public.watchlists
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS watchlists_delete_own ON public.watchlists;
CREATE POLICY watchlists_delete_own ON public.watchlists
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS watchlists_service_all ON public.watchlists;
CREATE POLICY watchlists_service_all ON public.watchlists
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 4. Authenticated users may READ the global market data tables ───────────
-- stocks
DROP POLICY IF EXISTS stocks_select_authenticated ON public.stocks;
CREATE POLICY stocks_select_authenticated ON public.stocks
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS stocks_service_all ON public.stocks;
CREATE POLICY stocks_service_all ON public.stocks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- financials
DROP POLICY IF EXISTS financials_select_authenticated ON public.financials;
CREATE POLICY financials_select_authenticated ON public.financials
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS financials_service_all ON public.financials;
CREATE POLICY financials_service_all ON public.financials
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- results — enable RLS (was disabled) and add same policies
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS results_select_authenticated ON public.results;
CREATE POLICY results_select_authenticated ON public.results
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS results_service_all ON public.results;
CREATE POLICY results_service_all ON public.results
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 5. Seed existing 14 stocks → dev account (satviksinghal31@gmail.com) ────
INSERT INTO public.watchlists (user_id, symbol, position, added_at)
SELECT
  '3ff61274-0e87-47be-a8eb-f9216429b864'::uuid,
  symbol,
  ROW_NUMBER() OVER (ORDER BY symbol) - 1,
  now()
FROM public.stocks
ON CONFLICT (user_id, symbol) DO NOTHING;

COMMIT;
