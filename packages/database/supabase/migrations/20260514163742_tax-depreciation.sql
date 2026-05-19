-- Tax Depreciation Tracking
-- Adds support for tracking tax depreciation separately from book depreciation

-- New enums
CREATE TYPE "taxDepreciationMethod" AS ENUM (
  'Straight Line',
  'Declining Balance',
  'MACRS'
);

CREATE TYPE "macrsPropertyClass" AS ENUM (
  '3',
  '5',
  '7',
  '10',
  '15',
  '20',
  '27.5',
  '39'
);

CREATE TYPE "macrsConvention" AS ENUM (
  'Half-Year',
  'Mid-Quarter'
);

-- Company settings: toggle and tax rate
ALTER TABLE "companySettings"
  ADD COLUMN "assetTaxDepreciationEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "assetTaxRate" NUMERIC(5,2) NULL;

-- Account defaults: DTL accounts
ALTER TABLE "accountDefault"
  ADD COLUMN "deferredTaxLiabilityAccountId" TEXT NULL REFERENCES "account"("id"),
  ADD COLUMN "deferredTaxExpenseAccountId" TEXT NULL REFERENCES "account"("id");

-- Create Deferred Tax Expense account (7090) for each company group
-- and set both DTL accounts as defaults
DO $$
DECLARE
  cg RECORD;
  parent_id TEXT;
  dtl_id TEXT;
  dte_id TEXT;
BEGIN
  FOR cg IN SELECT id FROM "companyGroup" LOOP
    -- Find the "Other Expenses" parent (account number 7000, isGroup=true)
    SELECT a.id INTO parent_id
    FROM "account" a
    WHERE a."companyGroupId" = cg.id
      AND a.number = '7000'
      AND a."isGroup" = true
    LIMIT 1;

    -- Create Deferred Tax Expense account
    INSERT INTO "account" (
      number, name, "isGroup", "accountType", "incomeBalance",
      class, "parentId", "companyGroupId", "createdBy"
    ) VALUES (
      '7090', 'Deferred Tax Expense', false, 'Other Expense', 'Income Statement',
      'Expense', parent_id, cg.id, 'system'
    ) RETURNING id INTO dte_id;

    -- Find existing Deferred Tax Liabilities account (2420)
    SELECT a.id INTO dtl_id
    FROM "account" a
    WHERE a."companyGroupId" = cg.id
      AND a.number = '2420'
      AND a."isGroup" = false
    LIMIT 1;

    -- Set defaults for all companies in this group
    UPDATE "accountDefault" ad
    SET "deferredTaxLiabilityAccountId" = dtl_id,
        "deferredTaxExpenseAccountId" = dte_id
    FROM "company" c
    WHERE c.id = ad."companyId"
      AND c."companyGroupId" = cg.id;
  END LOOP;
END $$;

-- Fixed asset class: tax depreciation configuration
ALTER TABLE "fixedAssetClass"
  ADD COLUMN "taxDepreciationMethod" "taxDepreciationMethod" NULL,
  ADD COLUMN "taxUsefulLifeMonths" INTEGER NULL,
  ADD COLUMN "taxResidualValuePercent" NUMERIC(5,2) NULL,
  ADD COLUMN "macrsPropertyClass" "macrsPropertyClass" NULL,
  ADD COLUMN "macrsConvention" "macrsConvention" NULL DEFAULT 'Half-Year',
  ADD COLUMN "bonusDepreciationPercent" NUMERIC(5,2) NULL DEFAULT 0;

-- Fixed asset: accumulated tax depreciation
ALTER TABLE "fixedAsset"
  ADD COLUMN "accumulatedTaxDepreciation" NUMERIC NOT NULL DEFAULT 0;

-- Depreciation run line: tax amount
ALTER TABLE "depreciationRunLine"
  ADD COLUMN "taxAmount" NUMERIC NULL;
