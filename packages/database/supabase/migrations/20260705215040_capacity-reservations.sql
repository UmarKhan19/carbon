CREATE TYPE "capacityResourceKind" AS ENUM ('WorkCenter', 'OperatorPool');
CREATE TYPE "schedulingDispatchRule" AS ENUM ('FIFO', 'EDD', 'SPT', 'WSPT', 'CR', 'MinSlack');

-- Durable slot allocations written by the scheduler (authoritative across jobs/runs)
CREATE TABLE "capacityReservation" (
    "id" TEXT NOT NULL DEFAULT id('cres'),
    "companyId" TEXT NOT NULL,
    "resourceKind" "capacityResourceKind" NOT NULL,
    "resourceId" TEXT NOT NULL, -- workCenter.id or ability.id (OperatorPool)
    "operationId" TEXT NOT NULL REFERENCES "jobOperation"("id") ON DELETE CASCADE,
    "jobId" TEXT NOT NULL REFERENCES "job"("id") ON DELETE CASCADE,
    "startAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "endAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "scenarioId" TEXT, -- null = live plan; scenario engine is a later phase
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CHECK ("endAt" > "startAt")
);
CREATE INDEX "capacityReservation_companyId_idx" ON "capacityReservation" ("companyId");
CREATE INDEX "capacityReservation_resource_window_idx" ON "capacityReservation" ("resourceId", "startAt", "endAt");
CREATE INDEX "capacityReservation_operationId_idx" ON "capacityReservation" ("operationId");
CREATE INDEX "capacityReservation_jobId_idx" ON "capacityReservation" ("jobId");
CREATE INDEX "capacityReservation_createdBy_idx" ON "capacityReservation" ("createdBy");

-- Dispatch-rule policy: one company default row (workCenterId null) + per-WC overrides
CREATE TABLE "schedulingPolicy" (
    "id" TEXT NOT NULL DEFAULT id('spol'),
    "companyId" TEXT NOT NULL,
    "workCenterId" TEXT REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "dispatchRule" "schedulingDispatchRule" NOT NULL DEFAULT 'EDD',
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "schedulingPolicy_company_wc_key"
    ON "schedulingPolicy" ("companyId", COALESCE("workCenterId", ''));
CREATE INDEX "schedulingPolicy_companyId_idx" ON "schedulingPolicy" ("companyId");
CREATE INDEX "schedulingPolicy_workCenterId_idx" ON "schedulingPolicy" ("workCenterId");
CREATE INDEX "schedulingPolicy_createdBy_idx" ON "schedulingPolicy" ("createdBy");

-- RLS: production scope
ALTER TABLE "public"."capacityReservation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."capacityReservation" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."capacityReservation" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."capacityReservation" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."capacityReservation" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);

ALTER TABLE "public"."schedulingPolicy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."schedulingPolicy" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."schedulingPolicy" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."schedulingPolicy" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."schedulingPolicy" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);
