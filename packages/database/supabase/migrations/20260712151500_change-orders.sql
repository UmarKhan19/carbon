-- =============================================================================
-- Change Orders (ECO) module — TOP-TO-BOTTOM model.
-- Fresh, self-contained migration (the feature is unshipped — no backward compat).
-- The user selects affected parts first, then stages per-part BOM/BOP/attribute
-- edits (full desired end-state, git-style) in CO-owned tables; at release those
-- are materialized onto a NEW ITEM REVISION and propagated via itemSupersession.
-- Design: plans/change-orders/top-to-bottom/plan.md.
-- Conventions clone quality/nonConformance (20250327140050_ncr.sql): id('<prefix>')
-- PK + companyId, audit columns, RLS via get_companies_with_employee_permission
-- ('parts_*') and get_companies_with_employee_role() for SELECT on type tables.
-- Permission domain is parts_* (change orders live under the Items/Parts area).
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

-- =============================================================================
-- TOP-TO-BOTTOM change-content model (replaces the part-first BomChange model).
-- Affected items are user-selected first; per-item BOM/BOP/attribute edits are
-- staged in CO-owned tables (full desired end-state, git-style) and materialized
-- onto a NEW ITEM REVISION at release. See ../plans/change-orders/top-to-bottom.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 6a. changeOrderAffectedItem — the parts the user selects first (source revision)
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderAffectedItem" (
  "id" TEXT NOT NULL DEFAULT id('coai'),
  "changeOrderId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  -- Per-item revision cutover config (Q3): the oldRev→newRev supersession is
  -- auto-written at release; the user only tunes mode + dates (defaults applied
  -- from the CO effectiveDate when NULL).
  "supersessionMode" "supersessionMode" NOT NULL DEFAULT 'Consume First',
  "discontinuationDate" DATE,
  "successorEffectivityDate" DATE,
  -- Idempotency marker: the created revision's itemId, set at release. Non-null
  -- ⇒ this affected item is already applied; skip on re-run.
  "newItemId" TEXT,
  "changeSummary" JSONB,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderAffectedItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderAffectedItem_changeOrderId_itemId_key" UNIQUE ("changeOrderId", "itemId"),
  CONSTRAINT "changeOrderAffectedItem_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_newItemId_fkey" FOREIGN KEY ("newItemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderAffectedItem_changeOrderId_idx" ON "changeOrderAffectedItem" ("changeOrderId");
CREATE INDEX "changeOrderAffectedItem_itemId_idx" ON "changeOrderAffectedItem" ("itemId");
CREATE INDEX "changeOrderAffectedItem_companyId_idx" ON "changeOrderAffectedItem" ("companyId");

ALTER TABLE "changeOrderAffectedItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderAffectedItem"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderAffectedItem"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderAffectedItem"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderAffectedItem"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 6b. changeOrderStagedMaterial — CO-owned mirror of methodMaterial (end-state)
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderStagedMaterial" (
  "id" TEXT NOT NULL DEFAULT id('cosm'),
  "changeOrderId" TEXT NOT NULL,
  "affectedItemId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL DEFAULT 1,
  "unitOfMeasureCode" TEXT,
  "methodType" "methodType" NOT NULL DEFAULT 'Pull from Inventory',
  "sourcingType" "sourcingType" NOT NULL DEFAULT 'Specified',
  "materialMakeMethodId" TEXT,
  -- Link to a changeOrderStagedOperation row; resolved to the new live operation
  -- id when the revision is materialized at release.
  "stagedOperationId" TEXT,
  "order" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "itemType" TEXT NOT NULL DEFAULT 'Material',
  -- Live methodMaterial.id this row was copied from on snapshot; NULL ⇒ an added
  -- line. Used only to render the diff (git-style end-state; not delta-replay).
  "sourceMaterialId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderStagedMaterial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderStagedMaterial_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedMaterial_affectedItemId_fkey" FOREIGN KEY ("affectedItemId") REFERENCES "changeOrderAffectedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedMaterial_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedMaterial_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedMaterial_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderStagedMaterial_changeOrderId_idx" ON "changeOrderStagedMaterial" ("changeOrderId");
CREATE INDEX "changeOrderStagedMaterial_affectedItemId_idx" ON "changeOrderStagedMaterial" ("affectedItemId");
CREATE INDEX "changeOrderStagedMaterial_itemId_idx" ON "changeOrderStagedMaterial" ("itemId");
CREATE INDEX "changeOrderStagedMaterial_companyId_idx" ON "changeOrderStagedMaterial" ("companyId");

ALTER TABLE "changeOrderStagedMaterial" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderStagedMaterial"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderStagedMaterial"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderStagedMaterial"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderStagedMaterial"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 6c. changeOrderStagedOperation — CO-owned mirror of methodOperation (headers).
--     Columns mirror the CURRENT methodOperation schema (processId/workCenterId,
--     setup/labor/machine time+unit, operationType) — verified against generated
--     types, not the original CREATE TABLE. Process/type are nullable here
--     (authoring WIP); required at release-time materialization + validation.
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderStagedOperation" (
  "id" TEXT NOT NULL DEFAULT id('coso'),
  "changeOrderId" TEXT NOT NULL,
  "affectedItemId" TEXT NOT NULL,
  "order" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "operationOrder" "methodOperationOrder" NOT NULL DEFAULT 'After Previous',
  "operationType" "operationType",
  "processId" TEXT,
  "workCenterId" TEXT,
  "operationSupplierProcessId" TEXT,
  "procedureId" TEXT,
  "description" TEXT,
  "setupTime" NUMERIC NOT NULL DEFAULT 0,
  "setupUnit" "factor" NOT NULL DEFAULT 'Total Hours',
  "laborTime" NUMERIC NOT NULL DEFAULT 0,
  "laborUnit" "factor" NOT NULL DEFAULT 'Hours/Piece',
  "machineTime" NUMERIC NOT NULL DEFAULT 0,
  "machineUnit" "factor" NOT NULL DEFAULT 'Hours/Piece',
  "workInstruction" JSON NOT NULL DEFAULT '{}',
  "sourceOperationId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderStagedOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderStagedOperation_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedOperation_affectedItemId_fkey" FOREIGN KEY ("affectedItemId") REFERENCES "changeOrderAffectedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedOperation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedOperation_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderStagedOperation_changeOrderId_idx" ON "changeOrderStagedOperation" ("changeOrderId");
CREATE INDEX "changeOrderStagedOperation_affectedItemId_idx" ON "changeOrderStagedOperation" ("affectedItemId");
CREATE INDEX "changeOrderStagedOperation_companyId_idx" ON "changeOrderStagedOperation" ("companyId");

ALTER TABLE "changeOrderStagedOperation" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderStagedOperation"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderStagedOperation"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderStagedOperation"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderStagedOperation"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 6d. changeOrderStagedItemAttributes — CO-owned staged copy of item attributes
--     One row per affected item (Make and Buy). Drawing refs are reference-level;
--     files are copied to the new revision at release (no CAD content diff).
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderStagedItemAttributes" (
  "id" TEXT NOT NULL DEFAULT id('coia'),
  "changeOrderId" TEXT NOT NULL,
  "affectedItemId" TEXT NOT NULL,
  "name" TEXT,
  "description" TEXT,
  "unitOfMeasureCode" TEXT,
  "itemTrackingType" TEXT,
  "defaultMethodType" "methodType",
  "replenishmentSystem" TEXT,
  "sourcingType" "sourcingType",
  "requiresInspection" BOOLEAN,
  "thumbnailPath" TEXT,
  "attributes" JSONB,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderStagedItemAttributes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderStagedItemAttributes_affectedItemId_key" UNIQUE ("affectedItemId"),
  CONSTRAINT "changeOrderStagedItemAttributes_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedItemAttributes_affectedItemId_fkey" FOREIGN KEY ("affectedItemId") REFERENCES "changeOrderAffectedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedItemAttributes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedItemAttributes_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedItemAttributes_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderStagedItemAttributes_changeOrderId_idx" ON "changeOrderStagedItemAttributes" ("changeOrderId");
CREATE INDEX "changeOrderStagedItemAttributes_affectedItemId_idx" ON "changeOrderStagedItemAttributes" ("affectedItemId");
CREATE INDEX "changeOrderStagedItemAttributes_companyId_idx" ON "changeOrderStagedItemAttributes" ("companyId");

ALTER TABLE "changeOrderStagedItemAttributes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderStagedItemAttributes"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderStagedItemAttributes"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderStagedItemAttributes"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderStagedItemAttributes"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 6e. changeOrderSupersession — MANUAL different-part obsolescence declarations
--     (NOT revision cutover — that is auto-generated from changeOrderAffectedItem)
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderSupersession" (
  "id" TEXT NOT NULL DEFAULT id('cosup'),
  "changeOrderId" TEXT NOT NULL,
  "predecessorItemId" TEXT NOT NULL,
  "successorItemId" TEXT,
  "supersessionMode" "supersessionMode" NOT NULL DEFAULT 'Consume First',
  "discontinuationDate" DATE,
  "successorEffectivityDate" DATE,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderSupersession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderSupersession_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_predecessorItemId_fkey" FOREIGN KEY ("predecessorItemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_successorItemId_fkey" FOREIGN KEY ("successorItemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderSupersession_changeOrderId_idx" ON "changeOrderSupersession" ("changeOrderId");
CREATE INDEX "changeOrderSupersession_predecessorItemId_idx" ON "changeOrderSupersession" ("predecessorItemId");
CREATE INDEX "changeOrderSupersession_companyId_idx" ON "changeOrderSupersession" ("companyId");

ALTER TABLE "changeOrderSupersession" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderSupersession"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderSupersession"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderSupersession"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission ('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderSupersession"
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
-- 8b. item.changeOrderId — revision→CO back-link (Q4). Stamped at release on
--     each newly-created revision item; powers the "Created by CO-…" chip and
--     part-side change history. SET NULL so deleting a CO doesn't cascade items.
-- -----------------------------------------------------------------------------
ALTER TABLE "item" ADD COLUMN "changeOrderId" TEXT;
ALTER TABLE "item" ADD CONSTRAINT "item_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "item_changeOrderId_idx" ON "item" ("changeOrderId");

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
