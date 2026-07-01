-- Per-operation classification (operationKind) that drives the MES view router.
-- See issues/prd.md and docs/adr/0001 (single route on operationKind). Tracking type
-- stays orthogonal. NOTE: the inspection-plan link (inspectionDocumentId) is deliberately
-- deferred to the Inspection workstream (Phase 3) so this keystone migration does not
-- depend on the inspection tables — see docs/adr/0003.

-- 1. Classification enum. 'Operation' preserves today's behavior (the safe default).
-- Guarded so re-running against a DB that already has the type (a shared dev
-- volume whose bookkeeping was pruned by the branch-switch migration repair) is a
-- no-op instead of a hard failure.
DO $$ BEGIN
  CREATE TYPE "operationKind" AS ENUM (
    'Operation',
    'Assembly',
    'Inspection'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Add operationKind to the three operation tables.
ALTER TABLE "methodOperation"
  ADD COLUMN IF NOT EXISTS "operationKind" "operationKind" NOT NULL DEFAULT 'Operation';

ALTER TABLE "jobOperation"
  ADD COLUMN IF NOT EXISTS "operationKind" "operationKind" NOT NULL DEFAULT 'Operation';

ALTER TABLE "quoteOperation"
  ADD COLUMN IF NOT EXISTS "operationKind" "operationKind" NOT NULL DEFAULT 'Operation';

-- 3. Expose operationKind through the MES operation RPC so the view router can read it.
--    Mirrors 20260531084723_rework-serial-flow.sql; only the trailing column is new.
DROP FUNCTION IF EXISTS get_job_operation_by_id(TEXT);
CREATE OR REPLACE FUNCTION get_job_operation_by_id(operation_id TEXT)
RETURNS TABLE (
  id TEXT,
  "jobId" TEXT,
  "jobMakeMethodId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "processId" TEXT,
  "workCenterId" TEXT,
  description TEXT,
  "setupTime" NUMERIC,
  "setupUnit" factor,
  "laborTime" NUMERIC,
  "laborUnit" factor,
  "machineTime" NUMERIC,
  "machineUnit" factor,
  "operationOrderType" "methodOperationOrder",
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "parentMaterialId" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "itemUnitOfMeasure" TEXT,
  "itemModelPath" TEXT,
  "itemModelId" TEXT,
  "itemModelName" TEXT,
  "itemModelSize" BIGINT,
  "operationStatus" "jobOperationStatus",
  "targetQuantity" NUMERIC,
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityReworked" NUMERIC,
  "quantityScrapped" NUMERIC,
  "workInstruction" JSON,
  "operationDueDate" DATE,
  "reworkId" TEXT,
  "operationKind" "operationKind"
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    jo."id",
    jo."jobId",
    jo."jobMakeMethodId",
    jo."order" AS "operationOrder",
    jo."processId",
    jo."workCenterId",
    jo."description",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."operationOrder" AS "operationOrderType",
    j."jobId" AS "jobReadableId",
    j."status" AS "jobStatus",
    j."dueDate"::DATE AS "jobDueDate",
    j."deadlineType" AS "jobDeadlineType",
    jmm."parentMaterialId",
    i."id" as "itemId",
    i."readableIdWithRevision" as "itemReadableId",
    i."name" as "itemDescription",
    uom."name" as "itemUnitOfMeasure",
    m."modelPath" as "itemModelPath",
    m."id" as "itemModelId",
    m."name" as "itemModelName",
    m."size" as "itemModelSize",
    jo."status" AS "operationStatus",
    jo."targetQuantity"::NUMERIC,
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityReworked",
    jo."quantityScrapped",
    jo."workInstruction",
    jo."dueDate" AS "operationDueDate",
    jo."reworkId",
    jo."operationKind"
  FROM "jobOperation" jo
  JOIN "job" j ON j.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "unitOfMeasure" uom ON i."unitOfMeasureCode" = uom."code" AND i."companyId" = uom."companyId"
  LEFT JOIN "modelUpload" m ON i."modelUploadId" = m.id
  WHERE jo.id = operation_id
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;
