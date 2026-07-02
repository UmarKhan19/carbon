-- Many-to-many tool<->step and part<->step.
--
-- Replaces the single nullable FK *OperationStepId (added in
-- 20260628145000_operation-step-part-tool-link.sql) with six join tables so a tool/material
-- can be scoped to ANY SUBSET of an operation's steps — not just one step, and not only "all".
-- Semantics: NO join rows = operation-level (shown on every step, backward compatible);
-- 1+ rows = shown only on those steps.
--
-- Join tables carry no companyId (like pickingListLineTrackedEntity) — they reach the company
-- through the parent via EXISTS in RLS. Both FKs are ON DELETE CASCADE: deleting the tool/
-- material OR the step removes the link row (a link is meaningless without either side).
--
-- The old scalar columns are backfilled here and dropped in the paired migration
-- 20260702143500 (after get_method_tree stops referencing methodMaterial.methodOperationStepId).

-- Materials ---------------------------------------------------------------------------------
CREATE TABLE "methodMaterialStep" (
  "methodMaterialId" TEXT NOT NULL REFERENCES "methodMaterial"("id") ON DELETE CASCADE,
  "methodOperationStepId" TEXT NOT NULL REFERENCES "methodOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("methodMaterialId", "methodOperationStepId")
);
CREATE INDEX "methodMaterialStep_methodOperationStepId_idx" ON "methodMaterialStep" ("methodOperationStepId");

CREATE TABLE "jobMaterialStep" (
  "jobMaterialId" TEXT NOT NULL REFERENCES "jobMaterial"("id") ON DELETE CASCADE,
  "jobOperationStepId" TEXT NOT NULL REFERENCES "jobOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("jobMaterialId", "jobOperationStepId")
);
CREATE INDEX "jobMaterialStep_jobOperationStepId_idx" ON "jobMaterialStep" ("jobOperationStepId");

CREATE TABLE "quoteMaterialStep" (
  "quoteMaterialId" TEXT NOT NULL REFERENCES "quoteMaterial"("id") ON DELETE CASCADE,
  "quoteOperationStepId" TEXT NOT NULL REFERENCES "quoteOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("quoteMaterialId", "quoteOperationStepId")
);
CREATE INDEX "quoteMaterialStep_quoteOperationStepId_idx" ON "quoteMaterialStep" ("quoteOperationStepId");

-- Tools -------------------------------------------------------------------------------------
CREATE TABLE "methodOperationToolStep" (
  "methodOperationToolId" TEXT NOT NULL REFERENCES "methodOperationTool"("id") ON DELETE CASCADE,
  "methodOperationStepId" TEXT NOT NULL REFERENCES "methodOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("methodOperationToolId", "methodOperationStepId")
);
CREATE INDEX "methodOperationToolStep_methodOperationStepId_idx" ON "methodOperationToolStep" ("methodOperationStepId");

CREATE TABLE "jobOperationToolStep" (
  "jobOperationToolId" TEXT NOT NULL REFERENCES "jobOperationTool"("id") ON DELETE CASCADE,
  "jobOperationStepId" TEXT NOT NULL REFERENCES "jobOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("jobOperationToolId", "jobOperationStepId")
);
CREATE INDEX "jobOperationToolStep_jobOperationStepId_idx" ON "jobOperationToolStep" ("jobOperationStepId");

CREATE TABLE "quoteOperationToolStep" (
  "quoteOperationToolId" TEXT NOT NULL REFERENCES "quoteOperationTool"("id") ON DELETE CASCADE,
  "quoteOperationStepId" TEXT NOT NULL REFERENCES "quoteOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("quoteOperationToolId", "quoteOperationStepId")
);
CREATE INDEX "quoteOperationToolStep_quoteOperationStepId_idx" ON "quoteOperationToolStep" ("quoteOperationStepId");

-- RLS -- reach companyId through the parent (tool/material). SELECT: any employee of the
-- parent's company. Writes: the parent's module permission (job->production, method->parts,
-- quote->sales), matching the parent tables' own policies.

-- methodMaterialStep (parts)
ALTER TABLE "public"."methodMaterialStep" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."methodMaterialStep" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "methodMaterial" p WHERE p."id" = "methodMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
CREATE POLICY "INSERT" ON "public"."methodMaterialStep" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "methodMaterial" p WHERE p."id" = "methodMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])));
CREATE POLICY "UPDATE" ON "public"."methodMaterialStep" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "methodMaterial" p WHERE p."id" = "methodMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])));
CREATE POLICY "DELETE" ON "public"."methodMaterialStep" FOR DELETE USING (
  EXISTS (SELECT 1 FROM "methodMaterial" p WHERE p."id" = "methodMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])));

-- jobMaterialStep (production)
ALTER TABLE "public"."jobMaterialStep" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."jobMaterialStep" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "jobMaterial" p WHERE p."id" = "jobMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
CREATE POLICY "INSERT" ON "public"."jobMaterialStep" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "jobMaterial" p WHERE p."id" = "jobMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])));
CREATE POLICY "UPDATE" ON "public"."jobMaterialStep" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "jobMaterial" p WHERE p."id" = "jobMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])));
CREATE POLICY "DELETE" ON "public"."jobMaterialStep" FOR DELETE USING (
  EXISTS (SELECT 1 FROM "jobMaterial" p WHERE p."id" = "jobMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])));

-- quoteMaterialStep (sales)
ALTER TABLE "public"."quoteMaterialStep" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."quoteMaterialStep" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "quoteMaterial" p WHERE p."id" = "quoteMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
CREATE POLICY "INSERT" ON "public"."quoteMaterialStep" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "quoteMaterial" p WHERE p."id" = "quoteMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])));
CREATE POLICY "UPDATE" ON "public"."quoteMaterialStep" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "quoteMaterial" p WHERE p."id" = "quoteMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])));
CREATE POLICY "DELETE" ON "public"."quoteMaterialStep" FOR DELETE USING (
  EXISTS (SELECT 1 FROM "quoteMaterial" p WHERE p."id" = "quoteMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])));

-- methodOperationToolStep (parts)
ALTER TABLE "public"."methodOperationToolStep" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."methodOperationToolStep" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "methodOperationTool" p WHERE p."id" = "methodOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
CREATE POLICY "INSERT" ON "public"."methodOperationToolStep" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "methodOperationTool" p WHERE p."id" = "methodOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])));
CREATE POLICY "UPDATE" ON "public"."methodOperationToolStep" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "methodOperationTool" p WHERE p."id" = "methodOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])));
CREATE POLICY "DELETE" ON "public"."methodOperationToolStep" FOR DELETE USING (
  EXISTS (SELECT 1 FROM "methodOperationTool" p WHERE p."id" = "methodOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])));

-- jobOperationToolStep (production)
ALTER TABLE "public"."jobOperationToolStep" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."jobOperationToolStep" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "jobOperationTool" p WHERE p."id" = "jobOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
CREATE POLICY "INSERT" ON "public"."jobOperationToolStep" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "jobOperationTool" p WHERE p."id" = "jobOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])));
CREATE POLICY "UPDATE" ON "public"."jobOperationToolStep" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "jobOperationTool" p WHERE p."id" = "jobOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])));
CREATE POLICY "DELETE" ON "public"."jobOperationToolStep" FOR DELETE USING (
  EXISTS (SELECT 1 FROM "jobOperationTool" p WHERE p."id" = "jobOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])));

-- quoteOperationToolStep (sales)
ALTER TABLE "public"."quoteOperationToolStep" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."quoteOperationToolStep" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "quoteOperationTool" p WHERE p."id" = "quoteOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
CREATE POLICY "INSERT" ON "public"."quoteOperationToolStep" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "quoteOperationTool" p WHERE p."id" = "quoteOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])));
CREATE POLICY "UPDATE" ON "public"."quoteOperationToolStep" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "quoteOperationTool" p WHERE p."id" = "quoteOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])));
CREATE POLICY "DELETE" ON "public"."quoteOperationToolStep" FOR DELETE USING (
  EXISTS (SELECT 1 FROM "quoteOperationTool" p WHERE p."id" = "quoteOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])));

-- Backfill existing single-FK assignments into the join tables (no data loss).
INSERT INTO "methodMaterialStep" ("methodMaterialId", "methodOperationStepId")
  SELECT "id", "methodOperationStepId" FROM "methodMaterial" WHERE "methodOperationStepId" IS NOT NULL;
INSERT INTO "jobMaterialStep" ("jobMaterialId", "jobOperationStepId")
  SELECT "id", "jobOperationStepId" FROM "jobMaterial" WHERE "jobOperationStepId" IS NOT NULL;
INSERT INTO "quoteMaterialStep" ("quoteMaterialId", "quoteOperationStepId")
  SELECT "id", "quoteOperationStepId" FROM "quoteMaterial" WHERE "quoteOperationStepId" IS NOT NULL;
INSERT INTO "methodOperationToolStep" ("methodOperationToolId", "methodOperationStepId")
  SELECT "id", "methodOperationStepId" FROM "methodOperationTool" WHERE "methodOperationStepId" IS NOT NULL;
INSERT INTO "jobOperationToolStep" ("jobOperationToolId", "jobOperationStepId")
  SELECT "id", "jobOperationStepId" FROM "jobOperationTool" WHERE "jobOperationStepId" IS NOT NULL;
INSERT INTO "quoteOperationToolStep" ("quoteOperationToolId", "quoteOperationStepId")
  SELECT "id", "quoteOperationStepId" FROM "quoteOperationTool" WHERE "quoteOperationStepId" IS NOT NULL;
