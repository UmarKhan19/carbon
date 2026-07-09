-- Enums
CREATE TYPE "workCenterSchedulingMode" AS ENUM ('Finite', 'Infinite');
CREATE TYPE "resourceCalendarExceptionType" AS ENUM ('Closed', 'Open', 'ReducedCapacity');

-- Named working-time calendar, assignable to work centers
CREATE TABLE "resourceCalendar" (
    "id" TEXT NOT NULL DEFAULT id('rcal'),
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT REFERENCES "location"("id") ON DELETE SET NULL,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "resourceCalendar_companyId_idx" ON "resourceCalendar" ("companyId");
CREATE INDEX "resourceCalendar_locationId_idx" ON "resourceCalendar" ("locationId");
CREATE INDEX "resourceCalendar_createdBy_idx" ON "resourceCalendar" ("createdBy");
ALTER TABLE "resourceCalendar" ADD CONSTRAINT "resourceCalendar_companyId_name_key"
    UNIQUE ("companyId", "name");

-- Recurring weekly pattern; multiple rows per day = split shifts
CREATE TABLE "resourceCalendarShift" (
    "id" TEXT NOT NULL DEFAULT id('rcsh'),
    "companyId" TEXT NOT NULL,
    "resourceCalendarId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL CHECK ("dayOfWeek" BETWEEN 0 AND 6), -- 0 = Sunday
    "startTime" TIME NOT NULL,
    "endTime" TIME NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("resourceCalendarId", "companyId")
        REFERENCES "resourceCalendar"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX "resourceCalendarShift_companyId_idx" ON "resourceCalendarShift" ("companyId");
CREATE INDEX "resourceCalendarShift_resourceCalendarId_idx" ON "resourceCalendarShift" ("resourceCalendarId");
CREATE INDEX "resourceCalendarShift_createdBy_idx" ON "resourceCalendarShift" ("createdBy");

-- One-off exceptions: holidays, maintenance windows, overtime
CREATE TABLE "resourceCalendarException" (
    "id" TEXT NOT NULL DEFAULT id('rcex'),
    "companyId" TEXT NOT NULL,
    "resourceCalendarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "endAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "type" "resourceCalendarExceptionType" NOT NULL DEFAULT 'Closed',
    "capacityOverride" NUMERIC, -- only meaningful for 'ReducedCapacity'
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("resourceCalendarId", "companyId")
        REFERENCES "resourceCalendar"("id", "companyId") ON DELETE CASCADE,
    CHECK ("endAt" > "startAt")
);
CREATE INDEX "resourceCalendarException_companyId_idx" ON "resourceCalendarException" ("companyId");
CREATE INDEX "resourceCalendarException_resourceCalendarId_idx" ON "resourceCalendarException" ("resourceCalendarId");
CREATE INDEX "resourceCalendarException_createdBy_idx" ON "resourceCalendarException" ("createdBy");

-- Work center capacity fields
ALTER TABLE "workCenter"
    ADD COLUMN "parallelCapacity" INTEGER NOT NULL DEFAULT 1 CHECK ("parallelCapacity" >= 1),
    ADD COLUMN "resourceCalendarId" TEXT,
    ADD COLUMN "efficiencyFactor" NUMERIC NOT NULL DEFAULT 1.0 CHECK ("efficiencyFactor" > 0),
    ADD COLUMN "schedulingMode" "workCenterSchedulingMode" NOT NULL DEFAULT 'Finite';
ALTER TABLE "workCenter" ADD CONSTRAINT "workCenter_resourceCalendarId_fkey"
    FOREIGN KEY ("resourceCalendarId", "companyId")
    REFERENCES "resourceCalendar"("id", "companyId") ON DELETE SET NULL;
CREATE INDEX "workCenter_resourceCalendarId_idx" ON "workCenter" ("resourceCalendarId");

-- Time-phased capacity overrides (resolution: row covering date -> workCenter.parallelCapacity)
CREATE TABLE "workCenterCapacity" (
    "id" TEXT NOT NULL DEFAULT id('wcc'),
    "companyId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE, -- null = open-ended
    "parallelCapacity" INTEGER NOT NULL CHECK ("parallelCapacity" >= 0),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);
CREATE INDEX "workCenterCapacity_companyId_idx" ON "workCenterCapacity" ("companyId");
CREATE INDEX "workCenterCapacity_workCenterId_idx" ON "workCenterCapacity" ("workCenterId");
CREATE INDEX "workCenterCapacity_createdBy_idx" ON "workCenterCapacity" ("createdBy");

-- RLS: resources scope
ALTER TABLE "public"."resourceCalendar" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."resourceCalendar" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."resourceCalendar" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."resourceCalendar" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."resourceCalendar" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_delete'))::text[])
);

ALTER TABLE "public"."resourceCalendarShift" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."resourceCalendarShift" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."resourceCalendarShift" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."resourceCalendarShift" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."resourceCalendarShift" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_delete'))::text[])
);

ALTER TABLE "public"."resourceCalendarException" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."resourceCalendarException" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."resourceCalendarException" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."resourceCalendarException" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."resourceCalendarException" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_delete'))::text[])
);

ALTER TABLE "public"."workCenterCapacity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."workCenterCapacity" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."workCenterCapacity" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."workCenterCapacity" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."workCenterCapacity" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_delete'))::text[])
);

-- Backfill: one calendar per active shift; weekday booleans -> shift rows
DO $$
DECLARE
  s RECORD;
  cal_id TEXT;
BEGIN
  FOR s IN SELECT * FROM "shift" WHERE "active" = TRUE LOOP
    cal_id := NULL;
    INSERT INTO "resourceCalendar" ("companyId", "name", "locationId", "createdBy")
    VALUES (s."companyId", s."name", s."locationId", 'system')
    ON CONFLICT ("companyId", "name") DO NOTHING
    RETURNING "id" INTO cal_id;
    IF cal_id IS NULL THEN CONTINUE; END IF;
    IF s."sunday"    THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 0, s."startTime", s."endTime", 'system'); END IF;
    IF s."monday"    THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 1, s."startTime", s."endTime", 'system'); END IF;
    IF s."tuesday"   THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 2, s."startTime", s."endTime", 'system'); END IF;
    IF s."wednesday" THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 3, s."startTime", s."endTime", 'system'); END IF;
    IF s."thursday"  THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 4, s."startTime", s."endTime", 'system'); END IF;
    IF s."friday"    THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 5, s."startTime", s."endTime", 'system'); END IF;
    IF s."saturday"  THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 6, s."startTime", s."endTime", 'system'); END IF;
  END LOOP;
END $$;

-- Backfill: future holidays -> Closed exceptions on every calendar in the company
INSERT INTO "resourceCalendarException"
  ("companyId", "resourceCalendarId", "name", "startAt", "endAt", "type", "createdBy")
SELECT h."companyId", rc."id", h."name",
       h."date"::timestamptz, (h."date" + 1)::timestamptz, 'Closed', 'system'
FROM "holiday" h
JOIN "resourceCalendar" rc ON rc."companyId" = h."companyId"
WHERE h."date" >= CURRENT_DATE;
