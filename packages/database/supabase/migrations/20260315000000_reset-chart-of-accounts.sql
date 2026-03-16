-- Reset Chart of Accounts
--
-- Replaces old chart of accounts with new tree-based structure for all
-- existing company groups. Temporarily drops FK constraints, clears
-- dependent data, inserts new accounts, re-seeds account defaults,
-- and re-adds all FK constraints.

-- ============================================================
-- Phase 1: Drop all FK constraints referencing account
-- ============================================================

-- Self-referential
ALTER TABLE "account" DROP CONSTRAINT IF EXISTS "account_parentId_fkey";

-- accountDefault (38 FKs)
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
ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_currencyTranslationAccount_fkey";

-- journalLine
ALTER TABLE "journalLine" DROP CONSTRAINT IF EXISTS "journalLine_accountNumber_fkey";

-- purchaseOrderLine
ALTER TABLE "purchaseOrderLine" DROP CONSTRAINT IF EXISTS "purchaseOrderLine_accountNumber_fkey";

-- salesOrderLine
ALTER TABLE "salesOrderLine" DROP CONSTRAINT IF EXISTS "salesOrderLine_accountNumber_fkey";

-- salesInvoiceLine
ALTER TABLE "salesInvoiceLine" DROP CONSTRAINT IF EXISTS "salesInvoiceLine_accountNumber_fkey";

-- purchaseInvoiceLine
ALTER TABLE "purchaseInvoiceLine" DROP CONSTRAINT IF EXISTS "purchaseInvoiceLines_accountNumber_fkey";

-- shippingMethod
ALTER TABLE "shippingMethod" DROP CONSTRAINT IF EXISTS "shippingMethod_carrierAccountId_fkey";


-- ============================================================
-- Phase 2: Delete/null dependent data
-- ============================================================

DELETE FROM "journalLineDimension";
DELETE FROM "journalLine";
DELETE FROM "journal";
DELETE FROM "accountDefault";

UPDATE "purchaseOrderLine" SET "accountNumber" = NULL WHERE "accountNumber" IS NOT NULL;
UPDATE "salesOrderLine" SET "accountNumber" = NULL WHERE "accountNumber" IS NOT NULL;
UPDATE "salesInvoiceLine" SET "accountNumber" = NULL WHERE "accountNumber" IS NOT NULL;
UPDATE "purchaseInvoiceLine" SET "accountNumber" = NULL WHERE "accountNumber" IS NOT NULL;
UPDATE "shippingMethod" SET "carrierAccountId" = NULL WHERE "carrierAccountId" IS NOT NULL;


-- ============================================================
-- Phase 3: Delete all accounts
-- ============================================================

DELETE FROM "account";


-- ============================================================
-- Phase 4: Insert new accounts for every companyGroup
-- ============================================================

DO $$
DECLARE
  cg_id TEXT;
  key_to_id HSTORE;
  acc RECORD;
  new_id TEXT;
  parent_id TEXT;
BEGIN
  FOR cg_id IN SELECT id FROM "companyGroup"
  LOOP
    key_to_id := ''::hstore;

    FOR acc IN
      SELECT *
      FROM (VALUES
        -- BALANCE SHEET
        ('balance-sheet', NULL::TEXT, 'Balance Sheet', TRUE, NULL::TEXT, NULL::TEXT, 'Balance Sheet', NULL::TEXT),

        -- ASSETS
        ('assets', NULL, 'Assets', TRUE, 'balance-sheet', NULL, 'Balance Sheet', 'Asset'),

        ('cash-and-bank', NULL, 'Cash & Bank', TRUE, 'assets', NULL, 'Balance Sheet', 'Asset'),
        ('1010', '1010', 'Bank - Cash', FALSE, 'cash-and-bank', 'Bank', 'Balance Sheet', 'Asset'),
        ('1020', '1020', 'Bank - Local Currency', FALSE, 'cash-and-bank', 'Bank', 'Balance Sheet', 'Asset'),
        ('1030', '1030', 'Bank - Foreign Currency', FALSE, 'cash-and-bank', 'Bank', 'Balance Sheet', 'Asset'),

        ('receivables', NULL, 'Receivables', TRUE, 'assets', NULL, 'Balance Sheet', 'Asset'),
        ('1110', '1110', 'Accounts Receivable', FALSE, 'receivables', 'Accounts Receivable', 'Balance Sheet', 'Asset'),
        ('1120', '1120', 'Inventory Invoiced Not Received', FALSE, 'receivables', 'Accounts Receivable', 'Balance Sheet', 'Asset'),
        ('1130', '1130', 'Inter-Company Receivables', FALSE, 'receivables', 'Accounts Receivable', 'Balance Sheet', 'Asset'),

        ('inventory', NULL, 'Inventory & Stock', TRUE, 'assets', NULL, 'Balance Sheet', 'Asset'),
        ('1210', '1210', 'Inventory', FALSE, 'inventory', 'Inventory', 'Balance Sheet', 'Asset'),
        ('1220', '1220', 'Inventory Interim', FALSE, 'inventory', 'Inventory', 'Balance Sheet', 'Asset'),
        ('1230', '1230', 'Work In Progress (WIP)', FALSE, 'inventory', 'Inventory', 'Balance Sheet', 'Asset'),
        ('1240', '1240', 'Inventory Reserves / Allowances', FALSE, 'inventory', 'Inventory', 'Balance Sheet', 'Asset'),

        ('ppe', NULL, 'Property, Plant & Equipment', TRUE, 'assets', NULL, 'Balance Sheet', 'Asset'),
        ('1310', '1310', 'Fixed Asset Acquisition Cost', FALSE, 'ppe', 'Fixed Asset', 'Balance Sheet', 'Asset'),
        ('1320', '1320', 'Fixed Asset Acquisition Cost on Disposal', FALSE, 'ppe', 'Fixed Asset', 'Balance Sheet', 'Asset'),
        ('1330', '1330', 'Accumulated Depreciation', FALSE, 'ppe', 'Accumulated Depreciation', 'Balance Sheet', 'Asset'),
        ('1340', '1340', 'Accumulated Depreciation on Disposal', FALSE, 'ppe', 'Accumulated Depreciation', 'Balance Sheet', 'Asset'),
        ('1350', '1350', 'Machinery & Equipment', FALSE, 'ppe', 'Fixed Asset', 'Balance Sheet', 'Asset'),
        ('1360', '1360', 'Buildings & Leasehold Improvements', FALSE, 'ppe', 'Fixed Asset', 'Balance Sheet', 'Asset'),

        ('other-assets', NULL, 'Other Assets', TRUE, 'assets', NULL, 'Balance Sheet', 'Asset'),
        ('1410', '1410', 'Intangible Assets', FALSE, 'other-assets', 'Other Asset', 'Balance Sheet', 'Asset'),
        ('1420', '1420', 'Accumulated Amortization', FALSE, 'other-assets', 'Other Asset', 'Balance Sheet', 'Asset'),
        ('1430', '1430', 'Investments in Subsidiaries', FALSE, 'other-assets', 'Investments', 'Balance Sheet', 'Asset'),
        ('1440', '1440', 'Deferred Tax Assets', FALSE, 'other-assets', 'Other Asset', 'Balance Sheet', 'Asset'),

        -- LIABILITIES
        ('liabilities', NULL, 'Liabilities', TRUE, 'balance-sheet', NULL, 'Balance Sheet', 'Liability'),

        ('payables', NULL, 'Payables', TRUE, 'liabilities', NULL, 'Balance Sheet', 'Liability'),
        ('2010', '2010', 'Accounts Payable', FALSE, 'payables', 'Accounts Payable', 'Balance Sheet', 'Liability'),
        ('2020', '2020', 'Inter-Company Payables', FALSE, 'payables', 'Accounts Payable', 'Balance Sheet', 'Liability'),

        ('current-liabilities', NULL, 'Current Liabilities', TRUE, 'liabilities', NULL, 'Balance Sheet', 'Liability'),
        ('2110', '2110', 'Customer Prepayments', FALSE, 'current-liabilities', 'Other Current Liability', 'Balance Sheet', 'Liability'),
        ('2120', '2120', 'Inventory Received Not Invoiced', FALSE, 'current-liabilities', 'Other Current Liability', 'Balance Sheet', 'Liability'),
        ('2130', '2130', 'Inventory Shipped Not Invoiced', FALSE, 'current-liabilities', 'Other Current Liability', 'Balance Sheet', 'Liability'),
        ('2140', '2140', 'Accrued Expenses', FALSE, 'current-liabilities', 'Other Current Liability', 'Balance Sheet', 'Liability'),
        ('2150', '2150', 'Accrued Wages & Salaries', FALSE, 'current-liabilities', 'Other Current Liability', 'Balance Sheet', 'Liability'),
        ('2160', '2160', 'Deferred Revenue', FALSE, 'current-liabilities', 'Other Current Liability', 'Balance Sheet', 'Liability'),
        ('2170', '2170', 'Short-Term Loans', FALSE, 'current-liabilities', 'Other Current Liability', 'Balance Sheet', 'Liability'),

        ('tax-liabilities', NULL, 'Tax Liabilities', TRUE, 'liabilities', NULL, 'Balance Sheet', 'Liability'),
        ('2210', '2210', 'Sales Tax Payable', FALSE, 'tax-liabilities', 'Tax', 'Balance Sheet', 'Liability'),
        ('2220', '2220', 'Purchase Tax Payable', FALSE, 'tax-liabilities', 'Tax', 'Balance Sheet', 'Liability'),
        ('2230', '2230', 'Reverse Charge Tax Payable', FALSE, 'tax-liabilities', 'Tax', 'Balance Sheet', 'Liability'),

        ('long-term-liabilities', NULL, 'Long-Term Liabilities', TRUE, 'liabilities', NULL, 'Balance Sheet', 'Liability'),
        ('2410', '2410', 'Long-Term Debt / Loans', FALSE, 'long-term-liabilities', 'Long Term Liability', 'Balance Sheet', 'Liability'),
        ('2420', '2420', 'Deferred Tax Liabilities', FALSE, 'long-term-liabilities', 'Long Term Liability', 'Balance Sheet', 'Liability'),
        ('2430', '2430', 'Pension Obligations', FALSE, 'long-term-liabilities', 'Long Term Liability', 'Balance Sheet', 'Liability'),

        -- EQUITY
        ('equity', NULL, 'Equity', TRUE, 'balance-sheet', NULL, 'Balance Sheet', 'Equity'),
        ('3010', '3010', 'Common Stock / Share Capital', FALSE, 'equity', 'Equity - No Close', 'Balance Sheet', 'Equity'),
        ('3100', '3100', 'Retained Earnings', FALSE, 'equity', 'Retained Earnings', 'Balance Sheet', 'Equity'),
        ('3200', '3200', 'Reserves (Currency Translation)', FALSE, 'equity', 'Equity - Close', 'Balance Sheet', 'Equity'),
        ('3300', '3300', 'Dividends Payable', FALSE, 'equity', 'Equity - Close', 'Balance Sheet', 'Equity'),

        -- INCOME STATEMENT
        ('income-statement', NULL, 'Income Statement', TRUE, NULL, NULL, 'Income Statement', NULL),

        -- REVENUE
        ('revenue', NULL, 'Revenue', TRUE, 'income-statement', NULL, 'Income Statement', 'Revenue'),
        ('4010', '4010', 'Sales', FALSE, 'revenue', 'Income', 'Income Statement', 'Revenue'),
        ('4020', '4020', 'Sales Discounts', FALSE, 'revenue', 'Income', 'Income Statement', 'Revenue'),
        ('4030', '4030', 'Manufacturing Services Revenue', FALSE, 'revenue', 'Income', 'Income Statement', 'Revenue'),

        ('other-income', NULL, 'Other Income', TRUE, 'income-statement', NULL, 'Income Statement', 'Revenue'),
        ('4110', '4110', 'Scrap Sales', FALSE, 'other-income', 'Other Income', 'Income Statement', 'Revenue'),
        ('4120', '4120', 'Foreign Exchange Gains', FALSE, 'other-income', 'Other Income', 'Income Statement', 'Revenue'),

        -- COST OF GOODS SOLD
        ('cogs', NULL, 'Cost of Goods Sold', TRUE, 'income-statement', NULL, 'Income Statement', 'Expense'),
        ('5010', '5010', 'Cost of Goods Sold - Direct', FALSE, 'cogs', 'Cost of Goods Sold', 'Income Statement', 'Expense'),
        ('5020', '5020', 'Purchases', FALSE, 'cogs', 'Cost of Goods Sold', 'Income Statement', 'Expense'),
        ('5030', '5030', 'Direct Cost Applied', FALSE, 'cogs', 'Cost of Goods Sold', 'Income Statement', 'Expense'),
        ('5040', '5040', 'Overhead Applied', FALSE, 'cogs', 'Cost of Goods Sold', 'Income Statement', 'Expense'),

        ('variances', NULL, 'Variances', TRUE, 'cogs', NULL, 'Income Statement', 'Expense'),
        ('5210', '5210', 'Purchase Variance', FALSE, 'variances', 'Cost of Goods Sold', 'Income Statement', 'Expense'),
        ('5220', '5220', 'Material Variance', FALSE, 'variances', 'Expense', 'Income Statement', 'Expense'),
        ('5230', '5230', 'Capacity Variance', FALSE, 'variances', 'Expense', 'Income Statement', 'Expense'),
        ('5240', '5240', 'Overhead Variance', FALSE, 'variances', 'Expense', 'Income Statement', 'Expense'),

        ('inventory-adjustments', NULL, 'Inventory Adjustments', TRUE, 'cogs', NULL, 'Income Statement', 'Expense'),
        ('5310', '5310', 'Inventory Adjustment', FALSE, 'inventory-adjustments', 'Cost of Goods Sold', 'Income Statement', 'Expense'),

        -- OPERATING EXPENSES
        ('operating-expenses', NULL, 'Operating Expenses', TRUE, 'income-statement', NULL, 'Income Statement', 'Expense'),
        ('6010', '6010', 'Maintenance Expense', FALSE, 'operating-expenses', 'Expense', 'Income Statement', 'Expense'),
        ('6020', '6020', 'Sales Commissions', FALSE, 'operating-expenses', 'Expense', 'Income Statement', 'Expense'),
        ('6030', '6030', 'Advertising & Marketing', FALSE, 'operating-expenses', 'Expense', 'Income Statement', 'Expense'),
        ('6040', '6040', 'Freight & Shipping Out', FALSE, 'operating-expenses', 'Expense', 'Income Statement', 'Expense'),
        ('6050', '6050', 'Bad Debts Expense', FALSE, 'operating-expenses', 'Expense', 'Income Statement', 'Expense'),
        ('6060', '6060', 'Salaries - Administrative', FALSE, 'operating-expenses', 'Expense', 'Income Statement', 'Expense'),
        ('6070', '6070', 'Rent & Utilities (Non-Factory)', FALSE, 'operating-expenses', 'Expense', 'Income Statement', 'Expense'),
        ('6080', '6080', 'Professional Fees', FALSE, 'operating-expenses', 'Expense', 'Income Statement', 'Expense'),
        ('6090', '6090', 'Travel & Entertainment', FALSE, 'operating-expenses', 'Expense', 'Income Statement', 'Expense'),
        ('6100', '6100', 'Insurance', FALSE, 'operating-expenses', 'Expense', 'Income Statement', 'Expense'),
        ('6110', '6110', 'Bank Charges & Fees', FALSE, 'operating-expenses', 'Expense', 'Income Statement', 'Expense'),

        ('depreciation', NULL, 'Depreciation & Amortization', TRUE, 'operating-expenses', NULL, 'Income Statement', 'Expense'),
        ('6310', '6310', 'Depreciation Expense', FALSE, 'depreciation', 'Other Expense', 'Income Statement', 'Expense'),
        ('6320', '6320', 'Gains and Losses on Disposal', FALSE, 'depreciation', 'Other Expense', 'Income Statement', 'Expense'),

        -- OTHER EXPENSES
        ('other-expenses', NULL, 'Other Expenses', TRUE, 'income-statement', NULL, 'Income Statement', 'Expense'),
        ('7010', '7010', 'Interest Expense', FALSE, 'other-expenses', 'Other Expense', 'Income Statement', 'Expense'),
        ('7020', '7020', 'Supplier Payment Discounts', FALSE, 'other-expenses', 'Other Expense', 'Income Statement', 'Expense'),
        ('7030', '7030', 'Customer Payment Discounts', FALSE, 'other-expenses', 'Other Expense', 'Income Statement', 'Expense'),
        ('7040', '7040', 'Service Charge Account', FALSE, 'other-expenses', 'Other Expense', 'Income Statement', 'Expense'),
        ('7050', '7050', 'Rounding Account', FALSE, 'other-expenses', 'Other Expense', 'Income Statement', 'Expense'),
        ('7060', '7060', 'Foreign Exchange Losses', FALSE, 'other-expenses', 'Other Expense', 'Income Statement', 'Expense'),
        ('7070', '7070', 'Income Tax Expense', FALSE, 'other-expenses', 'Other Expense', 'Income Statement', 'Expense'),
        ('7080', '7080', 'R&D Expenses', FALSE, 'other-expenses', 'Other Expense', 'Income Statement', 'Expense')
      ) AS t(key, number, name, is_group, parent_key, account_type, income_balance, class)
    LOOP
      -- Resolve parent
      IF acc.parent_key IS NOT NULL THEN
        parent_id := key_to_id -> acc.parent_key;
      ELSE
        parent_id := NULL;
      END IF;

      -- Insert account
      INSERT INTO "account" (
        number, name, "isGroup", "accountType", "incomeBalance", class,
        "parentId", "companyGroupId", "createdBy"
      ) VALUES (
        acc.number,
        acc.name,
        acc.is_group,
        acc.account_type::"accountType",
        acc.income_balance::"glIncomeBalance",
        acc.class::"glAccountClass",
        parent_id,
        cg_id,
        'system'
      ) RETURNING id INTO new_id;

      -- Track key -> id mapping
      key_to_id := key_to_id || hstore(acc.key, new_id);
    END LOOP;
  END LOOP;
END;
$$;


-- ============================================================
-- Phase 5: Insert accountDefaults for every company
-- ============================================================

-- Add currencyTranslationAccount column
ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "currencyTranslationAccount" TEXT;

INSERT INTO "accountDefault" (
  "companyId", "companyGroupId",
  "salesAccount", "salesDiscountAccount", "costOfGoodsSoldAccount", "purchaseAccount",
  "directCostAppliedAccount", "overheadCostAppliedAccount", "purchaseVarianceAccount",
  "inventoryAdjustmentVarianceAccount", "materialVarianceAccount", "capacityVarianceAccount",
  "overheadAccount", "maintenanceAccount", "assetDepreciationExpenseAccount",
  "assetGainsAndLossesAccount", "serviceChargeAccount", "interestAccount",
  "supplierPaymentDiscountAccount", "customerPaymentDiscountAccount", "roundingAccount",
  "assetAquisitionCostAccount", "assetAquisitionCostOnDisposalAccount",
  "accumulatedDepreciationAccount", "accumulatedDepreciationOnDisposalAccount",
  "inventoryAccount", "inventoryInterimAccrualAccount", "workInProgressAccount",
  "receivablesAccount", "inventoryInvoicedNotReceivedAccount", "bankCashAccount",
  "bankLocalCurrencyAccount", "bankForeignCurrencyAccount", "prepaymentAccount",
  "payablesAccount", "inventoryReceivedNotInvoicedAccount", "inventoryShippedNotInvoicedAccount",
  "salesTaxPayableAccount", "purchaseTaxPayableAccount", "reverseChargeSalesTaxPayableAccount",
  "retainedEarningsAccount", "currencyTranslationAccount"
)
SELECT
  c.id,
  c."companyGroupId",
  '4010', '4020', '5010', '5020',
  '5030', '5040', '5210',
  '5310', '5220', '5230',
  '5240', '6010', '6310',
  '6320', '7040', '7010',
  '7020', '7030', '7050',
  '1310', '1320',
  '1330', '1340',
  '1210', '1220', '1230',
  '1110', '1120', '1010',
  '1020', '1030', '2110',
  '2010', '2120', '2130',
  '2210', '2220', '2230',
  '3100', '3200'
FROM company c
WHERE c."companyGroupId" IS NOT NULL;

ALTER TABLE "accountDefault" ALTER COLUMN "currencyTranslationAccount" SET NOT NULL;


-- ============================================================
-- Phase 6: Re-add all FK constraints
-- ============================================================

-- Self-referential
ALTER TABLE "account" ADD CONSTRAINT "account_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- accountDefault (38 FKs)
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
ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_currencyTranslationAccount_fkey"
  FOREIGN KEY ("currencyTranslationAccount", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- journalLine
ALTER TABLE "journalLine" ADD CONSTRAINT "journalLine_accountNumber_fkey"
  FOREIGN KEY ("accountNumber", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- purchaseOrderLine
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_accountNumber_fkey"
  FOREIGN KEY ("accountNumber", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- salesOrderLine
ALTER TABLE "salesOrderLine" ADD CONSTRAINT "salesOrderLine_accountNumber_fkey"
  FOREIGN KEY ("accountNumber", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- salesInvoiceLine
ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_accountNumber_fkey"
  FOREIGN KEY ("accountNumber", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- purchaseInvoiceLine
ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLines_accountNumber_fkey"
  FOREIGN KEY ("accountNumber", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- shippingMethod
ALTER TABLE "shippingMethod" ADD CONSTRAINT "shippingMethod_carrierAccountId_fkey"
  FOREIGN KEY ("carrierAccountId", "companyGroupId") REFERENCES "account"("number", "companyGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
