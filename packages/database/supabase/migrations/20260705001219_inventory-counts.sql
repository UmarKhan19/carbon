CREATE TYPE "inventoryCountStatus" AS ENUM (
  'Draft',
  'In Progress',
  'Posted',
  'Cancelled'
);

CREATE TABLE "inventoryCount" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "countDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  "status" "inventoryCountStatus" NOT NULL DEFAULT 'Draft',
  "locationId" TEXT,
  "notes" TEXT,
  "companyId" TEXT NOT NULL,
  "assignee" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user" ("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user" ("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "inventoryCount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventoryCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "inventoryCount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventoryCount_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "inventoryCount_companyId_idx" ON "inventoryCount" ("companyId");
CREATE INDEX "inventoryCount_status_idx" ON "inventoryCount" ("status", "companyId");
CREATE INDEX "inventoryCount_locationId_idx" ON "inventoryCount" ("locationId", "companyId");
CREATE INDEX "inventoryCount_createdBy_idx" ON "inventoryCount" ("createdBy");

ALTER TABLE "public"."inventoryCount" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."inventoryCount"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."inventoryCount"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."inventoryCount"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."inventoryCount"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_delete'))::text[])
);

ALTER publication supabase_realtime ADD TABLE "inventoryCount";

CREATE TABLE "inventoryCountLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "inventoryCountId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "locationId" TEXT,
  "shelfId" TEXT,
  "expectedQty" NUMERIC NOT NULL DEFAULT 0,
  "countedQty" NUMERIC,
  "variance" NUMERIC GENERATED ALWAYS AS ("countedQty" - "expectedQty") STORED,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user" ("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user" ("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "inventoryCountLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventoryCountLine_countId_fkey" FOREIGN KEY ("inventoryCountId") REFERENCES "inventoryCount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventoryCountLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventoryCountLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "inventoryCountLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "inventoryCountLine_companyId_idx" ON "inventoryCountLine" ("companyId");
CREATE INDEX "inventoryCountLine_inventoryCountId_idx" ON "inventoryCountLine" ("inventoryCountId");
CREATE INDEX "inventoryCountLine_itemId_idx" ON "inventoryCountLine" ("itemId", "companyId");
CREATE INDEX "inventoryCountLine_createdBy_idx" ON "inventoryCountLine" ("createdBy");

ALTER TABLE "public"."inventoryCountLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."inventoryCountLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."inventoryCountLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."inventoryCountLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."inventoryCountLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_delete'))::text[])
);

ALTER publication supabase_realtime ADD TABLE "inventoryCountLine";
