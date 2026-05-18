-- ============================================================
-- Picking Lists — P0 Schema
-- ============================================================

-- ─── Enums ───────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "pickingListStatus" AS ENUM (
    'Draft',
    'Released',
    'In Progress',
    'Confirmed',
    'Cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "jobPickingStatus" AS ENUM (
    'Not Required',
    'Not Generated',
    'Generated',
    'In Progress',
    'Partial',
    'Complete'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Column additions to existing tables ─────────────────────

-- job: picking workflow columns
ALTER TABLE "job"
  ADD COLUMN IF NOT EXISTS "pickingStatus" "jobPickingStatus" NOT NULL DEFAULT 'Not Generated',
  ADD COLUMN IF NOT EXISTS "autoGeneratePickingList" BOOLEAN NOT NULL DEFAULT true;

-- companySettings: feature flags
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "usePickingLists" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "defaultAutoGeneratePickingList" BOOLEAN NOT NULL DEFAULT true;

-- methodMaterial: per-material opt-in
ALTER TABLE "methodMaterial"
  ADD COLUMN IF NOT EXISTS "requiresPicking" BOOLEAN NOT NULL DEFAULT true;

-- jobMaterial: per-line opt-in (copied from methodMaterial at job creation)
ALTER TABLE "jobMaterial"
  ADD COLUMN IF NOT EXISTS "requiresPicking" BOOLEAN NOT NULL DEFAULT true;

-- workCenter: default line-side shelf
ALTER TABLE "workCenter"
  ADD COLUMN IF NOT EXISTS "defaultStorageUnitId" TEXT
    REFERENCES "storageUnit"("id") ON DELETE SET NULL;

-- ─── pickingList ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "pickingList" (
  "id"                      TEXT        NOT NULL DEFAULT id('pl'),
  "pickingListId"           TEXT        NOT NULL,
  "jobId"                   TEXT        NOT NULL,
  "locationId"              TEXT        NOT NULL,
  "destinationStorageUnitId" TEXT,
  "status"                  "pickingListStatus" NOT NULL DEFAULT 'Draft',
  "assignee"                TEXT,
  "dueDate"                 TIMESTAMPTZ,
  "confirmedAt"             TIMESTAMPTZ,
  "confirmedBy"             TEXT,
  "shortageReason"          TEXT,
  "notes"                   JSONB        NOT NULL DEFAULT '{}',
  "customFields"            JSONB,
  "companyId"               TEXT        NOT NULL,
  "createdAt"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdBy"               TEXT        NOT NULL,
  "updatedAt"               TIMESTAMPTZ,
  "updatedBy"               TEXT,

  CONSTRAINT "pickingList_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "pickingList_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "pickingList_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE,
  CONSTRAINT "pickingList_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingList_destinationStorageUnitId_fkey"
    FOREIGN KEY ("destinationStorageUnitId") REFERENCES "storageUnit"("id") ON DELETE SET NULL,
  CONSTRAINT "pickingList_assignee_fkey"
    FOREIGN KEY ("assignee") REFERENCES "user"("id") ON DELETE SET NULL,
  CONSTRAINT "pickingList_confirmedBy_fkey"
    FOREIGN KEY ("confirmedBy") REFERENCES "user"("id") ON DELETE SET NULL,
  CONSTRAINT "pickingList_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "pickingList_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

-- Only one active (non-Confirmed/Cancelled) PL per job + location
CREATE UNIQUE INDEX IF NOT EXISTS "pickingList_jobId_locationId_active_key"
  ON "pickingList" ("jobId", "locationId", "companyId")
  WHERE "status" NOT IN ('Confirmed', 'Cancelled');

CREATE INDEX IF NOT EXISTS "pickingList_companyId_idx"   ON "pickingList" ("companyId");
CREATE INDEX IF NOT EXISTS "pickingList_jobId_idx"       ON "pickingList" ("jobId");
CREATE INDEX IF NOT EXISTS "pickingList_locationId_idx"  ON "pickingList" ("locationId");
CREATE INDEX IF NOT EXISTS "pickingList_status_idx"      ON "pickingList" ("status");
CREATE INDEX IF NOT EXISTS "pickingList_assignee_idx"    ON "pickingList" ("assignee");

-- ─── pickingListLine ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "pickingListLine" (
  "id"                       TEXT        NOT NULL DEFAULT id('pll'),
  "pickingListId"            TEXT        NOT NULL,
  "jobMaterialId"            TEXT        NOT NULL,
  "itemId"                   TEXT        NOT NULL,
  "storageUnitId"            TEXT,
  "destinationStorageUnitId" TEXT,
  "pickedTrackedEntityId"    TEXT,
  "estimatedQuantity"        NUMERIC     NOT NULL DEFAULT 0,
  "adjustedQuantity"         NUMERIC,
  "pickedQuantity"           NUMERIC     NOT NULL DEFAULT 0,
  "overPickQuantity"         NUMERIC     GENERATED ALWAYS AS (
    GREATEST("pickedQuantity" - COALESCE("adjustedQuantity","estimatedQuantity"), 0)
  ) STORED,
  "outstandingQuantity"      NUMERIC     GENERATED ALWAYS AS (
    GREATEST(COALESCE("adjustedQuantity","estimatedQuantity") - "pickedQuantity", 0)
  ) STORED,
  "requiresBatchTracking"    BOOLEAN     NOT NULL DEFAULT false,
  "requiresSerialTracking"   BOOLEAN     NOT NULL DEFAULT false,
  "unitOfMeasureCode"        TEXT,
  "notes"                    JSONB       NOT NULL DEFAULT '{}',
  "companyId"                TEXT        NOT NULL,
  "createdAt"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdBy"                TEXT        NOT NULL,
  "updatedAt"                TIMESTAMPTZ,
  "updatedBy"                TEXT,

  CONSTRAINT "pickingListLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "pickingListLine_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "pickingListLine_pickingListId_fkey"
    FOREIGN KEY ("pickingListId", "companyId") REFERENCES "pickingList"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "pickingListLine_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingListLine_storageUnitId_fkey"
    FOREIGN KEY ("storageUnitId") REFERENCES "storageUnit"("id") ON DELETE SET NULL,
  CONSTRAINT "pickingListLine_destinationStorageUnitId_fkey"
    FOREIGN KEY ("destinationStorageUnitId") REFERENCES "storageUnit"("id") ON DELETE SET NULL,
  CONSTRAINT "pickingListLine_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "pickingListLine_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX IF NOT EXISTS "pickingListLine_companyId_idx"    ON "pickingListLine" ("companyId");
CREATE INDEX IF NOT EXISTS "pickingListLine_pickingListId_idx" ON "pickingListLine" ("pickingListId");
CREATE INDEX IF NOT EXISTS "pickingListLine_itemId_idx"        ON "pickingListLine" ("itemId");
CREATE INDEX IF NOT EXISTS "pickingListLine_storageUnitId_idx" ON "pickingListLine" ("storageUnitId");

-- ─── Sequence entry for PL-XXXXX readable IDs ────────────────

INSERT INTO "sequence" ("table", "name", "prefix", "next", "size", "step", "companyId")
SELECT 'pickingList', 'Picking List', 'PL-', 1, 5, 1, id
FROM "company"
ON CONFLICT DO NOTHING;

-- ─── RLS ─────────────────────────────────────────────────────

ALTER TABLE "pickingList" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "pickingList";
CREATE POLICY "SELECT" ON "pickingList"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('inventory_view'))::text[]
    )
  );

DROP POLICY IF EXISTS "INSERT" ON "pickingList";
CREATE POLICY "INSERT" ON "pickingList"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
    )
  );

DROP POLICY IF EXISTS "UPDATE" ON "pickingList";
CREATE POLICY "UPDATE" ON "pickingList"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
    )
  );

DROP POLICY IF EXISTS "DELETE" ON "pickingList";
CREATE POLICY "DELETE" ON "pickingList"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
    )
  );

ALTER TABLE "pickingListLine" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "pickingListLine";
CREATE POLICY "SELECT" ON "pickingListLine"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('inventory_view'))::text[]
    )
  );

DROP POLICY IF EXISTS "INSERT" ON "pickingListLine";
CREATE POLICY "INSERT" ON "pickingListLine"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
    )
  );

DROP POLICY IF EXISTS "UPDATE" ON "pickingListLine";
CREATE POLICY "UPDATE" ON "pickingListLine"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
    )
  );

DROP POLICY IF EXISTS "DELETE" ON "pickingListLine";
CREATE POLICY "DELETE" ON "pickingListLine"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
    )
  );

-- ─── generate_picking_list_lines RPC ─────────────────────────
-- Called by the edge function after creating the pickingList header.
-- Creates one line per jobMaterial that needs picking, using the
-- preferred storageUnitId from jobMaterial. Multiple shelves per
-- material are NOT split at DB level — the edge function handles that.

CREATE OR REPLACE FUNCTION generate_picking_list_lines(
  p_picking_list_id TEXT,
  p_job_id          TEXT,
  p_company_id      TEXT,
  p_user_id         TEXT
)
RETURNS SETOF "pickingListLine"
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pl  "pickingList"%ROWTYPE;
BEGIN
  SELECT * INTO v_pl
  FROM "pickingList"
  WHERE id = p_picking_list_id AND "companyId" = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picking list % not found', p_picking_list_id;
  END IF;

  -- Delete any existing lines (idempotent regeneration)
  DELETE FROM "pickingListLine"
  WHERE "pickingListId" = p_picking_list_id AND "companyId" = p_company_id;

  -- Insert one line per qualifying jobMaterial
  INSERT INTO "pickingListLine" (
    "pickingListId",
    "jobMaterialId",
    "itemId",
    "storageUnitId",
    "destinationStorageUnitId",
    "estimatedQuantity",
    "requiresBatchTracking",
    "requiresSerialTracking",
    "unitOfMeasureCode",
    "companyId",
    "createdBy"
  )
  SELECT
    p_picking_list_id,
    jm.id,
    jm."itemId",
    jm."storageUnitId",
    -- Destination: workcenter default → PL-level fallback → NULL
    COALESCE(wc."defaultStorageUnitId", v_pl."destinationStorageUnitId"),
    jm."quantityToIssue",
    COALESCE(i."itemTrackingType" = 'Batch', false),
    COALESCE(i."itemTrackingType" = 'Serial', false),
    jm."unitOfMeasureCode",
    p_company_id,
    p_user_id
  FROM "jobMaterial" jm
  JOIN "item" i ON i.id = jm."itemId"
  LEFT JOIN "jobOperation" jo ON jo.id = jm."jobOperationId"
  LEFT JOIN "workCenter" wc ON wc.id = jo."workCenterId"
  WHERE jm."jobId" = p_job_id
    AND jm."companyId" = p_company_id
    AND jm."methodType" = 'Pull from Inventory'
    AND jm."quantityToIssue" > 0
    AND jm."requiresPicking" = true;

  RETURN QUERY
  SELECT * FROM "pickingListLine"
  WHERE "pickingListId" = p_picking_list_id AND "companyId" = p_company_id;
END;
$$;

-- ─── Trigger: recompute job.pickingStatus ────────────────────

CREATE OR REPLACE FUNCTION compute_job_picking_status(p_job_id TEXT, p_company_id TEXT)
RETURNS "jobPickingStatus"
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_has_picking_materials BOOLEAN;
  v_active_count          INTEGER;
  v_confirmed_count       INTEGER;
  v_outstanding_total     NUMERIC;
BEGIN
  -- Check if any Pull-from-Inventory materials require picking
  SELECT EXISTS(
    SELECT 1 FROM "jobMaterial"
    WHERE "jobId" = p_job_id
      AND "companyId" = p_company_id
      AND "methodType" = 'Pull from Inventory'
      AND "quantityToIssue" > 0
      AND "requiresPicking" = true
  ) INTO v_has_picking_materials;

  IF NOT v_has_picking_materials THEN
    RETURN 'Not Required';
  END IF;

  SELECT COUNT(*) INTO v_active_count
  FROM "pickingList"
  WHERE "jobId" = p_job_id AND "companyId" = p_company_id
    AND "status" NOT IN ('Cancelled');

  IF v_active_count = 0 THEN
    RETURN 'Not Generated';
  END IF;

  -- Sum outstanding across all non-Cancelled, non-Confirmed PLs
  SELECT COALESCE(SUM(pll."outstandingQuantity"), 0)
  INTO v_outstanding_total
  FROM "pickingListLine" pll
  JOIN "pickingList" pl ON pl.id = pll."pickingListId"
  WHERE pl."jobId" = p_job_id
    AND pl."companyId" = p_company_id
    AND pl."status" NOT IN ('Cancelled');

  -- Count confirmed PLs
  SELECT COUNT(*) INTO v_confirmed_count
  FROM "pickingList"
  WHERE "jobId" = p_job_id AND "companyId" = p_company_id
    AND "status" = 'Confirmed';

  IF v_outstanding_total = 0 AND v_confirmed_count > 0 THEN
    RETURN 'Complete';
  END IF;

  IF v_confirmed_count > 0 AND v_outstanding_total > 0 THEN
    RETURN 'Partial';
  END IF;

  -- Check if any line has been touched (pickedQuantity > 0)
  IF EXISTS(
    SELECT 1 FROM "pickingListLine" pll
    JOIN "pickingList" pl ON pl.id = pll."pickingListId"
    WHERE pl."jobId" = p_job_id AND pl."companyId" = p_company_id
      AND pl."status" NOT IN ('Cancelled')
      AND pll."pickedQuantity" > 0
  ) THEN
    RETURN 'In Progress';
  END IF;

  RETURN 'Generated';
END;
$$;

CREATE OR REPLACE FUNCTION trigger_update_job_picking_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id    TEXT;
  v_company_id TEXT;
  v_new_status "jobPickingStatus";
BEGIN
  IF TG_TABLE_NAME = 'pickingList' THEN
    v_job_id     := COALESCE(NEW."jobId", OLD."jobId");
    v_company_id := COALESCE(NEW."companyId", OLD."companyId");
  ELSIF TG_TABLE_NAME = 'pickingListLine' THEN
    SELECT pl."jobId", pl."companyId"
    INTO v_job_id, v_company_id
    FROM "pickingList" pl
    WHERE pl.id = COALESCE(NEW."pickingListId", OLD."pickingListId");
  END IF;

  v_new_status := compute_job_picking_status(v_job_id, v_company_id);

  UPDATE "job"
  SET "pickingStatus" = v_new_status
  WHERE id = v_job_id AND "companyId" = v_company_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS "pickingList_update_job_picking_status" ON "pickingList";
CREATE TRIGGER "pickingList_update_job_picking_status"
  AFTER INSERT OR UPDATE OR DELETE ON "pickingList"
  FOR EACH ROW EXECUTE FUNCTION trigger_update_job_picking_status();

DROP TRIGGER IF EXISTS "pickingListLine_update_job_picking_status" ON "pickingListLine";
CREATE TRIGGER "pickingListLine_update_job_picking_status"
  AFTER INSERT OR UPDATE OR DELETE ON "pickingListLine"
  FOR EACH ROW EXECUTE FUNCTION trigger_update_job_picking_status();
