-- Customer Item Price Overrides
-- Manual price overrides that take precedence over pricing rules.
-- Supports two scopes:
--   1. Customer-specific: customerId + itemId (highest priority)
--   2. Customer-type: customerTypeId + itemId (second priority)
-- Exactly one of customerId or customerTypeId must be set.

CREATE TABLE "customerItemPriceOverride" (
  "id" TEXT NOT NULL DEFAULT id('cipo'),
  "customerId" TEXT,
  "customerTypeId" TEXT,
  "itemId" TEXT NOT NULL,
  "overridePrice" NUMERIC(15, 5) NOT NULL,
  "notes" TEXT,
  "validFrom" DATE,
  "validTo" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "applyRulesOnTop" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "customerItemPriceOverride_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customerItemPriceOverride_scope_check" CHECK (
    ("customerId" IS NOT NULL AND "customerTypeId" IS NULL)
    OR ("customerId" IS NULL AND "customerTypeId" IS NOT NULL)
  ),
  CONSTRAINT "customerItemPriceOverride_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customer"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerItemPriceOverride_customerTypeId_fkey"
    FOREIGN KEY ("customerTypeId") REFERENCES "customerType"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerItemPriceOverride_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerItemPriceOverride_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerItemPriceOverride_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customerItemPriceOverride_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Partial unique indexes: one override per scope per item per company
CREATE UNIQUE INDEX "customerItemPriceOverride_customer_item_uq"
  ON "customerItemPriceOverride" ("customerId", "itemId", "companyId")
  WHERE "customerId" IS NOT NULL;
CREATE UNIQUE INDEX "customerItemPriceOverride_customerType_item_uq"
  ON "customerItemPriceOverride" ("customerTypeId", "itemId", "companyId")
  WHERE "customerTypeId" IS NOT NULL;

CREATE INDEX "customerItemPriceOverride_customerId_itemId_idx"
  ON "customerItemPriceOverride" ("customerId", "itemId");
CREATE INDEX "customerItemPriceOverride_customerTypeId_itemId_idx"
  ON "customerItemPriceOverride" ("customerTypeId", "itemId");
CREATE INDEX "customerItemPriceOverride_companyId_idx"
  ON "customerItemPriceOverride" ("companyId");
CREATE INDEX "customerItemPriceOverride_active_idx"
  ON "customerItemPriceOverride" ("active");

ALTER TABLE "customerItemPriceOverride" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."customerItemPriceOverride"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."customerItemPriceOverride"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customerItemPriceOverride"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."customerItemPriceOverride"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);
