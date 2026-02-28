-- Company Groups: infrastructure for multi-entity, multi-currency accounting.
-- A company group is a collection of companies sharing financial infrastructure
-- (chart of accounts, dimensions, currencies). Each company maintains its own
-- operational data (journals, orders, invoices).

-- =====================================================
-- PART 1: Company Group Infrastructure
-- =====================================================

CREATE TABLE "companyGroup" (
  "id" TEXT NOT NULL DEFAULT id('cg'),
  "name" TEXT NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "companyGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "companyGroup_name_key" UNIQUE ("name"),
  CONSTRAINT "companyGroup_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "companyGroup_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

-- Service role only — no user-level RLS policies
ALTER TABLE "companyGroup" ENABLE ROW LEVEL SECURITY;

-- Add company group and hierarchy columns to company table
ALTER TABLE "company" ADD COLUMN "companyGroupId" TEXT;
ALTER TABLE "company" ADD COLUMN "parentCompanyId" TEXT;
ALTER TABLE "company" ADD COLUMN "isEliminationEntity" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "company" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "company"
  ADD CONSTRAINT "company_companyGroupId_fkey"
  FOREIGN KEY ("companyGroupId") REFERENCES "companyGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "company"
  ADD CONSTRAINT "company_parentCompanyId_fkey"
  FOREIGN KEY ("parentCompanyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "company_companyGroupId_idx" ON "company"("companyGroupId");
CREATE INDEX "company_parentCompanyId_idx" ON "company"("parentCompanyId");

-- Backfill: create a companyGroup for each existing company
DO $$
DECLARE
  comp RECORD;
  new_group_id TEXT;
BEGIN
  FOR comp IN SELECT "id", "name" FROM "company" LOOP
    INSERT INTO "companyGroup" ("name")
    VALUES (comp."name")
    RETURNING "id" INTO new_group_id;

    UPDATE "company" SET "companyGroupId" = new_group_id WHERE "id" = comp."id";
  END LOOP;
END;
$$;

-- =====================================================
-- PART 2: RLS Helper Functions
-- =====================================================

-- Returns companyGroup IDs where the user is an employee
-- in at least one member company. Used for SELECT policies
-- on group-scoped tables.
CREATE OR REPLACE FUNCTION get_company_groups_for_employee()
RETURNS text[]
LANGUAGE "plpgsql" SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  employee_companies text[];
  group_ids text[];
  api_key_company text;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    SELECT ARRAY["companyGroupId"::text]
    INTO group_ids
    FROM "company"
    WHERE "id" = api_key_company
      AND "companyGroupId" IS NOT NULL;
    RETURN COALESCE(group_ids, '{}');
  END IF;

  SELECT array_agg("companyId"::text)
  INTO employee_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text AND "role" = 'employee';

  IF employee_companies IS NULL THEN
    RETURN '{}';
  END IF;

  SELECT array_agg(DISTINCT "companyGroupId"::text)
  INTO group_ids
  FROM "company"
  WHERE "id" = ANY(employee_companies)
    AND "companyGroupId" IS NOT NULL;

  RETURN COALESCE(group_ids, '{}');
END;
$$;

-- Returns companyGroup IDs where the user has the given
-- permission on the root company (parentCompanyId IS NULL).
-- Used for INSERT/UPDATE/DELETE policies on group-scoped tables.
CREATE OR REPLACE FUNCTION get_company_groups_for_root_permission(permission text)
RETURNS text[]
LANGUAGE "plpgsql" SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  permitted_companies text[];
  group_ids text[];
BEGIN
  permitted_companies := get_companies_with_employee_permission(permission);

  IF permitted_companies IS NULL OR array_length(permitted_companies, 1) IS NULL THEN
    RETURN '{}';
  END IF;

  -- Only consider root companies (no parent)
  SELECT array_agg(DISTINCT "companyGroupId"::text)
  INTO group_ids
  FROM "company"
  WHERE "id" = ANY(permitted_companies)
    AND "parentCompanyId" IS NULL
    AND "companyGroupId" IS NOT NULL;

  RETURN COALESCE(group_ids, '{}');
END;
$$;

-- =====================================================
-- PART 3: Drop Dependent Objects
-- =====================================================

-- 3a. Drop views
DROP VIEW IF EXISTS "accounts";
DROP VIEW IF EXISTS "accountCategories";
DROP VIEW IF EXISTS "currencies";

-- 3b. Drop composite FKs from operational tables → account

-- accountDefault (38 account FKs)
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_salesAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_salesDiscountAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_costOfGoodsSoldAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_purchaseAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_directCostAppliedAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_overheadCostAppliedAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_purchaseVarianceAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_inventoryAdjustmentVarianceAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_materialVarianceAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_capacityVarianceAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_overheadAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_maintenanceAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_assetDepreciationExpenseAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_assetGainsAndLossesAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_serviceChargeAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_interestAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_supplierPaymentDiscountAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_customerPaymentDiscountAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_roundingAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_aquisitionCostAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_aquisitionCostOnDisposalAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_accumulatedDepreciationAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_accumulatedDepreciationOnDisposalAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_inventoryAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_inventoryInterimAccrualAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_workInProgressAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_receivablesAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_inventoryShippedNotInvoicedAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_bankCashAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_bankLocalCurrencyAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_bankForeignCurrencyAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_prepaymentAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_payablesAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_inventoryReceivedNotInvoicedAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_salesTaxPayableAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_reverseChargeSalesTaxPayableAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_purchaseTaxPayableAccount_fkey";
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_retainedEarningsAccount_fkey";

-- postingGroupInventory (14 account FKs)
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_costOfGoodsSoldAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_inventoryAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_inventoryInterimAccrualAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_inventoryReceivedNotInvoicedAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_inventoryInvoicedNotReceivedAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_inventoryShippedNotInvoicedAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_workInProgressAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_directCostAppliedAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_overheadCostAppliedAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_purchaseVarianceAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_inventoryAdjustmentVarianceAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_materialVarianceAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_capacityVarianceAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT IF EXISTS "postingGroupInventory_overheadAccount_fkey";

-- postingGroupPurchasing (6 account FKs)
ALTER TABLE "postingGroupPurchasing" DROP CONSTRAINT IF EXISTS "postingGroupPurchasing_payablesAccount_fkey";
ALTER TABLE "postingGroupPurchasing" DROP CONSTRAINT IF EXISTS "postingGroupPurchasing_purchaseAccount_fkey";
ALTER TABLE "postingGroupPurchasing" DROP CONSTRAINT IF EXISTS "postingGroupPurchasing_purchaseDiscountAccount_fkey";
ALTER TABLE "postingGroupPurchasing" DROP CONSTRAINT IF EXISTS "postingGroupPurchasing_purchaseCreditAccount_fkey";
ALTER TABLE "postingGroupPurchasing" DROP CONSTRAINT IF EXISTS "postingGroupPurchasing_purchasePrepaymentAccount_fkey";
ALTER TABLE "postingGroupPurchasing" DROP CONSTRAINT IF EXISTS "postingGroupPurchasing_purchaseTaxPayableAccount_fkey";

-- postingGroupSales (6 account FKs)
ALTER TABLE "postingGroupSales" DROP CONSTRAINT IF EXISTS "postingGroupSales_receivablesAccount_fkey";
ALTER TABLE "postingGroupSales" DROP CONSTRAINT IF EXISTS "postingGroupSales_salesAccount_fkey";
ALTER TABLE "postingGroupSales" DROP CONSTRAINT IF EXISTS "postingGroupSales_salesDiscountAccount_fkey";
ALTER TABLE "postingGroupSales" DROP CONSTRAINT IF EXISTS "postingGroupSales_salesCreditAccount_fkey";
ALTER TABLE "postingGroupSales" DROP CONSTRAINT IF EXISTS "postingGroupSales_salesPrepaymentAccount_fkey";
ALTER TABLE "postingGroupSales" DROP CONSTRAINT IF EXISTS "postingGroupSales_salesTaxPayableAccount_fkey";

-- journalLine
ALTER TABLE "journalLine" DROP CONSTRAINT IF EXISTS "journalLine_accountNumber_fkey";

-- purchaseOrderLine
ALTER TABLE "purchaseOrderLine" DROP CONSTRAINT IF EXISTS "purchaseOrderLine_accountNumber_fkey";

-- salesOrderLine
ALTER TABLE "salesOrderLine" DROP CONSTRAINT IF EXISTS "salesOrderLine_accountNumber_fkey";

-- salesInvoiceLine
ALTER TABLE "salesInvoiceLine" DROP CONSTRAINT IF EXISTS "salesInvoiceLine_accountNumber_fkey";

-- purchaseInvoiceLine (note: table is singular, constraint names are plural)
ALTER TABLE "purchaseInvoiceLine" DROP CONSTRAINT IF EXISTS "purchaseInvoiceLines_accountNumber_fkey";

-- shippingMethod
ALTER TABLE "shippingMethod" DROP CONSTRAINT IF EXISTS "shippingMethod_carrierAccountId_fkey";

-- 3c. Drop composite FKs from operational tables → currency
ALTER TABLE "purchaseInvoice" DROP CONSTRAINT IF EXISTS "purchaseInvoice_currencyCode_fkey";
ALTER TABLE "purchaseInvoiceLine" DROP CONSTRAINT IF EXISTS "purchaseInvoiceLines_currencyCode_fkey";
ALTER TABLE "purchasePayment" DROP CONSTRAINT IF EXISTS "purchasePayment_currencyCode_fkey";
ALTER TABLE "purchaseOrderPayment" DROP CONSTRAINT IF EXISTS "purchaseOrderPayment_currencyCode_fkey";
ALTER TABLE "salesOrder" DROP CONSTRAINT IF EXISTS "salesOrder_currencyCode_fkey";
ALTER TABLE "salesOrderPayment" DROP CONSTRAINT IF EXISTS "salesOrderPayment_currencyCode_fkey";
ALTER TABLE "itemUnitSalePrice" DROP CONSTRAINT IF EXISTS "itemUnitSalePrice_currencyCode_fkey";
ALTER TABLE "supplierPayment" DROP CONSTRAINT IF EXISTS "supplierPayment_currencyCode_fkey";
ALTER TABLE "customerPayment" DROP CONSTRAINT IF EXISTS "customerPayment_currencyCode_fkey";
ALTER TABLE "quotePayment" DROP CONSTRAINT IF EXISTS "quotePayment_currencyCode_fkey";

-- 3d. Drop old RLS policies on shared tables
DROP POLICY IF EXISTS "SELECT" ON "public"."account";
DROP POLICY IF EXISTS "INSERT" ON "public"."account";
DROP POLICY IF EXISTS "UPDATE" ON "public"."account";
DROP POLICY IF EXISTS "DELETE" ON "public"."account";

DROP POLICY IF EXISTS "SELECT" ON "public"."accountCategory";
DROP POLICY IF EXISTS "INSERT" ON "public"."accountCategory";
DROP POLICY IF EXISTS "UPDATE" ON "public"."accountCategory";
DROP POLICY IF EXISTS "DELETE" ON "public"."accountCategory";

DROP POLICY IF EXISTS "SELECT" ON "public"."accountSubcategory";
DROP POLICY IF EXISTS "INSERT" ON "public"."accountSubcategory";
DROP POLICY IF EXISTS "UPDATE" ON "public"."accountSubcategory";
DROP POLICY IF EXISTS "DELETE" ON "public"."accountSubcategory";

DROP POLICY IF EXISTS "SELECT" ON "public"."currency";
DROP POLICY IF EXISTS "UPDATE" ON "public"."currency";
DROP POLICY IF EXISTS "Employees with accounting_create can insert currencies" ON "public"."currency";
DROP POLICY IF EXISTS "Employees with accounting_delete can delete currencies" ON "public"."currency";

-- =====================================================
-- PART 4: Migrate Shared Tables
-- =====================================================

-- 4a. account: companyId → companyGroupId

ALTER TABLE "account" ADD COLUMN "companyGroupId" TEXT;
UPDATE "account" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "account"."companyId";
ALTER TABLE "account" ALTER COLUMN "companyGroupId" SET NOT NULL;

ALTER TABLE "account" DROP CONSTRAINT IF EXISTS "account_number_key";
ALTER TABLE "account" DROP CONSTRAINT IF EXISTS "account_name_key";
ALTER TABLE "account" DROP CONSTRAINT IF EXISTS "account_companyId_fkey";
DROP INDEX IF EXISTS "account_number_idx";
DROP INDEX IF EXISTS "account_type_idx";
DROP INDEX IF EXISTS "account_incomeBalance_idx";
DROP INDEX IF EXISTS "account_accountCategoryId_idx";
DROP INDEX IF EXISTS "account_class_idx";
DROP INDEX IF EXISTS "account_companyId_idx";

ALTER TABLE "account" DROP COLUMN "companyId";

ALTER TABLE "account" ADD CONSTRAINT "account_companyGroupId_fkey"
  FOREIGN KEY ("companyGroupId") REFERENCES "companyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account" ADD CONSTRAINT "account_number_key" UNIQUE ("number", "companyGroupId");
ALTER TABLE "account" ADD CONSTRAINT "account_name_key" UNIQUE ("name", "companyGroupId");

CREATE INDEX "account_companyGroupId_idx" ON "account"("companyGroupId");
CREATE INDEX "account_number_idx" ON "account"("number", "companyGroupId");
CREATE INDEX "account_type_idx" ON "account"("type", "companyGroupId");
CREATE INDEX "account_incomeBalance_idx" ON "account"("incomeBalance", "companyGroupId");
CREATE INDEX "account_accountCategoryId_idx" ON "account"("accountCategoryId", "companyGroupId");
CREATE INDEX "account_class_idx" ON "account"("class", "companyGroupId");

-- 4b. accountCategory: companyId → companyGroupId

ALTER TABLE "accountCategory" ADD COLUMN "companyGroupId" TEXT;
UPDATE "accountCategory" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "accountCategory"."companyId";
ALTER TABLE "accountCategory" ALTER COLUMN "companyGroupId" SET NOT NULL;

ALTER TABLE "accountCategory" DROP CONSTRAINT IF EXISTS "accountCategory_unique_category";
ALTER TABLE "accountCategory" DROP CONSTRAINT IF EXISTS "accountCategory_companyId_fkey";
DROP INDEX IF EXISTS "accountCategory_companyId_idx";

ALTER TABLE "accountCategory" DROP COLUMN "companyId";

ALTER TABLE "accountCategory" ADD CONSTRAINT "accountCategory_companyGroupId_fkey"
  FOREIGN KEY ("companyGroupId") REFERENCES "companyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accountCategory" ADD CONSTRAINT "accountCategory_unique_category" UNIQUE ("category", "companyGroupId");

CREATE INDEX "accountCategory_companyGroupId_idx" ON "accountCategory"("companyGroupId");

-- 4c. currency: companyId → companyGroupId

ALTER TABLE "currency" ADD COLUMN "companyGroupId" TEXT;
UPDATE "currency" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "currency"."companyId";
ALTER TABLE "currency" ALTER COLUMN "companyGroupId" SET NOT NULL;

ALTER TABLE "currency" DROP CONSTRAINT IF EXISTS "currency_code_key";
ALTER TABLE "currency" DROP CONSTRAINT IF EXISTS "currency_companyId_fkey";

ALTER TABLE "currency" DROP COLUMN "companyId";

ALTER TABLE "currency" ADD CONSTRAINT "currency_companyGroupId_fkey"
  FOREIGN KEY ("companyGroupId") REFERENCES "companyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "currency" ADD CONSTRAINT "currency_code_key" UNIQUE ("code", "companyGroupId");

CREATE INDEX "currency_companyGroupId_idx" ON "currency"("companyGroupId");

-- =====================================================
-- PART 5: Add companyGroupId to Operational Tables
-- =====================================================

-- Helper: backfill companyGroupId from company for all operational tables
-- Each table keeps its companyId (for operational scoping) and gains
-- companyGroupId (for FK references to group-scoped tables).

-- accountDefault
ALTER TABLE "accountDefault" ADD COLUMN "companyGroupId" TEXT;
UPDATE "accountDefault" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "accountDefault"."companyId";
ALTER TABLE "accountDefault" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "accountDefault_companyGroupId_idx" ON "accountDefault"("companyGroupId");

ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_salesAccount_fkey"
  FOREIGN KEY ("salesAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_salesDiscountAccount_fkey"
  FOREIGN KEY ("salesDiscountAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_costOfGoodsSoldAccount_fkey"
  FOREIGN KEY ("costOfGoodsSoldAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_purchaseAccount_fkey"
  FOREIGN KEY ("purchaseAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_directCostAppliedAccount_fkey"
  FOREIGN KEY ("directCostAppliedAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_overheadCostAppliedAccount_fkey"
  FOREIGN KEY ("overheadCostAppliedAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_purchaseVarianceAccount_fkey"
  FOREIGN KEY ("purchaseVarianceAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_inventoryAdjustmentVarianceAccount_fkey"
  FOREIGN KEY ("inventoryAdjustmentVarianceAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_materialVarianceAccount_fkey"
  FOREIGN KEY ("materialVarianceAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_capacityVarianceAccount_fkey"
  FOREIGN KEY ("capacityVarianceAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_overheadAccount_fkey"
  FOREIGN KEY ("overheadAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_maintenanceAccount_fkey"
  FOREIGN KEY ("maintenanceAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_assetDepreciationExpenseAccount_fkey"
  FOREIGN KEY ("assetDepreciationExpenseAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_assetGainsAndLossesAccount_fkey"
  FOREIGN KEY ("assetGainsAndLossesAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_serviceChargeAccount_fkey"
  FOREIGN KEY ("serviceChargeAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_interestAccount_fkey"
  FOREIGN KEY ("interestAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_supplierPaymentDiscountAccount_fkey"
  FOREIGN KEY ("supplierPaymentDiscountAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_customerPaymentDiscountAccount_fkey"
  FOREIGN KEY ("customerPaymentDiscountAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_roundingAccount_fkey"
  FOREIGN KEY ("roundingAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_aquisitionCostAccount_fkey"
  FOREIGN KEY ("assetAquisitionCostAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_aquisitionCostOnDisposalAccount_fkey"
  FOREIGN KEY ("assetAquisitionCostOnDisposalAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_accumulatedDepreciationAccount_fkey"
  FOREIGN KEY ("accumulatedDepreciationAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_accumulatedDepreciationOnDisposalAccount_fkey"
  FOREIGN KEY ("accumulatedDepreciationOnDisposalAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_inventoryAccount_fkey"
  FOREIGN KEY ("inventoryAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_inventoryInterimAccrualAccount_fkey"
  FOREIGN KEY ("inventoryInterimAccrualAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_workInProgressAccount_fkey"
  FOREIGN KEY ("workInProgressAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_receivablesAccount_fkey"
  FOREIGN KEY ("receivablesAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_inventoryShippedNotInvoicedAccount_fkey"
  FOREIGN KEY ("inventoryShippedNotInvoicedAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_bankCashAccount_fkey"
  FOREIGN KEY ("bankCashAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_bankLocalCurrencyAccount_fkey"
  FOREIGN KEY ("bankLocalCurrencyAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_bankForeignCurrencyAccount_fkey"
  FOREIGN KEY ("bankForeignCurrencyAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_prepaymentAccount_fkey"
  FOREIGN KEY ("prepaymentAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_payablesAccount_fkey"
  FOREIGN KEY ("payablesAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_inventoryReceivedNotInvoicedAccount_fkey"
  FOREIGN KEY ("inventoryReceivedNotInvoicedAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_salesTaxPayableAccount_fkey"
  FOREIGN KEY ("salesTaxPayableAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_reverseChargeSalesTaxPayableAccount_fkey"
  FOREIGN KEY ("reverseChargeSalesTaxPayableAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_purchaseTaxPayableAccount_fkey"
  FOREIGN KEY ("purchaseTaxPayableAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_retainedEarningsAccount_fkey"
  FOREIGN KEY ("retainedEarningsAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- postingGroupInventory
ALTER TABLE "postingGroupInventory" ADD COLUMN "companyGroupId" TEXT;
UPDATE "postingGroupInventory" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "postingGroupInventory"."companyId";
ALTER TABLE "postingGroupInventory" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "postingGroupInventory_companyGroupId_idx" ON "postingGroupInventory"("companyGroupId");

ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_costOfGoodsSoldAccount_fkey"
  FOREIGN KEY ("costOfGoodsSoldAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_inventoryAccount_fkey"
  FOREIGN KEY ("inventoryAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_inventoryInterimAccrualAccount_fkey"
  FOREIGN KEY ("inventoryInterimAccrualAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_inventoryReceivedNotInvoicedAccount_fkey"
  FOREIGN KEY ("inventoryReceivedNotInvoicedAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_inventoryInvoicedNotReceivedAccount_fkey"
  FOREIGN KEY ("inventoryInvoicedNotReceivedAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_inventoryShippedNotInvoicedAccount_fkey"
  FOREIGN KEY ("inventoryShippedNotInvoicedAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_workInProgressAccount_fkey"
  FOREIGN KEY ("workInProgressAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_directCostAppliedAccount_fkey"
  FOREIGN KEY ("directCostAppliedAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_overheadCostAppliedAccount_fkey"
  FOREIGN KEY ("overheadCostAppliedAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_purchaseVarianceAccount_fkey"
  FOREIGN KEY ("purchaseVarianceAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_inventoryAdjustmentVarianceAccount_fkey"
  FOREIGN KEY ("inventoryAdjustmentVarianceAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_materialVarianceAccount_fkey"
  FOREIGN KEY ("materialVarianceAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_capacityVarianceAccount_fkey"
  FOREIGN KEY ("capacityVarianceAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_overheadAccount_fkey"
  FOREIGN KEY ("overheadAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;

-- postingGroupPurchasing
ALTER TABLE "postingGroupPurchasing" ADD COLUMN "companyGroupId" TEXT;
UPDATE "postingGroupPurchasing" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "postingGroupPurchasing"."companyId";
ALTER TABLE "postingGroupPurchasing" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "postingGroupPurchasing_companyGroupId_idx" ON "postingGroupPurchasing"("companyGroupId");

ALTER TABLE "postingGroupPurchasing" ADD CONSTRAINT "postingGroupPurchasing_payablesAccount_fkey"
  FOREIGN KEY ("payablesAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "postingGroupPurchasing" ADD CONSTRAINT "postingGroupPurchasing_purchaseAccount_fkey"
  FOREIGN KEY ("purchaseAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "postingGroupPurchasing" ADD CONSTRAINT "postingGroupPurchasing_purchaseDiscountAccount_fkey"
  FOREIGN KEY ("purchaseDiscountAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "postingGroupPurchasing" ADD CONSTRAINT "postingGroupPurchasing_purchaseCreditAccount_fkey"
  FOREIGN KEY ("purchaseCreditAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "postingGroupPurchasing" ADD CONSTRAINT "postingGroupPurchasing_purchasePrepaymentAccount_fkey"
  FOREIGN KEY ("purchasePrepaymentAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "postingGroupPurchasing" ADD CONSTRAINT "postingGroupPurchasing_purchaseTaxPayableAccount_fkey"
  FOREIGN KEY ("purchaseTaxPayableAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- postingGroupSales
ALTER TABLE "postingGroupSales" ADD COLUMN "companyGroupId" TEXT;
UPDATE "postingGroupSales" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "postingGroupSales"."companyId";
ALTER TABLE "postingGroupSales" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "postingGroupSales_companyGroupId_idx" ON "postingGroupSales"("companyGroupId");

ALTER TABLE "postingGroupSales" ADD CONSTRAINT "postingGroupSales_receivablesAccount_fkey"
  FOREIGN KEY ("receivablesAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "postingGroupSales" ADD CONSTRAINT "postingGroupSales_salesAccount_fkey"
  FOREIGN KEY ("salesAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "postingGroupSales" ADD CONSTRAINT "postingGroupSales_salesDiscountAccount_fkey"
  FOREIGN KEY ("salesDiscountAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "postingGroupSales" ADD CONSTRAINT "postingGroupSales_salesCreditAccount_fkey"
  FOREIGN KEY ("salesCreditAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "postingGroupSales" ADD CONSTRAINT "postingGroupSales_salesPrepaymentAccount_fkey"
  FOREIGN KEY ("salesPrepaymentAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "postingGroupSales" ADD CONSTRAINT "postingGroupSales_salesTaxPayableAccount_fkey"
  FOREIGN KEY ("salesTaxPayableAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- journalLine
ALTER TABLE "journalLine" ADD COLUMN "companyGroupId" TEXT;
UPDATE "journalLine" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "journalLine"."companyId";
ALTER TABLE "journalLine" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "journalLine_companyGroupId_idx" ON "journalLine"("companyGroupId");

ALTER TABLE "journalLine" ADD CONSTRAINT "journalLine_accountNumber_fkey"
  FOREIGN KEY ("accountNumber", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON UPDATE CASCADE ON DELETE SET NULL;

-- purchaseOrderLine
ALTER TABLE "purchaseOrderLine" ADD COLUMN "companyGroupId" TEXT;
UPDATE "purchaseOrderLine" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "purchaseOrderLine"."companyId";
ALTER TABLE "purchaseOrderLine" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "purchaseOrderLine_companyGroupId_idx" ON "purchaseOrderLine"("companyGroupId");

ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_accountNumber_fkey"
  FOREIGN KEY ("accountNumber", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- salesOrderLine
ALTER TABLE "salesOrderLine" ADD COLUMN "companyGroupId" TEXT;
UPDATE "salesOrderLine" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "salesOrderLine"."companyId";
ALTER TABLE "salesOrderLine" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "salesOrderLine_companyGroupId_idx" ON "salesOrderLine"("companyGroupId");

ALTER TABLE "salesOrderLine" ADD CONSTRAINT "salesOrderLine_accountNumber_fkey"
  FOREIGN KEY ("accountNumber", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;

-- salesInvoiceLine
ALTER TABLE "salesInvoiceLine" ADD COLUMN "companyGroupId" TEXT;
UPDATE "salesInvoiceLine" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "salesInvoiceLine"."companyId";
ALTER TABLE "salesInvoiceLine" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "salesInvoiceLine_companyGroupId_idx" ON "salesInvoiceLine"("companyGroupId");

ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_accountNumber_fkey"
  FOREIGN KEY ("accountNumber", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;

-- purchaseInvoiceLine
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "companyGroupId" TEXT;
UPDATE "purchaseInvoiceLine" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "purchaseInvoiceLine"."companyId";
ALTER TABLE "purchaseInvoiceLine" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "purchaseInvoiceLine_companyGroupId_idx" ON "purchaseInvoiceLine"("companyGroupId");

ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLines_accountNumber_fkey"
  FOREIGN KEY ("accountNumber", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;

-- shippingMethod
ALTER TABLE "shippingMethod" ADD COLUMN "companyGroupId" TEXT;
UPDATE "shippingMethod" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "shippingMethod"."companyId";
ALTER TABLE "shippingMethod" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "shippingMethod_companyGroupId_idx" ON "shippingMethod"("companyGroupId");

ALTER TABLE "shippingMethod" ADD CONSTRAINT "shippingMethod_carrierAccountId_fkey"
  FOREIGN KEY ("carrierAccountId", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Currency FK tables

-- purchaseInvoice
ALTER TABLE "purchaseInvoice" ADD COLUMN "companyGroupId" TEXT;
UPDATE "purchaseInvoice" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "purchaseInvoice"."companyId";
ALTER TABLE "purchaseInvoice" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "purchaseInvoice_companyGroupId_idx" ON "purchaseInvoice"("companyGroupId");

ALTER TABLE "purchaseInvoice" ADD CONSTRAINT "purchaseInvoice_currencyCode_fkey"
  FOREIGN KEY ("currencyCode", "companyGroupId") REFERENCES "currency"("code", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- purchasePayment
ALTER TABLE "purchasePayment" ADD COLUMN "companyGroupId" TEXT;
UPDATE "purchasePayment" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "purchasePayment"."companyId";
ALTER TABLE "purchasePayment" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "purchasePayment_companyGroupId_idx" ON "purchasePayment"("companyGroupId");

ALTER TABLE "purchasePayment" ADD CONSTRAINT "purchasePayment_currencyCode_fkey"
  FOREIGN KEY ("currencyCode", "companyGroupId") REFERENCES "currency"("code", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- itemUnitSalePrice
ALTER TABLE "itemUnitSalePrice" ADD COLUMN "companyGroupId" TEXT;
UPDATE "itemUnitSalePrice" SET "companyGroupId" = c."companyGroupId"
  FROM "company" c WHERE c."id" = "itemUnitSalePrice"."companyId";
ALTER TABLE "itemUnitSalePrice" ALTER COLUMN "companyGroupId" SET NOT NULL;
CREATE INDEX "itemUnitSalePrice_companyGroupId_idx" ON "itemUnitSalePrice"("companyGroupId");

ALTER TABLE "itemUnitSalePrice" ADD CONSTRAINT "itemUnitSalePrice_currencyCode_fkey"
  FOREIGN KEY ("currencyCode", "companyGroupId") REFERENCES "currency"("code", "companyGroupId") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================
-- PART 6: New RLS Policies on Shared Tables
-- =====================================================

-- account: SELECT for any employee in group, write for root company permission
CREATE POLICY "SELECT" ON "public"."account"
FOR SELECT USING (
  "companyGroupId" = ANY (
    (SELECT get_company_groups_for_employee())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."account"
FOR INSERT WITH CHECK (
  "companyGroupId" = ANY (
    (SELECT get_company_groups_for_root_permission('accounting_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."account"
FOR UPDATE USING (
  "companyGroupId" = ANY (
    (SELECT get_company_groups_for_root_permission('accounting_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."account"
FOR DELETE USING (
  "companyGroupId" = ANY (
    (SELECT get_company_groups_for_root_permission('accounting_delete'))::text[]
  )
);

-- accountCategory: same pattern as account
CREATE POLICY "SELECT" ON "public"."accountCategory"
FOR SELECT USING (
  "companyGroupId" = ANY (
    (SELECT get_company_groups_for_employee())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."accountCategory"
FOR INSERT WITH CHECK (
  "companyGroupId" = ANY (
    (SELECT get_company_groups_for_root_permission('accounting_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."accountCategory"
FOR UPDATE USING (
  "companyGroupId" = ANY (
    (SELECT get_company_groups_for_root_permission('accounting_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."accountCategory"
FOR DELETE USING (
  "companyGroupId" = ANY (
    (SELECT get_company_groups_for_root_permission('accounting_delete'))::text[]
  )
);

-- accountSubcategory: derives group from accountCategory
CREATE POLICY "SELECT" ON "public"."accountSubcategory"
FOR SELECT USING (
  (SELECT "companyGroupId" FROM "accountCategory" WHERE "id" = "accountCategoryId") = ANY (
    (SELECT get_company_groups_for_employee())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."accountSubcategory"
FOR INSERT WITH CHECK (
  (SELECT "companyGroupId" FROM "accountCategory" WHERE "id" = "accountCategoryId") = ANY (
    (SELECT get_company_groups_for_root_permission('accounting_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."accountSubcategory"
FOR UPDATE USING (
  (SELECT "companyGroupId" FROM "accountCategory" WHERE "id" = "accountCategoryId") = ANY (
    (SELECT get_company_groups_for_root_permission('accounting_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."accountSubcategory"
FOR DELETE USING (
  (SELECT "companyGroupId" FROM "accountCategory" WHERE "id" = "accountCategoryId") = ANY (
    (SELECT get_company_groups_for_root_permission('accounting_delete'))::text[]
  )
);

-- currency: SELECT for any employee in group, write for root company permission
CREATE POLICY "SELECT" ON "public"."currency"
FOR SELECT USING (
  "companyGroupId" = ANY (
    (SELECT get_company_groups_for_employee())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."currency"
FOR INSERT WITH CHECK (
  "companyGroupId" = ANY (
    (SELECT get_company_groups_for_root_permission('accounting_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."currency"
FOR UPDATE USING (
  "companyGroupId" = ANY (
    (SELECT get_company_groups_for_root_permission('accounting_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."currency"
FOR DELETE USING (
  "companyGroupId" = ANY (
    (SELECT get_company_groups_for_root_permission('accounting_delete'))::text[]
  )
);

-- =====================================================
-- PART 7: Recreate Views
-- =====================================================

CREATE OR REPLACE VIEW "accountCategories" WITH(SECURITY_INVOKER=true) AS
  SELECT
    "id",
    "category",
    "class",
    "incomeBalance",
    "companyGroupId",
    "createdBy",
    "createdAt",
    "updatedBy",
    "updatedAt",
    "customFields",
    (SELECT count(*) FROM "accountSubcategory" WHERE "accountSubcategory"."accountCategoryId" = "accountCategory"."id" AND "accountSubcategory"."active" = true) AS "subCategoriesCount"
  FROM "accountCategory"
;

CREATE OR REPLACE VIEW "accounts" WITH(SECURITY_INVOKER=true) AS
  SELECT
    "account".*,
    (SELECT "category" FROM "accountCategory" WHERE "accountCategory"."id" = "account"."accountCategoryId") AS "accountCategory",
    (SELECT "name" FROM "accountSubcategory" WHERE "accountSubcategory"."id" = "account"."accountSubcategoryId") AS "accountSubCategory"
  FROM "account"
;

CREATE OR REPLACE VIEW "currencies" WITH(SECURITY_INVOKER=true) AS
  SELECT c.*, cc."name"
  FROM "currency" c
  INNER JOIN "currencyCode" cc
    ON cc."code" = c."code";
