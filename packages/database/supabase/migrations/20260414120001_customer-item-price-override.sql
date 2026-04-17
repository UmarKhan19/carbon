CREATE TABLE "customerItemPriceOverride" (
  "id" TEXT NOT NULL DEFAULT id('cipo'),
  "customerId" TEXT,
  "customerTypeId" TEXT,
  "itemId" TEXT NOT NULL,
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
  CONSTRAINT "customerItemPriceOverride_id_companyId_uq" UNIQUE ("id", "companyId"),
  CONSTRAINT "customerItemPriceOverride_scope_check" CHECK (
    NOT ("customerId" IS NOT NULL AND "customerTypeId" IS NOT NULL)
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

CREATE UNIQUE INDEX "customerItemPriceOverride_customer_item_uq"
  ON "customerItemPriceOverride" ("customerId", "itemId", "companyId")
  WHERE "customerId" IS NOT NULL;
CREATE UNIQUE INDEX "customerItemPriceOverride_customerType_item_uq"
  ON "customerItemPriceOverride" ("customerTypeId", "itemId", "companyId")
  WHERE "customerTypeId" IS NOT NULL;
CREATE UNIQUE INDEX "customerItemPriceOverride_all_item_uq"
  ON "customerItemPriceOverride" ("itemId", "companyId")
  WHERE "customerId" IS NULL AND "customerTypeId" IS NULL;

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

-- Quantity-break child table. Each row is one rung on the ladder for a given
-- parent override. Surrogate id keeps audit rows stable across saves; composite
-- UNIQUE (parent, quantity) enforces the business rule that each parent has at
-- most one rung per quantity.
CREATE TABLE "customerItemPriceOverrideBreak" (
  "id" TEXT NOT NULL DEFAULT id('cipob'),
  "customerItemPriceOverrideId" TEXT NOT NULL,
  "quantity" NUMERIC(20, 2) NOT NULL CHECK ("quantity" >= 0),
  "overridePrice" NUMERIC(15, 5) NOT NULL CHECK ("overridePrice" >= 0),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "customerItemPriceOverrideBreak_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customerItemPriceOverrideBreak_override_qty_uq"
    UNIQUE ("customerItemPriceOverrideId", "quantity"),
  CONSTRAINT "customerItemPriceOverrideBreak_override_fkey"
    FOREIGN KEY ("customerItemPriceOverrideId", "companyId")
    REFERENCES "customerItemPriceOverride"("id", "companyId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerItemPriceOverrideBreak_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerItemPriceOverrideBreak_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customerItemPriceOverrideBreak_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "customerItemPriceOverrideBreak_override_idx"
  ON "customerItemPriceOverrideBreak" ("customerItemPriceOverrideId");
CREATE INDEX "customerItemPriceOverrideBreak_companyId_idx"
  ON "customerItemPriceOverrideBreak" ("companyId");

ALTER TABLE "customerItemPriceOverrideBreak" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."customerItemPriceOverrideBreak"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."customerItemPriceOverrideBreak"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customerItemPriceOverrideBreak"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."customerItemPriceOverrideBreak"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

SELECT attach_event_trigger(
  'customerItemPriceOverride',
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[]
);

SELECT attach_event_trigger(
  'customerItemPriceOverrideBreak',
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[]
);
