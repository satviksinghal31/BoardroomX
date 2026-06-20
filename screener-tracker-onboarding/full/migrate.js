/**
 * Schema migration — run once: node migrate.js
 * Requires SUPABASE_DB_URL in .env
 */
import pg from "pg";
import "dotenv/config";

const { Client } = pg;

const SQL = `
-- ── 1. Move is_consolidated + is_banking to stocks ──────────────────────
ALTER TABLE stocks
  ADD COLUMN IF NOT EXISTS is_consolidated BOOL,
  ADD COLUMN IF NOT EXISTS is_banking      BOOL;

UPDATE stocks s
SET is_consolidated = f.is_consolidated,
    is_banking      = f.is_banking
FROM financials f
WHERE s.symbol = f.symbol;

-- ── 2. Create results table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS results (
  symbol      TEXT NOT NULL,
  quarter     TEXT NOT NULL,
  data        JSONB,
  expected_at DATE,
  reported_at DATE,
  modified_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (symbol, quarter)
);
ALTER TABLE results DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.results TO anon, service_role;

-- ── 3. Migrate result_dates → results (if table exists) ─────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'result_dates') THEN
    INSERT INTO results (symbol, quarter, expected_at, reported_at)
    SELECT symbol, quarter, expected_at, reported_at FROM result_dates
    ON CONFLICT (symbol, quarter) DO UPDATE
      SET expected_at = EXCLUDED.expected_at,
          reported_at = EXCLUDED.reported_at;
    DROP TABLE result_dates;
    RAISE NOTICE 'Migrated result_dates → results';
  END IF;
END $$;

-- ── 4. Migrate quarters JSONB → results (one row per quarter) ────────────
INSERT INTO results (symbol, quarter, data, modified_at)
SELECT
  f.symbol,
  hdr AS quarter,
  (
    SELECT jsonb_object_agg(kv.key, kv.value->hdr)
    FROM jsonb_each(f.quarters->'data') AS kv
    WHERE (kv.value->hdr) IS NOT NULL
  ) AS data,
  now()
FROM financials f,
  jsonb_array_elements_text(f.quarters->'headers') AS hdr
WHERE f.quarters IS NOT NULL
ON CONFLICT (symbol, quarter) DO UPDATE
  SET data        = EXCLUDED.data,
      modified_at = now();

-- ── 5. Backfill Apollo if not already there ──────────────────────────────
INSERT INTO results (symbol, quarter, expected_at, reported_at)
VALUES ('APOLLOMICRO', 'Mar 2026', '2026-05-18', '2026-05-18')
ON CONFLICT (symbol, quarter) DO UPDATE
  SET expected_at = COALESCE(results.expected_at, EXCLUDED.expected_at),
      reported_at = COALESCE(results.reported_at, EXCLUDED.reported_at);

-- ── 6. Clean up financials ───────────────────────────────────────────────
ALTER TABLE financials
  DROP COLUMN IF EXISTS quarters,
  DROP COLUMN IF EXISTS is_consolidated,
  DROP COLUMN IF EXISTS is_banking,
  DROP COLUMN IF EXISTS next_board_date,
  DROP COLUMN IF EXISTS last_reported_quarter,
  DROP COLUMN IF EXISTS last_reported_at;
`;

async function main() {
  if (!process.env.SUPABASE_DB_URL || process.env.SUPABASE_DB_URL.includes("[YOUR-PASSWORD]")) {
    console.error("ERROR: Set SUPABASE_DB_URL in .env first.");
    console.error("  Supabase dashboard → Settings → Database → Connection string → URI");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await client.connect();
  console.log("Connected to database.");

  try {
    await client.query(SQL);
    console.log("✓ Migration complete.");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
