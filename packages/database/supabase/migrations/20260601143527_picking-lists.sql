-- ============================================================================
-- Picking Lists
-- Tables, enums, views, functions, indexes, sequences, custom fields, and RLS
-- for the picking list feature.
-- ============================================================================

-- Enums

CREATE TYPE "pickingListStatus" AS ENUM (
  'Draft',
  'In Progress',
  'Completed',
  'Cancelled'
);

CREATE TYPE "pickingListLineStatus" AS ENUM (
  'Pending',
  'Picked',
  'Short',
  'Cancelled'
);

-- ============================================================================
-- pickingList table
-- ============================================================================

CREATE TABLE "pickingList" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "pickingListId" TEXT NOT NULL,
  "status" "pickingListStatus" NOT NULL DEFAULT 'Draft',
  "locationId" TEXT NOT NULL,
  "assignee" TEXT,
  "dueDate" DATE,
  "notes" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "pickingList_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pickingList_pickingListId_key" UNIQUE ("pickingListId", "companyId"),
  CONSTRAINT "pickingList_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingList_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "pickingList_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingList_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

CREATE INDEX "pickingList_companyId_idx" ON "pickingList"("companyId");
CREATE INDEX "pickingList_status_companyId_idx" ON "pickingList"("status", "companyId");
CREATE INDEX "pickingList_assignee_companyId_idx" ON "pickingList"("assignee", "companyId");
CREATE INDEX "pickingList_locationId_companyId_idx" ON "pickingList"("locationId", "companyId");

INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('pickingList', 'Picking List', 'Inventory');

-- ============================================================================
-- pickingListLine table
-- ============================================================================

CREATE TABLE "pickingListLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "pickingListId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "jobMaterialId" TEXT NOT NULL,
  "jobOperationId" TEXT,
  "itemId" TEXT NOT NULL,
  "quantityToPick" NUMERIC(12,4) NOT NULL,
  "quantityPicked" NUMERIC(12,4) NOT NULL DEFAULT 0,
  "storageUnitId" TEXT,
  "status" "pickingListLineStatus" NOT NULL DEFAULT 'Pending',
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "pickingListLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pickingListLine_pickingListId_fkey" FOREIGN KEY ("pickingListId") REFERENCES "pickingList"("id") ON DELETE CASCADE,
  CONSTRAINT "pickingListLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingListLine_jobMaterialId_fkey" FOREIGN KEY ("jobMaterialId") REFERENCES "jobMaterial"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingListLine_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingListLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingListLine_storageUnitId_fkey" FOREIGN KEY ("storageUnitId") REFERENCES "storageUnit"("id") ON DELETE SET NULL,
  CONSTRAINT "pickingListLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "pickingListLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingListLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

CREATE INDEX "pickingListLine_pickingListId_idx" ON "pickingListLine"("pickingListId");
CREATE INDEX "pickingListLine_jobId_idx" ON "pickingListLine"("jobId");
CREATE INDEX "pickingListLine_jobMaterialId_idx" ON "pickingListLine"("jobMaterialId");
CREATE INDEX "pickingListLine_jobOperationId_idx" ON "pickingListLine"("jobOperationId");
CREATE INDEX "pickingListLine_itemId_idx" ON "pickingListLine"("itemId");
CREATE INDEX "pickingListLine_storageUnitId_idx" ON "pickingListLine"("storageUnitId");
CREATE INDEX "pickingListLine_companyId_idx" ON "pickingListLine"("companyId");

INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('pickingListLine', 'Picking List Line', 'Inventory');

-- ============================================================================
-- pickingListLineTrackedEntity table
-- ============================================================================

CREATE TABLE "pickingListLineTrackedEntity" (
  "pickingListLineId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL,
  "quantity" NUMERIC(12,4) NOT NULL,
  "quantityPicked" NUMERIC(12,4) NOT NULL DEFAULT 0,

  CONSTRAINT "pickingListLineTrackedEntity_pkey" PRIMARY KEY ("pickingListLineId", "trackedEntityId"),
  CONSTRAINT "pickingListLineTrackedEntity_pickingListLineId_fkey" FOREIGN KEY ("pickingListLineId") REFERENCES "pickingListLine"("id") ON DELETE CASCADE,
  CONSTRAINT "pickingListLineTrackedEntity_trackedEntityId_fkey" FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE RESTRICT
);

-- ============================================================================
-- Sequence
-- ============================================================================

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT
  'pickingList',
  'Picking List',
  'PL',
  NULL,
  0,
  6,
  1,
  "id"
FROM "company";

-- ============================================================================
-- storageUnit enhancement: add workCenterId
-- ============================================================================

ALTER TABLE "storageUnit"
  ADD COLUMN "workCenterId" TEXT,
  ADD CONSTRAINT "storageUnit_workCenterId_fkey"
    FOREIGN KEY ("workCenterId") REFERENCES "workCenter"("id")
    ON DELETE SET NULL;

CREATE INDEX "storageUnit_workCenterId_idx" ON "storageUnit"("workCenterId");

-- ============================================================================
-- Function: get_effective_work_center_id
-- Walks the storageUnit parent chain to find the first non-null workCenterId.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_effective_work_center_id(p_storage_unit_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE chain AS (
    SELECT "id", "parentId", "workCenterId"
    FROM "storageUnit"
    WHERE "id" = p_storage_unit_id

    UNION ALL

    SELECT su."id", su."parentId", su."workCenterId"
    FROM "storageUnit" su
    JOIN chain c ON su."id" = c."parentId"
  )
  SELECT "workCenterId"
  FROM chain
  WHERE "workCenterId" IS NOT NULL
  LIMIT 1;
$$;

-- ============================================================================
-- View: pickingLists
-- ============================================================================

CREATE OR REPLACE VIEW "pickingLists" WITH(SECURITY_INVOKER=true) AS
  SELECT
    pl.*,
    l."name" AS "locationName",
    u."fullName" AS "assigneeName",
    u."avatarUrl" AS "assigneeAvatarUrl",
    (SELECT COUNT(*) FROM "pickingListLine" pll WHERE pll."pickingListId" = pl."id") AS "lineCount",
    (SELECT COUNT(*) FROM "pickingListLine" pll WHERE pll."pickingListId" = pl."id" AND pll."status" IN ('Picked', 'Short', 'Cancelled')) AS "completedLineCount"
  FROM "pickingList" pl
  INNER JOIN "location" l ON l."id" = pl."locationId"
  LEFT JOIN "user" u ON u."id" = pl."assignee";

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE "pickingList" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pickingListLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pickingListLineTrackedEntity" ENABLE ROW LEVEL SECURITY;

-- pickingList policies

CREATE POLICY "SELECT" ON "pickingList"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "pickingList"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "pickingList"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "pickingList"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);

-- pickingListLine policies

CREATE POLICY "SELECT" ON "pickingListLine"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "pickingListLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "pickingListLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "pickingListLine"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);

-- pickingListLineTrackedEntity policies (no companyId - uses FK lookup)

CREATE POLICY "SELECT" ON "pickingListLineTrackedEntity"
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine"
    WHERE "id" = "pickingListLineId"
  )
);

CREATE POLICY "INSERT" ON "pickingListLineTrackedEntity"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "pickingListLine"
    WHERE "id" = "pickingListLineId"
  )
);

CREATE POLICY "UPDATE" ON "pickingListLineTrackedEntity"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine"
    WHERE "id" = "pickingListLineId"
  )
);

CREATE POLICY "DELETE" ON "pickingListLineTrackedEntity"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine"
    WHERE "id" = "pickingListLineId"
  )
);
