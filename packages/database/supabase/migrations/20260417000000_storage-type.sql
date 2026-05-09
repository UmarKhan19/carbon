CREATE TABLE "storageType" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "name" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "storageType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "storageType_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "storageType_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "storageType_companyId_idx" ON "storageType" ("companyId");

ALTER TABLE "storageType" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."storageType"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."storageType"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."storageType"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."storageType"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- Register the table with the custom-fields subsystem so admins can add
-- per-company fields (mirrors nonConformanceType/gaugeType seeds in
-- 20250502132738_gauge-calibration.sql).
INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('storageType', 'Storage Type', 'Inventory');
