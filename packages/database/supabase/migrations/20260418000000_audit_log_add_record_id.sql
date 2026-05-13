-- Add recordId column to per-company audit log tables so entries can be
-- filtered down to a specific row (not just the parent entity).
--
-- recordId = the raw PK of the row whose INSERT/UPDATE/DELETE produced the
--            entry (e.g. the child break's id for customerItemPriceOverrideBreak).
-- entityId = the business entity the row rolls up under (e.g. the parent
--            priceOverride id). Multiple audit rows can share one entityId.
--
-- For root tables, recordId == entityId. For child tables they differ.
-- Legacy rows (before this migration) are backfilled with recordId = entityId
-- so callers that select the new column don't get nulls on historical data.

-- 1. Backfill existing per-company audit log tables
DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'auditLog_%'
    AND table_name != 'auditLogArchive'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND information_schema.columns.table_name = tbl.table_name
        AND column_name = 'recordId'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN "recordId" TEXT', tbl.table_name);
      EXECUTE format('UPDATE %I SET "recordId" = "entityId" WHERE "recordId" IS NULL', tbl.table_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("recordId")',
        'idx_' || tbl.table_name || '_record', tbl.table_name);
    END IF;
  END LOOP;
END;
$$;

-- 2. Recreate create_audit_log_table so new per-company tables include recordId
CREATE OR REPLACE FUNCTION public.create_audit_log_table(p_company_id TEXT)
RETURNS VOID AS $$
DECLARE
  tbl_name TEXT;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    -- Table exists; ensure recordId column is present (for tables created before this migration)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND information_schema.columns.table_name = tbl_name
        AND column_name = 'recordId'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN "recordId" TEXT', tbl_name);
      EXECUTE format('UPDATE %I SET "recordId" = "entityId" WHERE "recordId" IS NULL', tbl_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("recordId")',
        'idx_' || tbl_name || '_record', tbl_name);
    END IF;
    RETURN;
  END IF;

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      "id" TEXT PRIMARY KEY DEFAULT id(''aud''),
      "tableName" TEXT NOT NULL,
      "entityType" TEXT NOT NULL,
      "entityId" TEXT NOT NULL,
      "recordId" TEXT,
      "operation" TEXT NOT NULL CHECK ("operation" IN (''INSERT'', ''UPDATE'', ''DELETE'')),
      "actorId" TEXT,
      "diff" JSONB,
      "metadata" JSONB,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  ', tbl_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("entityType", "entityId")',
    'idx_' || tbl_name || '_entity', tbl_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("tableName")',
    'idx_' || tbl_name || '_table', tbl_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("recordId")',
    'idx_' || tbl_name || '_record', tbl_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("actorId")',
    'idx_' || tbl_name || '_actor', tbl_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("createdAt" DESC)',
    'idx_' || tbl_name || '_created', tbl_name);

  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl_name);

  EXECUTE format('
    CREATE POLICY "audit_log_access" ON %I
    FOR ALL
    USING (true)
    WITH CHECK (true)
  ', tbl_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Recreate insert_audit_log_batch to persist recordId from each entry
CREATE OR REPLACE FUNCTION public.insert_audit_log_batch(
  p_company_id TEXT,
  p_entries JSONB[]
)
RETURNS INTEGER AS $$
DECLARE
  tbl_name TEXT;
  entry JSONB;
  inserted_count INTEGER := 0;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;

  PERFORM create_audit_log_table(p_company_id);

  FOREACH entry IN ARRAY p_entries
  LOOP
    EXECUTE format('
      INSERT INTO %I ("tableName", "entityType", "entityId", "recordId", "operation", "actorId", "diff", "metadata")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ', tbl_name)
    USING
      entry->>'tableName',
      entry->>'entityType',
      entry->>'entityId',
      entry->>'recordId',
      entry->>'operation',
      entry->>'actorId',
      CASE WHEN entry->'diff' = 'null'::jsonb THEN NULL ELSE entry->'diff' END,
      CASE WHEN entry->'metadata' = 'null'::jsonb THEN NULL ELSE entry->'metadata' END;

    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Recreate get_entity_audit_log with optional recordId filter and surface
--    the recordId column in the returned rows.
DROP FUNCTION IF EXISTS public.get_entity_audit_log(TEXT, TEXT, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.get_entity_audit_log(
  p_company_id TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_record_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  "id" TEXT,
  "tableName" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "recordId" TEXT,
  "operation" TEXT,
  "actorId" TEXT,
  "diff" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ
) AS $$
DECLARE
  tbl_name TEXT;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN;
  END IF;

  IF p_record_id IS NULL THEN
    RETURN QUERY EXECUTE format('
      SELECT "id", "tableName", "entityType", "entityId", "recordId", "operation", "actorId", "diff", "metadata", "createdAt"
      FROM %I
      WHERE "entityType" = $1 AND "entityId" = $2
      ORDER BY "createdAt" DESC
      LIMIT $3 OFFSET $4
    ', tbl_name)
    USING p_entity_type, p_entity_id, p_limit, p_offset;
  ELSE
    RETURN QUERY EXECUTE format('
      SELECT "id", "tableName", "entityType", "entityId", "recordId", "operation", "actorId", "diff", "metadata", "createdAt"
      FROM %I
      WHERE "entityType" = $1 AND "entityId" = $2 AND "recordId" = $3
      ORDER BY "createdAt" DESC
      LIMIT $4 OFFSET $5
    ', tbl_name)
    USING p_entity_type, p_entity_id, p_record_id, p_limit, p_offset;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
