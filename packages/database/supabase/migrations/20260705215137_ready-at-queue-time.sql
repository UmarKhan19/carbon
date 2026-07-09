ALTER TABLE "jobOperation" ADD COLUMN "readyAt" TIMESTAMP WITH TIME ZONE;

-- Stamp the instant an operation becomes Ready. Ready-transitions are written
-- from multiple functions (dependency triggers, finish interceptor, scheduler),
-- so a single BEFORE trigger is the one reliable point.
CREATE OR REPLACE FUNCTION set_job_operation_ready_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW."status" = 'Ready' AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'Ready') AND NEW."readyAt" IS NULL THEN
    NEW."readyAt" = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ready_at_on_job_operation ON "jobOperation";
CREATE TRIGGER set_ready_at_on_job_operation
BEFORE INSERT OR UPDATE OF "status" ON "jobOperation"
FOR EACH ROW EXECUTE FUNCTION set_job_operation_ready_at();

-- Queue time: Ready -> first production event
CREATE OR REPLACE VIEW "jobOperationQueueTime" WITH(SECURITY_INVOKER=true) AS
SELECT
  jo."id",
  jo."companyId",
  jo."jobId",
  jo."workCenterId",
  jo."readyAt",
  MIN(pe."startTime") AS "firstEventAt",
  EXTRACT(EPOCH FROM (MIN(pe."startTime") - jo."readyAt")) / 3600.0 AS "queueHours"
FROM "jobOperation" jo
LEFT JOIN "productionEvent" pe ON pe."jobOperationId" = jo."id"
WHERE jo."readyAt" IS NOT NULL
GROUP BY jo."id", jo."companyId", jo."jobId", jo."workCenterId", jo."readyAt";

-- Rollup target written by the Inngest capacity-rollup cron
CREATE TABLE "workCenterUtilization" (
    "id" TEXT NOT NULL DEFAULT id('wcu'),
    "companyId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "availableHours" NUMERIC NOT NULL DEFAULT 0,
    "reservedHours" NUMERIC NOT NULL DEFAULT 0,
    "actualHours" NUMERIC NOT NULL DEFAULT 0,
    "utilization" NUMERIC NOT NULL DEFAULT 0,        -- reserved / available (rho)
    "meanServiceHours" NUMERIC,
    "cvServiceTime" NUMERIC,                          -- coefficient of variation from productionEvent durations
    "avgQueueHours" NUMERIC,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "workCenterUtilization_wc_period_key"
    ON "workCenterUtilization" ("workCenterId", "periodStart", "companyId");
CREATE INDEX "workCenterUtilization_companyId_idx" ON "workCenterUtilization" ("companyId");
CREATE INDEX "workCenterUtilization_workCenterId_idx" ON "workCenterUtilization" ("workCenterId");
CREATE INDEX "workCenterUtilization_createdBy_idx" ON "workCenterUtilization" ("createdBy");

ALTER TABLE "public"."workCenterUtilization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."workCenterUtilization" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."workCenterUtilization" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."workCenterUtilization" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."workCenterUtilization" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);
