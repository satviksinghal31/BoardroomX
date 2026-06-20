-- ─────────────────────────────────────────────────────────────────────────────
-- 002: Grant service_role the DML privileges it needs on `watchlists`.
--
-- When CREATE TABLE runs through a direct Postgres connection (as opposed
-- to the Supabase Studio SQL editor), service_role is not auto-granted
-- SELECT/INSERT/UPDATE/DELETE on the new table. Server queries that use
-- the service_role API key then fail with "permission denied".
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT ALL ON TABLE public.watchlists TO postgres, service_role;

-- (Authenticated/anon are not directly queried by the client — all data flows
-- through the Node server which holds the service_role key — so we deliberately
-- do NOT grant SELECT/INSERT/etc to those roles. RLS + server middleware are
-- the only authorization layer the client sees.)
