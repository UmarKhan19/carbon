-- Employee Time Clock feature: shift clock-in/clock-out tracking

-- 1. Add timeCardEnabled toggle to companySettings
ALTER TABLE "companySettings" ADD COLUMN "timeCardEnabled" BOOLEAN NOT NULL DEFAULT false;

-- 2. Create timeCardEntry table
CREATE TABLE "timeCardEntry" (
  "id" TEXT NOT NULL DEFAULT id('tce'),
  "employeeId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "clockIn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "clockOut" TIMESTAMP WITH TIME ZONE,
  "note" TEXT,
  "autoCloseShiftId" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "timeCardEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "timeCardEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "timeCardEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "timeCardEntry_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "timeCardEntry_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "timeCardEntry_autoCloseShiftId_fkey" FOREIGN KEY ("autoCloseShiftId") REFERENCES "shift"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "timeCardEntry_clockOut_after_clockIn" CHECK ("clockOut" IS NULL OR "clockOut" >= "clockIn")
);

-- 3. Indexes
CREATE INDEX "timeCardEntry_employeeId_companyId_idx" ON "timeCardEntry" ("employeeId", "companyId");
CREATE INDEX "timeCardEntry_clockIn_idx" ON "timeCardEntry" ("clockIn");
CREATE INDEX "timeCardEntry_open_entries_idx" ON "timeCardEntry" ("companyId", "employeeId") WHERE "clockOut" IS NULL;

-- 4. RLS Policies
ALTER TABLE "timeCardEntry" ENABLE ROW LEVEL SECURITY;

-- SELECT: Employee can see own entries OR user has people_view permission
CREATE POLICY "SELECT" ON "timeCardEntry"
FOR SELECT USING (
  (
    "employeeId" = auth.uid()::text
    AND "companyId" = ANY (
      (SELECT get_companies_with_employee_role())::text[]
    )
  )
  OR
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('people_view'))::text[]
  )
);

-- INSERT: Employee can clock themselves in OR user has people_create permission
CREATE POLICY "INSERT" ON "timeCardEntry"
FOR INSERT WITH CHECK (
  (
    "employeeId" = auth.uid()::text
    AND "companyId" = ANY (
      (SELECT get_companies_with_employee_role())::text[]
    )
  )
  OR
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('people_create'))::text[]
  )
);

-- UPDATE: Employee can update own entries OR user has people_update permission
CREATE POLICY "UPDATE" ON "timeCardEntry"
FOR UPDATE USING (
  (
    "employeeId" = auth.uid()::text
    AND "companyId" = ANY (
      (SELECT get_companies_with_employee_role())::text[]
    )
  )
  OR
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('people_update'))::text[]
  )
);

-- DELETE: Only users with people_delete permission
CREATE POLICY "DELETE" ON "timeCardEntry"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('people_delete'))::text[]
  )
);

-- 5. Dashboard view
CREATE OR REPLACE VIEW "timeCardEntries" WITH (SECURITY_INVOKER=true) AS
SELECT
  tce."id",
  tce."employeeId",
  tce."companyId",
  tce."clockIn",
  tce."clockOut",
  tce."note",
  tce."autoCloseShiftId",
  tce."createdBy",
  tce."createdAt",
  tce."updatedBy",
  tce."updatedAt",
  u."firstName",
  u."lastName",
  u."avatarUrl",
  ej."title" AS "jobTitle",
  ej."shiftId",
  ej."locationId",
  s."name" AS "shiftName",
  l."name" AS "locationName",
  CASE WHEN tce."clockOut" IS NULL THEN 'Active' ELSE 'Complete' END AS "status"
FROM "timeCardEntry" tce
INNER JOIN "user" u ON tce."employeeId" = u."id"
LEFT JOIN "employeeJob" ej ON ej."id" = tce."employeeId" AND ej."companyId" = tce."companyId"
LEFT JOIN "shift" s ON ej."shiftId" = s."id"
LEFT JOIN "location" l ON ej."locationId" = l."id";
