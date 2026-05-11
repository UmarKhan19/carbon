-- ============================================================
-- Auto-seed per-company sequence rows.
--
-- Older feature migrations that introduced their own readable IDs
-- (e.g. PL-00001 for pickingList, INC-00001 for productionIncident)
-- seeded the matching `"sequence"` rows once at migration time via
-- `INSERT … SELECT … FROM "company"`. Companies created AFTER those
-- migrations never got the rows, so the edge function helpers that
-- read the sequence (e.g. getNextPickingListId in pick/index.ts)
-- throw "Could not get … sequence" the first time anyone tries to
-- create one of those documents.
--
-- This migration:
--   1. Backfills any missing rows for all existing companies.
--   2. Adds an AFTER INSERT trigger on "company" that seeds the same
--      rows for every newly-created tenant.
--   3. Idempotent (ON CONFLICT DO NOTHING) and safe to re-run.
--
-- Adding new per-company sequences in the future: extend the body
-- of seed_company_sequences() below + add a backfill INSERT here.
--
-- Rollback: DROP TRIGGER "company_seed_sequences" ON "company";
--           DROP FUNCTION seed_company_sequences();
--           (Backfilled rows can be left in place — they're harmless.)
-- ============================================================

-- ─── Backfill ────────────────────────────────────────────────

INSERT INTO "sequence" ("table", "name", "prefix", "next", "size", "step", "companyId")
SELECT 'pickingList', 'Picking List', 'PL-', 1, 5, 1, c.id
FROM "company" c
ON CONFLICT ("table", "companyId") DO NOTHING;

INSERT INTO "sequence" ("table", "name", "prefix", "next", "size", "step", "companyId")
SELECT 'productionIncident', 'Production Incident', 'INC', 1, 5, 1, c.id
FROM "company" c
ON CONFLICT ("table", "companyId") DO NOTHING;

-- ─── Trigger function ────────────────────────────────────────
-- One function, all the sequences a new company needs. Each INSERT
-- has its own ON CONFLICT so adding a fresh entry won't break older
-- companies that already have some of the rows.

CREATE OR REPLACE FUNCTION seed_company_sequences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO "sequence" ("table", "name", "prefix", "next", "size", "step", "companyId")
  VALUES ('pickingList', 'Picking List', 'PL-', 1, 5, 1, NEW.id)
  ON CONFLICT ("table", "companyId") DO NOTHING;

  INSERT INTO "sequence" ("table", "name", "prefix", "next", "size", "step", "companyId")
  VALUES ('productionIncident', 'Production Incident', 'INC', 1, 5, 1, NEW.id)
  ON CONFLICT ("table", "companyId") DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "company_seed_sequences" ON "company";
CREATE TRIGGER "company_seed_sequences"
AFTER INSERT ON "company"
FOR EACH ROW
EXECUTE FUNCTION seed_company_sequences();
