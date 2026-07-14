-- Job Operation Batching
-- Some processes (laser cutting, heat treat, plating) can run multiple jobs at
-- once. Batchability is a property of the PROCESS, not the item or routing step.
-- A jobOperationBatch is a lightweight join over N real jobOperation rows.

-- 1. The capability flag (master data)
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "batchable" BOOLEAN NOT NULL DEFAULT false;

-- Recreate the "processes" view to include the new column.
-- (PostgreSQL views with SELECT * snapshot columns at creation time.)
DROP VIEW IF EXISTS "processes";
CREATE OR REPLACE VIEW "processes" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    wcp."workCenters",
    sp."suppliers"
  FROM "process" p
  LEFT JOIN (
    SELECT
      "processId",
      array_agg("workCenterId"::text) as "workCenters"
    FROM "workCenterProcess" wcp
    INNER JOIN "workCenter" wc ON wcp."workCenterId" = wc.id
    GROUP BY "processId"
  ) wcp ON p.id = wcp."processId"
  LEFT JOIN (
    SELECT
      "processId",
      jsonb_agg(jsonb_build_object('id', sp."id", 'name', s.name)) as "suppliers"
    FROM "supplierProcess" sp
    INNER JOIN "supplier" s ON sp."supplierId" = s.id
    GROUP BY "processId"
  ) sp ON p.id = sp."processId";

-- 2. The operation batch
CREATE TYPE "jobOperationBatchStatus" AS ENUM ('Active', 'Completed', 'Cancelled');

CREATE TABLE "jobOperationBatch" (
    "id" TEXT NOT NULL DEFAULT id(),
    "readableId" TEXT NOT NULL,                -- BAT000001 (getNextSequence)
    "companyId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,                 -- every member matches this
    "workCenterId" TEXT,                       -- where the batch runs; propagated to members
    "locationId" TEXT NOT NULL,                -- planning board is per-location
    "status" "jobOperationBatchStatus" NOT NULL DEFAULT 'Active',
    "notes" TEXT,
    "customFields" JSONB,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "jobOperationBatch_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "jobOperationBatch_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobOperationBatch_processId_fkey" FOREIGN KEY ("processId")
      REFERENCES "process"("id"),
    CONSTRAINT "jobOperationBatch_workCenterId_fkey" FOREIGN KEY ("workCenterId")
      REFERENCES "workCenter"("id") ON DELETE SET NULL,
    CONSTRAINT "jobOperationBatch_locationId_fkey" FOREIGN KEY ("locationId")
      REFERENCES "location"("id"),
    CONSTRAINT "jobOperationBatch_readableId_unique" UNIQUE ("readableId", "companyId")
);

CREATE INDEX "jobOperationBatch_companyId_idx" ON "jobOperationBatch" ("companyId");
CREATE INDEX "jobOperationBatch_createdBy_idx" ON "jobOperationBatch" ("createdBy");
CREATE INDEX "jobOperationBatch_processId_idx" ON "jobOperationBatch" ("processId");
CREATE INDEX "jobOperationBatch_locationId_idx" ON "jobOperationBatch" ("locationId");

ALTER TABLE "public"."jobOperationBatch" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."jobOperationBatch"
  FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));

CREATE POLICY "INSERT" ON "public"."jobOperationBatch"
  FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[]));

CREATE POLICY "UPDATE" ON "public"."jobOperationBatch"
  FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[]));

CREATE POLICY "DELETE" ON "public"."jobOperationBatch"
  FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[]));

-- 3. Membership — one nullable FK on jobOperation
ALTER TABLE "jobOperation" ADD COLUMN "jobOperationBatchId" TEXT;
ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey"
  FOREIGN KEY ("jobOperationBatchId", "companyId")
  REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL;
CREATE INDEX "jobOperation_jobOperationBatchId_idx"
  ON "jobOperation" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- 4. Batch-tagged timers (while running; slices keep the tag for auditability)
ALTER TABLE "productionEvent" ADD COLUMN "jobOperationBatchId" TEXT;
ALTER TABLE "productionEvent" ADD CONSTRAINT "productionEvent_jobOperationBatchId_fkey"
  FOREIGN KEY ("jobOperationBatchId", "companyId")
  REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL;
CREATE INDEX "productionEvent_jobOperationBatchId_idx"
  ON "productionEvent" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- 5. Sequence for readable ids (existing companies; new companies via seed.data.ts)
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'jobOperationBatch', 'Operation Batch', 'BAT', NULL, 0, 6, 1, "id"
FROM "company" ON CONFLICT DO NOTHING;
