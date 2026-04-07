-- Price List Management

CREATE TYPE "priceListStatus" AS ENUM ('Draft', 'Active', 'Expired', 'Archived');
CREATE TYPE "priceListType" AS ENUM ('Sales', 'Purchase');
CREATE TYPE "priceListPriceType" AS ENUM ('Gross', 'Net', 'Discounted');
CREATE TYPE "priceListRuleType" AS ENUM ('Discount', 'Surcharge');
CREATE TYPE "priceListRuleAmountType" AS ENUM ('Percentage', 'Fixed');

-- priceList

CREATE TABLE "priceList" (
  "id" TEXT NOT NULL DEFAULT id('pl'),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "notes" JSONB,
  "type" "priceListType" NOT NULL DEFAULT 'Sales',
  "status" "priceListStatus" NOT NULL DEFAULT 'Draft',
  "priceType" "priceListPriceType" NOT NULL DEFAULT 'Net',
  "currencyCode" TEXT NOT NULL DEFAULT 'USD',
  "validFrom" DATE,
  "validTo" DATE,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "priceList_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "priceList_name_version_companyId_key" UNIQUE ("name", "version", "companyId"),
  CONSTRAINT "priceList_currencyCode_companyId_fkey"
    FOREIGN KEY ("currencyCode", "companyId") REFERENCES "currency"("code", "companyId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "priceList_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceList_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "priceList_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "priceList_companyId_idx" ON "priceList" ("companyId");
CREATE INDEX "priceList_type_status_idx" ON "priceList" ("type", "status");

ALTER TABLE "priceList" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."priceList"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."priceList"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_create'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_create'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "public"."priceList"
FOR UPDATE USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_update'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_update'))
    ))
  )
);

CREATE POLICY "DELETE" ON "public"."priceList"
FOR DELETE USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_delete'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_delete'))
    ))
  )
);

-- priceListItem

CREATE TABLE "priceListItem" (
  "id" TEXT NOT NULL DEFAULT id('pli'),
  "priceListId" TEXT NOT NULL,
  "itemId" TEXT,
  "itemPostingGroupId" TEXT,
  "unitPrice" NUMERIC(15, 5) NOT NULL,
  "unitOfMeasureCode" TEXT,
  "pricingMethod" TEXT NOT NULL DEFAULT 'Fixed',
  "formulaBase" TEXT,
  "markupPercent" NUMERIC(10, 5),
  "minMarginPercent" NUMERIC(10, 5),
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "priceListItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "priceListItem_priceListId_fkey"
    FOREIGN KEY ("priceListId") REFERENCES "priceList"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListItem_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListItem_itemPostingGroupId_fkey"
    FOREIGN KEY ("itemPostingGroupId") REFERENCES "itemPostingGroup"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListItem_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListItem_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "priceListItem_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "priceListItem_target_check" CHECK (
    ("itemId" IS NOT NULL AND "itemPostingGroupId" IS NULL)
    OR ("itemId" IS NULL AND "itemPostingGroupId" IS NOT NULL)
  )
);

CREATE INDEX "priceListItem_priceListId_idx" ON "priceListItem" ("priceListId");
CREATE INDEX "priceListItem_itemId_idx" ON "priceListItem" ("itemId");
CREATE INDEX "priceListItem_itemPostingGroupId_idx" ON "priceListItem" ("itemPostingGroupId");
CREATE INDEX "priceListItem_companyId_idx" ON "priceListItem" ("companyId");

ALTER TABLE "priceListItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."priceListItem"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."priceListItem"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_create'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_create'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "public"."priceListItem"
FOR UPDATE USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_update'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_update'))
    ))
  )
);

CREATE POLICY "DELETE" ON "public"."priceListItem"
FOR DELETE USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_delete'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_delete'))
    ))
  )
);

-- priceListItemBreak

CREATE TABLE "priceListItemBreak" (
  "priceListItemId" TEXT NOT NULL,
  "minQuantity" NUMERIC(20, 2) NOT NULL DEFAULT 1,
  "unitPrice" NUMERIC(15, 5) NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "priceListItemBreak_pkey" PRIMARY KEY ("priceListItemId", "minQuantity"),
  CONSTRAINT "priceListItemBreak_priceListItemId_fkey"
    FOREIGN KEY ("priceListItemId") REFERENCES "priceListItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListItemBreak_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListItemBreak_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "priceListItemBreak_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "priceListItemBreak_companyId_idx" ON "priceListItemBreak" ("companyId");

ALTER TABLE "priceListItemBreak" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."priceListItemBreak"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."priceListItemBreak"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_create'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_create'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "public"."priceListItemBreak"
FOR UPDATE USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_update'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_update'))
    ))
  )
);

CREATE POLICY "DELETE" ON "public"."priceListItemBreak"
FOR DELETE USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_delete'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_delete'))
    ))
  )
);

-- priceListRule

CREATE TABLE "priceListRule" (
  "id" TEXT NOT NULL DEFAULT id('plr'),
  "priceListId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ruleType" "priceListRuleType" NOT NULL,
  "amountType" "priceListRuleAmountType" NOT NULL DEFAULT 'Percentage',
  "amount" NUMERIC(15, 5) NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "minQuantity" NUMERIC(20, 2),
  "maxQuantity" NUMERIC(20, 2),
  "customerTypeId" TEXT,
  "supplierTypeId" TEXT,
  "itemId" TEXT,
  "itemPostingGroupId" TEXT,
  "validFrom" DATE,
  "validTo" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "priceListRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "priceListRule_priceListId_fkey"
    FOREIGN KEY ("priceListId") REFERENCES "priceList"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListRule_customerTypeId_fkey"
    FOREIGN KEY ("customerTypeId") REFERENCES "customerType"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListRule_supplierTypeId_fkey"
    FOREIGN KEY ("supplierTypeId") REFERENCES "supplierType"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListRule_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListRule_itemPostingGroupId_fkey"
    FOREIGN KEY ("itemPostingGroupId") REFERENCES "itemPostingGroup"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListRule_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListRule_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "priceListRule_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "priceListRule_priceListId_idx" ON "priceListRule" ("priceListId");
CREATE INDEX "priceListRule_companyId_idx" ON "priceListRule" ("companyId");
CREATE INDEX "priceListRule_customerTypeId_idx" ON "priceListRule" ("customerTypeId");
CREATE INDEX "priceListRule_supplierTypeId_idx" ON "priceListRule" ("supplierTypeId");
CREATE INDEX "priceListRule_itemId_idx" ON "priceListRule" ("itemId");
CREATE INDEX "priceListRule_itemPostingGroupId_idx" ON "priceListRule" ("itemPostingGroupId");
CREATE INDEX "priceListRule_active_idx" ON "priceListRule" ("active");

ALTER TABLE "priceListRule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."priceListRule"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."priceListRule"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_create'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_create'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "public"."priceListRule"
FOR UPDATE USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_update'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_update'))
    ))
  )
);

CREATE POLICY "DELETE" ON "public"."priceListRule"
FOR DELETE USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_delete'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_delete'))
    ))
  )
);

-- priceListAssignment

CREATE TABLE "priceListAssignment" (
  "id" TEXT NOT NULL DEFAULT id('pla'),
  "priceListId" TEXT NOT NULL,
  "customerId" TEXT,
  "customerTypeId" TEXT,
  "supplierId" TEXT,
  "supplierTypeId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "priceListAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "priceListAssignment_priceListId_fkey"
    FOREIGN KEY ("priceListId") REFERENCES "priceList"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListAssignment_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customer"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListAssignment_customerTypeId_fkey"
    FOREIGN KEY ("customerTypeId") REFERENCES "customerType"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListAssignment_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "supplier"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListAssignment_supplierTypeId_fkey"
    FOREIGN KEY ("supplierTypeId") REFERENCES "supplierType"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListAssignment_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "priceListAssignment_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "priceListAssignment_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "priceListAssignment_target_check" CHECK (
    (
      ("customerId" IS NOT NULL)::integer +
      ("customerTypeId" IS NOT NULL)::integer +
      ("supplierId" IS NOT NULL)::integer +
      ("supplierTypeId" IS NOT NULL)::integer
    ) = 1
  )
);

CREATE INDEX "priceListAssignment_priceListId_idx" ON "priceListAssignment" ("priceListId");
CREATE INDEX "priceListAssignment_customerId_idx" ON "priceListAssignment" ("customerId");
CREATE INDEX "priceListAssignment_customerTypeId_idx" ON "priceListAssignment" ("customerTypeId");
CREATE INDEX "priceListAssignment_supplierId_idx" ON "priceListAssignment" ("supplierId");
CREATE INDEX "priceListAssignment_supplierTypeId_idx" ON "priceListAssignment" ("supplierTypeId");
CREATE INDEX "priceListAssignment_companyId_idx" ON "priceListAssignment" ("companyId");

ALTER TABLE "priceListAssignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."priceListAssignment"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."priceListAssignment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_create'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_create'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "public"."priceListAssignment"
FOR UPDATE USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_update'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_update'))
    ))
  )
);

CREATE POLICY "DELETE" ON "public"."priceListAssignment"
FOR DELETE USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_delete'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_delete'))
    ))
  )
);

-- Add priceListId to order lines and customer/supplier

ALTER TABLE "salesOrderLine" ADD COLUMN "priceListId" TEXT;
ALTER TABLE "salesOrderLine" ADD CONSTRAINT "salesOrderLine_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "priceList"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "priceListId" TEXT;
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "priceList"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer" ADD COLUMN "priceListId" TEXT;
ALTER TABLE "customer" ADD CONSTRAINT "customer_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "priceList"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier" ADD COLUMN "priceListId" TEXT;
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "priceList"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Audit trace for price resolution at order line save time.
-- Stores the resolver's trace array (Base Price → Discount → Surcharge → Final)
-- so historical pricing decisions remain auditable even after price lists change.
ALTER TABLE "salesOrderLine" ADD COLUMN "priceTrace" JSONB;
ALTER TABLE "purchaseOrderLine" ADD COLUMN "priceTrace" JSONB;

COMMENT ON COLUMN "salesOrderLine"."priceTrace" IS
  'Snapshot of price resolution trace at order line save time';
COMMENT ON COLUMN "purchaseOrderLine"."priceTrace" IS
  'Snapshot of price resolution trace at order line save time';
