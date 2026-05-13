-- Pricing Rules
-- Standalone pricing rules (discount or markup) scoped to items, item groups,
-- customer types, quantity ranges, and date ranges.

CREATE TYPE "pricingRuleType" AS ENUM ('Discount', 'Markup');
CREATE TYPE "pricingRuleAmountType" AS ENUM ('Percentage', 'Fixed');

CREATE TABLE "pricingRule" (
  "id" TEXT NOT NULL DEFAULT id('pr'),
  "name" TEXT NOT NULL,
  "ruleType" "pricingRuleType" NOT NULL,
  "amountType" "pricingRuleAmountType" NOT NULL DEFAULT 'Percentage',
  "amount" NUMERIC(15, 5) NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "minQuantity" NUMERIC(20, 2),
  "maxQuantity" NUMERIC(20, 2),
  "customerIds" TEXT[],
  "customerTypeIds" TEXT[],
  "itemIds" TEXT[],
  "itemPostingGroupId" TEXT,
  "validFrom" DATE,
  "validTo" DATE,
  "formulaBase" TEXT,
  "minMarginPercent" NUMERIC(10, 5),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "pricingRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricingRule_itemPostingGroupId_fkey"
    FOREIGN KEY ("itemPostingGroupId") REFERENCES "itemPostingGroup"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pricingRule_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pricingRule_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricingRule_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "pricingRule_companyId_idx" ON "pricingRule" ("companyId");
CREATE INDEX "pricingRule_customerIds_idx" ON "pricingRule" USING GIN ("customerIds");
CREATE INDEX "pricingRule_customerTypeIds_idx" ON "pricingRule" USING GIN ("customerTypeIds");
CREATE INDEX "pricingRule_itemIds_idx" ON "pricingRule" USING GIN ("itemIds");
CREATE INDEX "pricingRule_itemPostingGroupId_idx" ON "pricingRule" ("itemPostingGroupId");
CREATE INDEX "pricingRule_active_idx" ON "pricingRule" ("active");

ALTER TABLE "pricingRule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."pricingRule"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."pricingRule"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."pricingRule"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."pricingRule"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

-- Sales Order Line additions

ALTER TABLE "salesOrderLine" ADD COLUMN "pricingRuleId" TEXT;
ALTER TABLE "salesOrderLine" ADD CONSTRAINT "salesOrderLine_pricingRuleId_fkey"
  FOREIGN KEY ("pricingRuleId") REFERENCES "pricingRule"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "salesOrderLine" ADD COLUMN "priceTrace" JSONB;

-- Quote Line additions

ALTER TABLE "quoteLine" ADD COLUMN "pricingRuleId" TEXT;
ALTER TABLE "quoteLine" ADD CONSTRAINT "quoteLine_pricingRuleId_fkey"
  FOREIGN KEY ("pricingRuleId") REFERENCES "pricingRule"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quoteLine" ADD COLUMN "priceTrace" JSONB;
