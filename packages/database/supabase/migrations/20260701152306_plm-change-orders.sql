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

CREATE TYPE "changeOrderStatus" AS ENUM (
  'Draft',
  'In Review',
  'Approved',
  'Released',
  'Cancelled'
);

CREATE TYPE "changeOrderApprovalType" AS ENUM (
  'Unanimous',
  'Majority',
  'First-In'
);

CREATE TYPE "changeOrderDisposition" AS ENUM (
  'No Change',
  'Use Up',
  'Rework',
  'Scrap'
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
    'Design Change',
    'BOM Change',
    'Process/BOP Change',
    'Document Change',
    'Obsolescence'
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
-- 4. changeOrderWorkflow (template) — clones nonConformanceWorkflow
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderWorkflow" (
  "id" TEXT NOT NULL DEFAULT id('cow'),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "content" JSON NOT NULL DEFAULT '{}',
  "requiredActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "approvalRequirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderWorkflow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderWorkflow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderWorkflow_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderWorkflow_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderWorkflow_companyId_idx" ON "changeOrderWorkflow" ("companyId");

ALTER TABLE "changeOrderWorkflow" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderWorkflow"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."changeOrderWorkflow"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."changeOrderWorkflow"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."changeOrderWorkflow"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);

-- -----------------------------------------------------------------------------
-- 5. changeOrder (parent) — clones nonConformance
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrder" (
  "id" TEXT NOT NULL DEFAULT id('co'),
  "changeOrderId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" JSON NOT NULL DEFAULT '{}',
  "type" "changeOrderTypeEnum" NOT NULL DEFAULT 'Engineering',
  "status" "changeOrderStatus" NOT NULL DEFAULT 'Draft',
  "approvalType" "changeOrderApprovalType" NOT NULL DEFAULT 'Unanimous',
  "priority" "nonConformancePriority",
  "changeOrderTypeId" TEXT,
  "changeOrderWorkflowId" TEXT,
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
  CONSTRAINT "changeOrder_changeOrderWorkflowId_fkey" FOREIGN KEY ("changeOrderWorkflowId") REFERENCES "changeOrderWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrder_companyId_idx" ON "changeOrder" ("companyId");
CREATE INDEX "changeOrder_changeOrderTypeId_idx" ON "changeOrder" ("changeOrderTypeId");
CREATE INDEX "changeOrder_changeOrderWorkflowId_idx" ON "changeOrder" ("changeOrderWorkflowId");
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
-- 6. changeOrderItem (affected items) — unique (changeOrderId, itemId)
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderItem" (
  "id" TEXT NOT NULL DEFAULT id('coi'),
  "changeOrderId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "pendingItemId" TEXT,
  "disposition" "changeOrderDisposition" NOT NULL DEFAULT 'No Change',
  "dispositionNotes" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderItem_changeOrderId_itemId_key" UNIQUE ("changeOrderId", "itemId"),
  CONSTRAINT "changeOrderItem_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "changeOrderItem_pendingItemId_fkey" FOREIGN KEY ("pendingItemId") REFERENCES "item"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "changeOrderItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderItem_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderItem_changeOrderId_idx" ON "changeOrderItem" ("changeOrderId");
CREATE INDEX "changeOrderItem_itemId_idx" ON "changeOrderItem" ("itemId");
CREATE INDEX "changeOrderItem_pendingItemId_idx" ON "changeOrderItem" ("pendingItemId");

ALTER TABLE "changeOrderItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderItem"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."changeOrderItem"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."changeOrderItem"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."changeOrderItem"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
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
-- 8. changeOrderApprovalTask — clones nonConformanceApprovalTask
--    ⚠️ inert until Phase 4 (no inbound FK from the core; no consumer yet).
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderApprovalTask" (
  "id" TEXT NOT NULL DEFAULT id('coap'),
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

  CONSTRAINT "changeOrderApprovalTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderApprovalTask_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderApprovalTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderApprovalTask_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderApprovalTask_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderApprovalTask_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderApprovalTask_changeOrderId_idx" ON "changeOrderApprovalTask" ("changeOrderId");
CREATE INDEX "changeOrderApprovalTask_assignee_idx" ON "changeOrderApprovalTask" ("assignee");
CREATE INDEX "changeOrderApprovalTask_status_idx" ON "changeOrderApprovalTask" ("status");

ALTER TABLE "changeOrderApprovalTask" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderApprovalTask"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."changeOrderApprovalTask"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."changeOrderApprovalTask"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."changeOrderApprovalTask"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);

-- -----------------------------------------------------------------------------
-- 9. changeOrderReviewer — clones nonConformanceReviewer
--    ⚠️ inert until Phase 4 (no inbound FK from the core; no consumer yet).
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderReviewer" (
  "id" TEXT NOT NULL DEFAULT id('cor'),
  "title" TEXT NOT NULL,
  "status" "changeOrderTaskStatus" NOT NULL DEFAULT 'Pending',
  "changeOrderId" TEXT NOT NULL,
  "notes" JSON NOT NULL DEFAULT '{}',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "dueDate" DATE,
  "completedDate" DATE,
  "assignee" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderReviewer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderReviewer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderReviewer_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderReviewer_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderReviewer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderReviewer_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderReviewer_changeOrderId_idx" ON "changeOrderReviewer" ("changeOrderId");
CREATE INDEX "changeOrderReviewer_assignee_idx" ON "changeOrderReviewer" ("assignee");

ALTER TABLE "changeOrderReviewer" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderReviewer"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."changeOrderReviewer"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."changeOrderReviewer"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."changeOrderReviewer"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);

-- -----------------------------------------------------------------------------
-- 10. item.revisionStatus
-- -----------------------------------------------------------------------------
ALTER TABLE "item" ADD COLUMN "revisionStatus" "itemRevisionStatus" NOT NULL DEFAULT 'Design';

-- -----------------------------------------------------------------------------
-- 11. companySettings.plmReleaseControl
--     TEXT + CHECK is the dominant convention for constrained string settings.
--     Existing RLS on companySettings covers new columns automatically.
-- -----------------------------------------------------------------------------
ALTER TABLE "companySettings" ADD COLUMN "plmReleaseControl" TEXT NOT NULL DEFAULT 'enforce' CHECK ("plmReleaseControl" IN ('off', 'warn', 'enforce'));

-- -----------------------------------------------------------------------------
-- 12. Custom fields registration
-- -----------------------------------------------------------------------------
INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('changeOrder', 'Change Order', 'Items');

-- -----------------------------------------------------------------------------
-- 13. Sequence seed — ECO readable id per company (clones the NCR seed)
-- -----------------------------------------------------------------------------
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT
  'changeOrder',
  'Change Order',
  'ECO',
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
