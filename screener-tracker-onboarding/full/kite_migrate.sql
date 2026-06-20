-- ─────────────────────────────────────────────────────────────────────────────
--  BoardroomX — Kite Connect Migration (Phase 1: Read-Only)
--  Run once via Supabase SQL editor or:
--    psql $SUPABASE_DB_URL -f kite_migrate.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- kite_accounts: one Kite connection per user (enforced by UNIQUE on user_id)
CREATE TABLE IF NOT EXISTS kite_accounts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  api_key          TEXT        NOT NULL,
  api_secret       TEXT        NOT NULL,        -- stored encrypted (AES-256 at app layer)
  access_token     TEXT,                        -- refreshed on each Kite login
  kite_user_id     TEXT,                        -- Zerodha user ID e.g. "AB1234"
  kite_user_name   TEXT,
  connected_at     TIMESTAMPTZ DEFAULT now(),
  last_synced_at   TIMESTAMPTZ,
  token_expires_at TIMESTAMPTZ                  -- next 6:30 AM IST
);

ALTER TABLE kite_accounts ENABLE ROW LEVEL SECURITY;

-- Users can only see their own account
CREATE POLICY "Users see own kite account"
  ON kite_accounts FOR ALL
  USING (auth.uid() = user_id);

-- kite_holdings: cached snapshot of user's Kite portfolio
CREATE TABLE IF NOT EXISTS kite_holdings (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID          NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tradingsymbol  TEXT          NOT NULL,
  exchange       TEXT,                          -- NSE / BSE
  quantity       INTEGER,
  average_price  NUMERIC(12,4),
  last_price     NUMERIC(12,4),
  pnl            NUMERIC(12,4),
  synced_at      TIMESTAMPTZ   DEFAULT now(),
  UNIQUE (user_id, tradingsymbol)
);

ALTER TABLE kite_holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own holdings"
  ON kite_holdings FOR ALL
  USING (auth.uid() = user_id);

GRANT ALL ON kite_accounts, kite_holdings TO anon, service_role;
