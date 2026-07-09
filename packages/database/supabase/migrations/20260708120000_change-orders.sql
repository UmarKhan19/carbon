-- =============================================================================
-- PLM — Change Orders (ECO) module
-- Clones the quality / nonConformance conventions (20250327140050_ncr.sql):
--   id('<prefix>') PK + companyId, audit columns, RLS via
--   get_companies_with_employee_permission('parts_*') and
--   get_companies_with_employee_role() for SELECT on type tables.
-- Permission domain is parts_* (change orders live under the Items/Parts area;
-- the core item table is itself gated on parts_*).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2. Enums
-- -----------------------------------------------------------------------------
-- NOTE: named "changeOrderTypeEnum" (not "changeOrderType") because a TABLE
-- "changeOrderType" exists below; Postgres registers an implicit composite type
-- for every table, so an enum and a table cannot share a name in pg_type.
CREATE TYPE "changeOrderTypeEnum" AS ENUM (
  'Engineering',
  'Manufacturing',
  'Documentation'
);

-- V1 stage flow (forward, one step at a time): Draft → Start → Engineering
-- Complete → Implementation → Done. Broadcast on Start / Implementation / Done.
CREATE TYPE "changeOrderStatus" AS ENUM (
  'Draft',
  'Start',
  'Engineering Complete',
  'Implementation',
  'Done'
);

-- BOM-change rows are part-first: Delete (from assemblies, with a per-assembly
-- supersession mode) or Add (to assemblies, quantity only). Reuses the existing
-- "supersessionMode" enum (20260618171234_material-supersession.sql).
CREATE TYPE "changeOrderBomChangeType" AS ENUM (
  'Add',
  'Delete'
);

CREATE TYPE "itemRevisionStatus" AS ENUM (
  'Design',
  'Prototype',
  'Production',
  'Obsolete'
);

-- Mirrors nonConformanceTaskStatus (Pending/In Progress/Completed/Skipped).
CREATE TYPE "changeOrderTaskStatus" AS ENUM (
  'Pending',
  'In Progress',
  'Completed',
  'Skipped'
);

-- -----------------------------------------------------------------------------
-- 3. changeOrderType (lookup) — clones nonConformanceType
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderType" (
  "id" TEXT NOT NULL DEFAULT id('cot'),
  "name" TEXT NOT NULL,
  "companyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderType_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderType_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderType_companyId_idx" ON "changeOrderType" ("companyId");

ALTER TABLE "changeOrderType" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderType"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."changeOrderType"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."changeOrderType"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."changeOrderType"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);

-- Seed change order types for all existing companies
WITH co_types AS (
  SELECT unnest(ARRAY[
    'Design improvement',
    'Obsolescence',
    'Cost reduction'
  ]) AS name
)
INSERT INTO "changeOrderType" ("name", "companyId", "createdBy")
SELECT
  co_types.name,
  c.id,
  'system'
FROM
  "company" c,
  co_types;

-- -----------------------------------------------------------------------------
-- 4. changeOrder (parent) — clones nonConformance
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrder" (
  "id" TEXT NOT NULL DEFAULT id('co'),
  "changeOrderId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  -- "reasonForChange" = why (PRD "Reason for Change"); "description" = what (PRD
  -- "Description of Change"). Both are rich-text JSON editors on the detail page.
  "reasonForChange" JSON NOT NULL DEFAULT '{}',
  "description" JSON NOT NULL DEFAULT '{}',
  "type" "changeOrderTypeEnum" NOT NULL DEFAULT 'Engineering',
  "status" "changeOrderStatus" NOT NULL DEFAULT 'Draft',
  "priority" "nonConformancePriority",
  "changeOrderTypeId" TEXT,
  -- Optional link to the Quality NCR that originated this change (navigable
  -- both ways; SET NULL so deleting the NCR doesn't cascade-delete the CO).
  "nonConformanceId" TEXT,
  "openDate" DATE NOT NULL,
  "dueDate" DATE,
  "effectiveDate" DATE,
  "requiredActionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "approvalRequirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sourceType" TEXT,
  "sourceId" TEXT,
  "assignee" TEXT,
  "customFields" JSONB,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "companyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrder_changeOrderTypeId_fkey" FOREIGN KEY ("changeOrderTypeId") REFERENCES "changeOrderType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrder_companyId_idx" ON "changeOrder" ("companyId");
CREATE INDEX "changeOrder_changeOrderTypeId_idx" ON "changeOrder" ("changeOrderTypeId");
CREATE INDEX "changeOrder_nonConformanceId_idx" ON "changeOrder" ("nonConformanceId");
CREATE INDEX "changeOrder_status_idx" ON "changeOrder" ("status");
CREATE INDEX "changeOrder_assignee_idx" ON "changeOrder" ("assignee");

ALTER TABLE "changeOrder" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrder"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."changeOrder"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."changeOrder"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."changeOrder"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);

-- -----------------------------------------------------------------------------
-- 6. changeOrderProductAffected — top-level products the CO affects
--    Drives the Implementation effectivity-version list. unique (changeOrderId, itemId)
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderProductAffected" (
  "id" TEXT NOT NULL DEFAULT id('copa'),
  "changeOrderId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderProductAffected_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderProductAffected_changeOrderId_itemId_key" UNIQUE ("changeOrderId", "itemId"),
  CONSTRAINT "changeOrderProductAffected_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderProductAffected_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "changeOrderProductAffected_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderProductAffected_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderProductAffected_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderProductAffected_changeOrderId_idx" ON "changeOrderProductAffected" ("changeOrderId");
CREATE INDEX "changeOrderProductAffected_itemId_idx" ON "changeOrderProductAffected" ("itemId");
CREATE INDEX "changeOrderProductAffected_companyId_idx" ON "changeOrderProductAffected" ("companyId");

ALTER TABLE "changeOrderProductAffected" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderProductAffected"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderProductAffected"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderProductAffected"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderProductAffected"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 6b. changeOrderBomChange — one part-first Add/Delete row per CO
--     itemId is ALWAYS non-null (G3: forward-references mint a real inactive
--     item rather than threading a nullable placeholder everywhere).
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderBomChange" (
  "id" TEXT NOT NULL DEFAULT id('cobc'),
  "changeOrderId" TEXT NOT NULL,
  "changeType" "changeOrderBomChangeType" NOT NULL,
  "itemId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderBomChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderBomChange_changeOrderId_changeType_itemId_key" UNIQUE ("changeOrderId", "changeType", "itemId"),
  CONSTRAINT "changeOrderBomChange_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderBomChange_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "changeOrderBomChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderBomChange_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderBomChange_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderBomChange_changeOrderId_idx" ON "changeOrderBomChange" ("changeOrderId");
CREATE INDEX "changeOrderBomChange_itemId_idx" ON "changeOrderBomChange" ("itemId");
CREATE INDEX "changeOrderBomChange_companyId_idx" ON "changeOrderBomChange" ("companyId");

ALTER TABLE "changeOrderBomChange" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderBomChange"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderBomChange"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderBomChange"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderBomChange"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 6c. changeOrderBomChangeAssembly — per-assembly target of a BOM change row
--     Delete rows carry a per-assembly supersessionMode (Q3: modes vary per
--     assembly within one CO); Add rows leave it NULL. quantity per assembly.
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderBomChangeAssembly" (
  "id" TEXT NOT NULL DEFAULT id('cobca'),
  "bomChangeId" TEXT NOT NULL,
  -- Denormalized parent CO id: the audit system rolls child changes up to the
  -- owning entity via a direct entityIdColumn; this grandchild would otherwise
  -- only reach the CO through bomChangeId. Set once at insert (an assembly row
  -- never moves between change orders).
  "changeOrderId" TEXT NOT NULL,
  "assemblyItemId" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL DEFAULT 1,
  "supersessionMode" "supersessionMode",
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderBomChangeAssembly_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderBomChangeAssembly_bomChangeId_assemblyItemId_key" UNIQUE ("bomChangeId", "assemblyItemId"),
  CONSTRAINT "changeOrderBomChangeAssembly_bomChangeId_fkey" FOREIGN KEY ("bomChangeId") REFERENCES "changeOrderBomChange"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderBomChangeAssembly_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderBomChangeAssembly_assemblyItemId_fkey" FOREIGN KEY ("assemblyItemId") REFERENCES "item"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "changeOrderBomChangeAssembly_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderBomChangeAssembly_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderBomChangeAssembly_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderBomChangeAssembly_bomChangeId_idx" ON "changeOrderBomChangeAssembly" ("bomChangeId");
CREATE INDEX "changeOrderBomChangeAssembly_changeOrderId_idx" ON "changeOrderBomChangeAssembly" ("changeOrderId");
CREATE INDEX "changeOrderBomChangeAssembly_assemblyItemId_idx" ON "changeOrderBomChangeAssembly" ("assemblyItemId");
CREATE INDEX "changeOrderBomChangeAssembly_companyId_idx" ON "changeOrderBomChangeAssembly" ("companyId");

ALTER TABLE "changeOrderBomChangeAssembly" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderBomChangeAssembly"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderBomChangeAssembly"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderBomChangeAssembly"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderBomChangeAssembly"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 7. changeOrderActionTask — clones nonConformanceActionTask
--    ⚠️ inert until Phase 4 (no inbound FK from the core; no consumer yet).
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderActionTask" (
  "id" TEXT NOT NULL DEFAULT id('coat'),
  "changeOrderId" TEXT NOT NULL,
  "name" TEXT,
  "status" "changeOrderTaskStatus" NOT NULL DEFAULT 'Pending',
  "dueDate" DATE,
  "completedDate" DATE,
  "assignee" TEXT,
  "notes" JSON NOT NULL DEFAULT '{}',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderActionTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderActionTask_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderActionTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderActionTask_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderActionTask_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderActionTask_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderActionTask_changeOrderId_idx" ON "changeOrderActionTask" ("changeOrderId");
CREATE INDEX "changeOrderActionTask_assignee_idx" ON "changeOrderActionTask" ("assignee");
CREATE INDEX "changeOrderActionTask_status_idx" ON "changeOrderActionTask" ("status");

ALTER TABLE "changeOrderActionTask" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderActionTask"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."changeOrderActionTask"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."changeOrderActionTask"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."changeOrderActionTask"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);

-- -----------------------------------------------------------------------------
-- 8. item.revisionStatus
-- -----------------------------------------------------------------------------
ALTER TABLE "item" ADD COLUMN "revisionStatus" "itemRevisionStatus" NOT NULL DEFAULT 'Design';

-- -----------------------------------------------------------------------------
-- 9. companySettings.plmReleaseControl
--     TEXT + CHECK is the dominant convention for constrained string settings.
--     Existing RLS on companySettings covers new columns automatically.
-- -----------------------------------------------------------------------------
ALTER TABLE "companySettings" ADD COLUMN "plmReleaseControl" TEXT NOT NULL DEFAULT 'enforce' CHECK ("plmReleaseControl" IN ('off', 'warn', 'enforce'));

-- -----------------------------------------------------------------------------
-- 10. Custom fields registration
-- -----------------------------------------------------------------------------
INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('changeOrder', 'Change Order', 'Items');

-- -----------------------------------------------------------------------------
-- 13. Sequence seed — CO readable id per company (CO-000001), size 6
-- -----------------------------------------------------------------------------
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT
  'changeOrder',
  'Change Order',
  'CO-',
  NULL,
  0,
  6,
  1,
  "id"
FROM "company";

-- -----------------------------------------------------------------------------
-- 14. Realtime — the change-orders list uses useRealtime("changeOrder")
-- -----------------------------------------------------------------------------
ALTER publication supabase_realtime ADD TABLE "changeOrder";
