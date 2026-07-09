-- Template default at the process level (coarse)
CREATE TABLE "processAbility" (
    "id" TEXT NOT NULL DEFAULT id('pab'),
    "companyId" TEXT NOT NULL,
    "processId" TEXT NOT NULL REFERENCES "process"("id") ON DELETE CASCADE,
    "abilityId" TEXT NOT NULL REFERENCES "ability"("id") ON DELETE CASCADE,
    "minimumProficiency" NUMERIC,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "processAbility_process_ability_key" ON "processAbility" ("processId", "abilityId", "companyId");
CREATE INDEX "processAbility_companyId_idx" ON "processAbility" ("companyId");
CREATE INDEX "processAbility_processId_idx" ON "processAbility" ("processId");
CREATE INDEX "processAbility_abilityId_idx" ON "processAbility" ("abilityId");
CREATE INDEX "processAbility_createdBy_idx" ON "processAbility" ("createdBy");

-- Routing-template level (copied to jobs at explosion)
CREATE TABLE "methodOperationAbility" (
    "id" TEXT NOT NULL DEFAULT id('moa'),
    "companyId" TEXT NOT NULL,
    "methodOperationId" TEXT NOT NULL REFERENCES "methodOperation"("id") ON DELETE CASCADE,
    "abilityId" TEXT NOT NULL REFERENCES "ability"("id") ON DELETE CASCADE,
    "minimumProficiency" NUMERIC,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "methodOperationAbility_op_ability_key" ON "methodOperationAbility" ("methodOperationId", "abilityId", "companyId");
CREATE INDEX "methodOperationAbility_companyId_idx" ON "methodOperationAbility" ("companyId");
CREATE INDEX "methodOperationAbility_methodOperationId_idx" ON "methodOperationAbility" ("methodOperationId");
CREATE INDEX "methodOperationAbility_abilityId_idx" ON "methodOperationAbility" ("abilityId");
CREATE INDEX "methodOperationAbility_createdBy_idx" ON "methodOperationAbility" ("createdBy");

-- Concrete requirement on a job operation (what the scheduler + MES enforce)
CREATE TABLE "jobOperationAbility" (
    "id" TEXT NOT NULL DEFAULT id('joa'),
    "companyId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL REFERENCES "jobOperation"("id") ON DELETE CASCADE,
    "abilityId" TEXT NOT NULL REFERENCES "ability"("id") ON DELETE CASCADE,
    "minimumProficiency" NUMERIC,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "jobOperationAbility_op_ability_key" ON "jobOperationAbility" ("operationId", "abilityId", "companyId");
CREATE INDEX "jobOperationAbility_companyId_idx" ON "jobOperationAbility" ("companyId");
CREATE INDEX "jobOperationAbility_operationId_idx" ON "jobOperationAbility" ("operationId");
CREATE INDEX "jobOperationAbility_abilityId_idx" ON "jobOperationAbility" ("abilityId");
CREATE INDEX "jobOperationAbility_createdBy_idx" ON "jobOperationAbility" ("createdBy");

-- Eligibility columns
ALTER TABLE "employeeAbility"
    ADD COLUMN "expiresAt" DATE,
    ADD COLUMN "proficiencyOverride" NUMERIC;
ALTER TABLE "ability" ADD COLUMN "recertifyEveryDays" INTEGER;

-- RLS
ALTER TABLE "public"."processAbility" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."processAbility" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."processAbility" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."processAbility" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."processAbility" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_delete'))::text[])
);

ALTER TABLE "public"."methodOperationAbility" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."methodOperationAbility" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."methodOperationAbility" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."methodOperationAbility" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."methodOperationAbility" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

ALTER TABLE "public"."jobOperationAbility" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."jobOperationAbility" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."jobOperationAbility" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."jobOperationAbility" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."jobOperationAbility" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);
