-- Inbound Inspection Sampling
-- Phase 2: replace per-entity inspection with lot-based inspection + per-sample rows,
-- add an item-level sampling plan, multi-standard support (Z1.4 / ISO 2859-1),
-- and a history log for future auto-switching.

-- 1. Drop the Phase 1 table (destructive — branch has not shipped, dev DBs are expected to reset)
DROP TABLE IF EXISTS "inboundInspection" CASCADE;
DROP TYPE IF EXISTS "inboundInspectionStatus";

-- 2. Standard selection (company-wide)
CREATE TYPE "samplingStandard" AS ENUM ('ANSI_Z1_4', 'ISO_2859_1');

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "samplingStandard" "samplingStandard" NOT NULL DEFAULT 'ANSI_Z1_4';

-- 3. Sampling plan shape
CREATE TYPE "samplingPlanType" AS ENUM ('All', 'First', 'Percentage', 'AQL');
CREATE TYPE "inspectionLevel" AS ENUM ('I', 'II', 'III', 'S1', 'S2', 'S3', 'S4');
CREATE TYPE "inspectionSeverity" AS ENUM ('Normal', 'Tightened', 'Reduced');

-- 4. Item-level sampling plan (1:1 with item, created lazily)
CREATE TABLE "itemSamplingPlan" (
  "itemId" TEXT NOT NULL,
  "type" "samplingPlanType" NOT NULL DEFAULT 'All',
  "sampleSize" INTEGER,
  "percentage" NUMERIC(5,2),
  "aql" NUMERIC(5,3),
  "inspectionLevel" "inspectionLevel" NOT NULL DEFAULT 'II',
  "severity" "inspectionSeverity" NOT NULL DEFAULT 'Normal',
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "itemSamplingPlan_pkey" PRIMARY KEY ("itemId"),
  CONSTRAINT "itemSamplingPlan_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "itemSamplingPlan_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "itemSamplingPlan_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "itemSamplingPlan_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

ALTER TABLE "itemSamplingPlan" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "itemSamplingPlan"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_view'))::text[]
  )
);
CREATE POLICY "INSERT" ON "itemSamplingPlan"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_create'))::text[]
  )
);
CREATE POLICY "UPDATE" ON "itemSamplingPlan"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_update'))::text[]
  )
);
CREATE POLICY "DELETE" ON "itemSamplingPlan"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_delete'))::text[]
  )
);

-- 5. Lot-level inspection
CREATE TYPE "inboundInspectionStatus" AS ENUM (
  'Pending', 'In Progress', 'Passed', 'Failed', 'Partial'
);
CREATE TYPE "inboundInspectionSampleStatus" AS ENUM (
  'Pending', 'Passed', 'Failed'
);

CREATE TABLE "inboundInspection" (
  "id" TEXT NOT NULL DEFAULT id(),
  "inboundInspectionId" TEXT NOT NULL,
  "receiptLineId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemReadableId" TEXT,
  "supplierId" TEXT,
  "lotSize" NUMERIC NOT NULL,
  "samplingStandard" "samplingStandard" NOT NULL,
  "samplingPlanType" "samplingPlanType" NOT NULL,
  "sampleSize" INTEGER NOT NULL,
  "acceptanceNumber" INTEGER NOT NULL,
  "rejectionNumber" INTEGER NOT NULL,
  "aql" NUMERIC(5,3),
  "inspectionLevel" "inspectionLevel",
  "severity" "inspectionSeverity",
  "codeLetter" TEXT,
  "status" "inboundInspectionStatus" NOT NULL DEFAULT 'Pending',
  "notes" TEXT,
  "dispositionedBy" TEXT,
  "dispositionedAt" TIMESTAMP WITH TIME ZONE,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "inboundInspection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inboundInspection_inboundInspectionId_unique" UNIQUE ("inboundInspectionId", "companyId"),
  CONSTRAINT "inboundInspection_receiptLineId_unique" UNIQUE ("receiptLineId"),
  CONSTRAINT "inboundInspection_receiptLineId_fkey"
    FOREIGN KEY ("receiptLineId") REFERENCES "receiptLine"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspection_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspection_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON UPDATE CASCADE,
  CONSTRAINT "inboundInspection_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON UPDATE CASCADE,
  CONSTRAINT "inboundInspection_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspection_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "inboundInspection_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "inboundInspection_dispositionedBy_fkey" FOREIGN KEY ("dispositionedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "inboundInspection_inboundInspectionId_idx" ON "inboundInspection"("inboundInspectionId");
CREATE INDEX "inboundInspection_status_idx" ON "inboundInspection"("status");
CREATE INDEX "inboundInspection_companyId_idx" ON "inboundInspection"("companyId");
CREATE INDEX "inboundInspection_receiptId_idx" ON "inboundInspection"("receiptId");
CREATE INDEX "inboundInspection_itemId_idx" ON "inboundInspection"("itemId");
CREATE INDEX "inboundInspection_supplierId_idx" ON "inboundInspection"("supplierId");

ALTER TABLE "inboundInspection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "inboundInspection"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_view'))::text[]
  )
);
CREATE POLICY "INSERT" ON "inboundInspection"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_create'))::text[]
  )
);
CREATE POLICY "UPDATE" ON "inboundInspection"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_update'))::text[]
  )
);
CREATE POLICY "DELETE" ON "inboundInspection"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_delete'))::text[]
  )
);

-- 6. Per-sample rows (created on demand when an inspector picks/scans an entity)
CREATE TABLE "inboundInspectionSample" (
  "id" TEXT NOT NULL DEFAULT id(),
  "inboundInspectionId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL,
  "status" "inboundInspectionSampleStatus" NOT NULL DEFAULT 'Pending',
  "notes" TEXT,
  "inspectedBy" TEXT,
  "inspectedAt" TIMESTAMP WITH TIME ZONE,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "inboundInspectionSample_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inboundInspectionSample_trackedEntityId_unique" UNIQUE ("trackedEntityId"),
  CONSTRAINT "inboundInspectionSample_inboundInspectionId_fkey"
    FOREIGN KEY ("inboundInspectionId") REFERENCES "inboundInspection"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionSample_trackedEntityId_fkey"
    FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionSample_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionSample_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "inboundInspectionSample_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "inboundInspectionSample_inspectedBy_fkey" FOREIGN KEY ("inspectedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "inboundInspectionSample_inboundInspectionId_idx"
  ON "inboundInspectionSample"("inboundInspectionId");
CREATE INDEX "inboundInspectionSample_status_idx"
  ON "inboundInspectionSample"("status");

ALTER TABLE "inboundInspectionSample" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "inboundInspectionSample"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_view'))::text[]
  )
);
CREATE POLICY "INSERT" ON "inboundInspectionSample"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_create'))::text[]
  )
);
CREATE POLICY "UPDATE" ON "inboundInspectionSample"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_update'))::text[]
  )
);
CREATE POLICY "DELETE" ON "inboundInspectionSample"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_delete'))::text[]
  )
);

-- 7. History log (skeleton for future auto-switching)
CREATE TABLE "inboundInspectionHistory" (
  "id" TEXT NOT NULL DEFAULT id(),
  "inboundInspectionId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "supplierId" TEXT,
  "samplingStandard" "samplingStandard" NOT NULL,
  "severity" "inspectionSeverity" NOT NULL,
  "inspectionLevel" "inspectionLevel",
  "aql" NUMERIC(5,3),
  "lotSize" NUMERIC NOT NULL,
  "sampleSize" INTEGER NOT NULL,
  "defectsFound" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "inboundInspectionHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inboundInspectionHistory_inboundInspectionId_fkey"
    FOREIGN KEY ("inboundInspectionId") REFERENCES "inboundInspection"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionHistory_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON UPDATE CASCADE,
  CONSTRAINT "inboundInspectionHistory_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON UPDATE CASCADE,
  CONSTRAINT "inboundInspectionHistory_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionHistory_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "inboundInspectionHistory_itemId_supplierId_createdAt_idx"
  ON "inboundInspectionHistory"("itemId", "supplierId", "createdAt" DESC);

ALTER TABLE "inboundInspectionHistory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "inboundInspectionHistory"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_view'))::text[]
  )
);
CREATE POLICY "INSERT" ON "inboundInspectionHistory"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_create'))::text[]
  )
);

-- 8. Seed inbound inspection sequence for existing companies
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT
  'inboundInspection',
  'Inbound Inspection',
  'II',
  NULL,
  0,
  6,
  1,
  "id"
FROM "company";
