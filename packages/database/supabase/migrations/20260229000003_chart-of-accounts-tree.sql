-- Chart of Accounts: Refactor from Begin Total / End Total to parent-child tree
--
-- This migration:
-- 1. Adds parentId (self-referential FK), isGroup, and accountType columns
-- 2. Migrates existing data (Begin Total -> group, Posting -> ledger)
-- 3. Deletes End Total and Total accounts (replaced by automatic group summation)
-- 4. Drops old columns (type, directPosting, accountCategoryId, accountSubcategoryId)
-- 5. Drops accountCategory and accountSubcategory tables
-- 6. Creates new accountType enum for business logic
-- 7. Updates the accounts view and RPC functions

-- ============================================================
-- Step 1: Create new accountType enum for business logic
-- ============================================================

CREATE TYPE "accountType" AS ENUM (
  'Bank',
  'Cash',
  'Accounts Receivable',
  'Accounts Payable',
  'Inventory',
  'Fixed Asset',
  'Accumulated Depreciation',
  'Other Current Asset',
  'Other Asset',
  'Other Current Liability',
  'Long Term Liability',
  'Equity - No Close',
  'Equity - Close',
  'Retained Earnings',
  'Income',
  'Cost of Goods Sold',
  'Expense',
  'Other Income',
  'Other Expense',
  'Tax',
  'Investments'
);

-- ============================================================
-- Step 2: Add new columns to account
-- ============================================================

ALTER TABLE "account" ADD COLUMN "parentId" TEXT;
ALTER TABLE "account" ADD COLUMN "isGroup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "account" ADD COLUMN "accountType" "accountType";

-- ============================================================
-- Step 3: Migrate data - infer parentId from Begin Total / End Total ordering
-- ============================================================

DO $$
DECLARE
  r RECORD;
  stack TEXT[] := '{}';
  prev_company_group TEXT := '';
  current_parent TEXT;
  category_name TEXT;
  mapped_type TEXT;
BEGIN
  FOR r IN (
    SELECT a."id", a."number", a."type", a."companyGroupId", a."accountCategoryId",
           (SELECT ac."category" FROM "accountCategory" ac WHERE ac."id" = a."accountCategoryId") as "categoryName"
    FROM "account" a
    ORDER BY a."companyGroupId", a."number" ASC
  ) LOOP
    -- Reset stack on company group boundary
    IF r."companyGroupId" != prev_company_group THEN
      stack := '{}';
      prev_company_group := r."companyGroupId";
    END IF;

    -- Map old category name to new accountType
    category_name := r."categoryName";
    mapped_type := NULL;
    IF category_name IS NOT NULL THEN
      -- Direct mapping from old category names to new enum values
      IF category_name IN ('Bank', 'Cash', 'Accounts Receivable', 'Accounts Payable',
                           'Inventory', 'Fixed Asset', 'Accumulated Depreciation',
                           'Other Current Asset', 'Other Asset', 'Other Current Liability',
                           'Long Term Liability', 'Equity - No Close', 'Equity - Close',
                           'Retained Earnings', 'Income', 'Cost of Goods Sold',
                           'Expense', 'Other Income', 'Other Expense', 'Tax', 'Investments') THEN
        mapped_type := category_name;
      END IF;
    END IF;

    IF r."type" = 'Begin Total' THEN
      -- Begin Total becomes a group; parent is top of stack
      IF array_length(stack, 1) IS NOT NULL AND array_length(stack, 1) > 0 THEN
        current_parent := stack[array_length(stack, 1)];
      ELSE
        current_parent := NULL;
      END IF;

      UPDATE "account" SET
        "parentId" = current_parent,
        "isGroup" = true,
        "accountType" = mapped_type::"accountType"
      WHERE "id" = r."id";

      stack := array_append(stack, r."id");

    ELSIF r."type" = 'Posting' THEN
      -- Posting accounts become ledger nodes; parent is top of stack
      IF array_length(stack, 1) IS NOT NULL AND array_length(stack, 1) > 0 THEN
        current_parent := stack[array_length(stack, 1)];
      ELSE
        current_parent := NULL;
      END IF;

      UPDATE "account" SET
        "parentId" = current_parent,
        "isGroup" = false,
        "accountType" = mapped_type::"accountType"
      WHERE "id" = r."id";

    ELSIF r."type" = 'End Total' THEN
      -- End Total accounts are no longer needed - pop stack and delete
      IF array_length(stack, 1) IS NOT NULL AND array_length(stack, 1) > 0 THEN
        stack := stack[1:array_length(stack, 1) - 1];
      END IF;
      -- Will be deleted below

    ELSIF r."type" = 'Total' THEN
      -- Total accounts close their top-level Begin Total - pop the stack
      IF array_length(stack, 1) IS NOT NULL AND array_length(stack, 1) > 0 THEN
        stack := stack[1:array_length(stack, 1) - 1];
      END IF;
    END IF;
  END LOOP;
END $$;

-- Delete End Total and Total accounts (they have no journal entries since directPosting was false)
DELETE FROM "account" WHERE "type" IN ('End Total', 'Total');

-- Drop account numbers for group accounts (groups are identified by name, not number)
ALTER TABLE "account" ALTER COLUMN "number" DROP NOT NULL;
UPDATE "account" SET "number" = NULL WHERE "isGroup" = true;

-- ============================================================
-- Step 4: Add self-referential FK constraint
-- ============================================================

ALTER TABLE "account" ADD CONSTRAINT "account_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "account_parentId_idx" ON "account"("parentId");
CREATE INDEX "account_isGroup_idx" ON "account"("isGroup", "companyGroupId");
CREATE INDEX "account_accountType_idx" ON "account"("accountType", "companyGroupId");

-- ============================================================
-- Step 5: Drop old columns and foreign key constraints
-- ============================================================

-- Drop the accounts view first (it depends on columns we're about to drop)
DROP VIEW IF EXISTS "accounts";

-- Drop FK constraints that reference accountCategory
ALTER TABLE "account" DROP CONSTRAINT IF EXISTS "account_accountCategoryId_fkey";

-- Drop indexes that reference old columns
DROP INDEX IF EXISTS "account_type_idx";
DROP INDEX IF EXISTS "account_accountCategoryId_idx";

-- Drop old columns
ALTER TABLE "account" DROP COLUMN "type";
ALTER TABLE "account" DROP COLUMN "directPosting";
ALTER TABLE "account" DROP COLUMN "accountCategoryId";
ALTER TABLE "account" DROP COLUMN "accountSubcategoryId";

-- ============================================================
-- Step 6: Drop accountCategory and accountSubcategory tables
-- ============================================================

-- Drop the view first (depends on accountCategory)
DROP VIEW IF EXISTS "accountCategories";

-- Drop accountSubcategory first (has FK to accountCategory)
DROP TABLE IF EXISTS "accountSubcategory" CASCADE;
DROP TABLE IF EXISTS "accountCategory" CASCADE;

-- Drop old enums
DROP TYPE IF EXISTS "glAccountType";
DROP TYPE IF EXISTS "glAccountCategory";

-- ============================================================
-- Step 7: Update accounts view
-- ============================================================

CREATE OR REPLACE VIEW "accounts" AS
SELECT "account".*
FROM "account";

-- ============================================================
-- Step 8: Update journalLinesByAccountNumber RPC
-- ============================================================

DROP FUNCTION IF EXISTS "journalLinesByAccountNumber"(DATE, DATE);

CREATE OR REPLACE FUNCTION "journalLinesByAccountNumber" (
  from_date DATE DEFAULT (now() - INTERVAL '100 year'),
  to_date DATE DEFAULT now()
)
RETURNS TABLE (
  "number" TEXT,
  "companyGroupId" TEXT,
  "balance" NUMERIC(19, 4),
  "balanceAtDate" NUMERIC(19, 4),
  "netChange" NUMERIC(19, 4)
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
  BEGIN
    RETURN QUERY
      SELECT
        a."number",
        a."companyGroupId",
        COALESCE(SUM(jl."amount"), 0) AS "balance",
        COALESCE(SUM(CASE WHEN j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        COALESCE(SUM(CASE WHEN j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "netChange"
      FROM "account" a
      LEFT JOIN "journalLine" jl ON jl."accountId" = a."id"
      LEFT JOIN "journal" j ON j."id" = jl."journalId"
      WHERE a."isGroup" = false
      GROUP BY a."number", a."companyGroupId";
  END;
$$;

-- ============================================================
-- Step 9: Create recursive balance RPC for tree
-- ============================================================

CREATE OR REPLACE FUNCTION "accountTreeBalances" (
  p_company_group_id TEXT,
  from_date DATE DEFAULT (now() - INTERVAL '100 year'),
  to_date DATE DEFAULT now()
)
RETURNS TABLE (
  "accountId" TEXT,
  "balance" NUMERIC(19, 4),
  "balanceAtDate" NUMERIC(19, 4),
  "netChange" NUMERIC(19, 4)
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    WITH RECURSIVE "accountTree" AS (
      -- Base case: all accounts in the company group
      SELECT
        a."id",
        a."id" AS "rootId",
        a."isGroup"
      FROM "account" a
      WHERE a."companyGroupId" = p_company_group_id AND a."active" = true

      UNION ALL

      -- Recursive case: for group accounts, include all descendants
      SELECT
        child."id",
        t."rootId",
        child."isGroup"
      FROM "accountTree" t
      INNER JOIN "account" child ON child."parentId" = t."id"
      WHERE t."isGroup" = true
        AND child."companyGroupId" = p_company_group_id
        AND child."active" = true
    ),
    "leafBalances" AS (
      SELECT
        a."id" AS "accountId",
        COALESCE(SUM(jl."amount"), 0) AS "balance",
        COALESCE(SUM(CASE WHEN j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        COALESCE(SUM(CASE WHEN j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "netChange"
      FROM "account" a
      LEFT JOIN "journalLine" jl ON jl."accountId" = a."id"
      LEFT JOIN "journal" j ON j."id" = jl."journalId"
      WHERE a."companyGroupId" = p_company_group_id
        AND a."isGroup" = false
        AND a."active" = true
      GROUP BY a."id"
    )
    -- For each account, sum up all descendant leaf balances
    SELECT
      t."rootId" AS "accountId",
      COALESCE(SUM(lb."balance"), 0)::NUMERIC(19, 4) AS "balance",
      COALESCE(SUM(lb."balanceAtDate"), 0)::NUMERIC(19, 4) AS "balanceAtDate",
      COALESCE(SUM(lb."netChange"), 0)::NUMERIC(19, 4) AS "netChange"
    FROM "accountTree" t
    LEFT JOIN "leafBalances" lb ON lb."accountId" = t."id" AND t."isGroup" = false
    GROUP BY t."rootId";
END;
$$;
