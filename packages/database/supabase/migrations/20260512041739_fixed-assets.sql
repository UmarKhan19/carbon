-- Enums
CREATE TYPE "fixedAssetStatus" AS ENUM (
  'Draft',
  'Active',
  'Fully Depreciated',
  'Disposed'
);

CREATE TYPE "depreciationMethod" AS ENUM (
  'Straight Line',
  'Declining Balance',
  'Units of Production'
);

CREATE TYPE "disposalMethod" AS ENUM (
  'Sale',
  'Scrapping'
);

-- Add new journal source types
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Depreciation';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Disposal';

-- Asset Class table
CREATE TABLE "fixedAssetClass" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "depreciationMethod" "depreciationMethod" NOT NULL DEFAULT 'Straight Line',
  "usefulLifeMonths" INTEGER NOT NULL DEFAULT 60,
  "residualValuePercent" NUMERIC NOT NULL DEFAULT 0,
  "assetAccountId" TEXT NOT NULL,
  "accumulatedDepreciationAccountId" TEXT NOT NULL,
  "depreciationExpenseAccountId" TEXT NOT NULL,
  "writeOffAccountId" TEXT NOT NULL,
  "writeDownAccountId" TEXT NOT NULL,
  "disposalAccountId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "fixedAssetClass_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fixedAssetClass_name_companyId_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "fixedAssetClass_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_accumulatedDepreciationAccountId_fkey" FOREIGN KEY ("accumulatedDepreciationAccountId") REFERENCES "account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_depreciationExpenseAccountId_fkey" FOREIGN KEY ("depreciationExpenseAccountId") REFERENCES "account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_writeOffAccountId_fkey" FOREIGN KEY ("writeOffAccountId") REFERENCES "account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_writeDownAccountId_fkey" FOREIGN KEY ("writeDownAccountId") REFERENCES "account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_disposalAccountId_fkey" FOREIGN KEY ("disposalAccountId") REFERENCES "account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "fixedAssetClass_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE INDEX "fixedAssetClass_companyId_idx" ON "fixedAssetClass" ("companyId");

ALTER TABLE "fixedAssetClass" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."fixedAssetClass"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
    )
  );

CREATE POLICY "INSERT" ON "public"."fixedAssetClass"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "public"."fixedAssetClass"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "public"."fixedAssetClass"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
  );

-- Fixed Asset table
CREATE TABLE "fixedAsset" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "fixedAssetId" TEXT NOT NULL,
  "fixedAssetClassId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "serialNumber" TEXT,
  "status" "fixedAssetStatus" NOT NULL DEFAULT 'Draft',
  "depreciationMethod" "depreciationMethod" NOT NULL DEFAULT 'Straight Line',
  "usefulLifeMonths" INTEGER NOT NULL DEFAULT 60,
  "residualValuePercent" NUMERIC NOT NULL DEFAULT 0,
  "acquisitionCost" NUMERIC NOT NULL DEFAULT 0,
  "acquisitionDate" DATE,
  "depreciationStartDate" DATE,
  "accumulatedDepreciation" NUMERIC NOT NULL DEFAULT 0,
  "assetLifetimeUsage" NUMERIC,
  "locationId" TEXT,
  "custodianId" TEXT,
  "disposalDate" DATE,
  "disposalMethod" "disposalMethod",
  "saleProceeds" NUMERIC,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "notes" JSONB,
  "customFields" JSONB,

  CONSTRAINT "fixedAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fixedAsset_fixedAssetId_companyId_key" UNIQUE ("fixedAssetId", "companyId"),
  CONSTRAINT "fixedAsset_fixedAssetClassId_fkey" FOREIGN KEY ("fixedAssetClassId") REFERENCES "fixedAssetClass" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAsset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "fixedAsset_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "fixedAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fixedAsset_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "fixedAsset_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE INDEX "fixedAsset_companyId_idx" ON "fixedAsset" ("companyId");
CREATE INDEX "fixedAsset_fixedAssetClassId_idx" ON "fixedAsset" ("fixedAssetClassId");
CREATE INDEX "fixedAsset_status_idx" ON "fixedAsset" ("companyId", "status");

ALTER TABLE "fixedAsset" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."fixedAsset"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
    )
  );

CREATE POLICY "INSERT" ON "public"."fixedAsset"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "public"."fixedAsset"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "public"."fixedAsset"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
  );

-- Add FK from purchaseOrderLine.assetId to fixedAsset
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "fixedAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Depreciation Run table
CREATE TABLE "depreciationRun" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "depreciationRunId" TEXT NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "depreciationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "depreciationRun_depreciationRunId_companyId_key" UNIQUE ("depreciationRunId", "companyId"),
  CONSTRAINT "depreciationRun_periodEnd_companyId_key" UNIQUE ("periodEnd", "companyId"),
  CONSTRAINT "depreciationRun_postedBy_fkey" FOREIGN KEY ("postedBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "depreciationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "depreciationRun_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "depreciationRun_status_check" CHECK ("status" IN ('Draft', 'Posted'))
);

CREATE INDEX "depreciationRun_companyId_idx" ON "depreciationRun" ("companyId");

ALTER TABLE "depreciationRun" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."depreciationRun"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
    )
  );

CREATE POLICY "INSERT" ON "public"."depreciationRun"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "public"."depreciationRun"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "public"."depreciationRun"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
  );

-- Depreciation Run Line table
CREATE TABLE "depreciationRunLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "depreciationRunId" TEXT NOT NULL,
  "fixedAssetId" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "journalId" TEXT,
  "companyId" TEXT NOT NULL,

  CONSTRAINT "depreciationRunLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "depreciationRunLine_depreciationRunId_fkey" FOREIGN KEY ("depreciationRunId") REFERENCES "depreciationRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "depreciationRunLine_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixedAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "depreciationRunLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "depreciationRunLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "depreciationRunLine_depreciationRunId_idx" ON "depreciationRunLine" ("depreciationRunId");
CREATE INDEX "depreciationRunLine_fixedAssetId_idx" ON "depreciationRunLine" ("fixedAssetId");

ALTER TABLE "depreciationRunLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."depreciationRunLine"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
    )
  );

CREATE POLICY "INSERT" ON "public"."depreciationRunLine"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "public"."depreciationRunLine"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "public"."depreciationRunLine"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
  );

-- Fixed Asset Disposal table
CREATE TABLE "fixedAssetDisposal" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "fixedAssetId" TEXT NOT NULL,
  "disposalMethod" "disposalMethod" NOT NULL,
  "disposalDate" DATE NOT NULL,
  "saleProceeds" NUMERIC NOT NULL DEFAULT 0,
  "netBookValueAtDisposal" NUMERIC NOT NULL,
  "gainLoss" NUMERIC NOT NULL,
  "journalId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "fixedAssetDisposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fixedAssetDisposal_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixedAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetDisposal_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetDisposal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetDisposal_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE INDEX "fixedAssetDisposal_fixedAssetId_idx" ON "fixedAssetDisposal" ("fixedAssetId");

ALTER TABLE "fixedAssetDisposal" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."fixedAssetDisposal"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
    )
  );

CREATE POLICY "INSERT" ON "public"."fixedAssetDisposal"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
    )
  );

-- Fixed Asset Usage Log table (for Units of Production)
CREATE TABLE "fixedAssetUsageLog" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "fixedAssetId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "unitsProduced" NUMERIC NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "fixedAssetUsageLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fixedAssetUsageLog_fixedAssetId_periodEnd_key" UNIQUE ("fixedAssetId", "periodEnd"),
  CONSTRAINT "fixedAssetUsageLog_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixedAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetUsageLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetUsageLog_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE INDEX "fixedAssetUsageLog_fixedAssetId_idx" ON "fixedAssetUsageLog" ("fixedAssetId");

ALTER TABLE "fixedAssetUsageLog" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."fixedAssetUsageLog"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
    )
  );

CREATE POLICY "INSERT" ON "public"."fixedAssetUsageLog"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "public"."fixedAssetUsageLog"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "public"."fixedAssetUsageLog"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
  );

-- Sequence entries for fixedAsset and depreciationRun
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'fixedAsset', 'Fixed Asset', 'FA', NULL, 1, 6, 1, "id" FROM "company"
ON CONFLICT DO NOTHING;

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'depreciationRun', 'Depreciation Run', 'DR', NULL, 1, 6, 1, "id" FROM "company"
ON CONFLICT DO NOTHING;

-- Recreate views to join fixedAsset for asset name
DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT DISTINCT ON (pl.id)
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i."readableIdWithRevision" as "itemReadableId",
    i.description as "itemDescription",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    sp."supplierPartId",
    jo."description" as "jobOperationDescription",
    a."name" as "accountName",
    fa."name" as "assetName"
  FROM "purchaseOrderLine" pl
  INNER JOIN "purchaseOrder" so ON so.id = pl."purchaseOrderId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id
  LEFT JOIN "jobOperation" jo ON jo."id" = pl."jobOperationId"
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
);

DROP VIEW IF EXISTS "purchaseInvoiceLines";
CREATE OR REPLACE VIEW "purchaseInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i."readableIdWithRevision" as "itemReadableId",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    sp."supplierPartId",
    a."name" as "accountName",
    fa."name" as "assetName"
  FROM "purchaseInvoiceLine" pl
  INNER JOIN "purchaseInvoice" pi ON pi.id = pl."invoiceId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = pi."supplierId" AND sp."itemId" = i.id
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
);
