-- Step reference images ("slides"). A first-class child of an operation step holding a
-- single reference image (+ optional caption + order), authored on the method (template)
-- and copied to the job/quote by get-method, exactly like steps/tools/parameters.
-- See PRD-step-reference-images.md. Mirrors the *OperationStep tables (single TEXT id PK,
-- companyId column, stepId FK ON DELETE CASCADE, production_* RLS).

-- 1. Template slides (authored in the BOP editor)
-- IF NOT EXISTS / drop-before-create so a re-run (shared dev volume whose bookkeeping
-- was pruned by the branch-switch migration repair) is a no-op instead of a hard failure.
CREATE TABLE IF NOT EXISTS "methodOperationStepSlide" (
  "id" TEXT NOT NULL DEFAULT id('slide'),
  "stepId" TEXT NOT NULL,
  "imagePath" TEXT NOT NULL,
  "caption" TEXT,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "methodOperationStepSlide_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "methodOperationStepSlide_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "methodOperationStep"("id") ON DELETE CASCADE,
  CONSTRAINT "methodOperationStepSlide_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "methodOperationStepSlide_stepId_idx" ON "methodOperationStepSlide" ("stepId");
CREATE INDEX IF NOT EXISTS "methodOperationStepSlide_companyId_idx" ON "methodOperationStepSlide" ("companyId");

-- 2. Job slides (copied from the template by get-method)
CREATE TABLE IF NOT EXISTS "jobOperationStepSlide" (
  "id" TEXT NOT NULL DEFAULT id('slide'),
  "stepId" TEXT NOT NULL,
  "imagePath" TEXT NOT NULL,
  "caption" TEXT,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "jobOperationStepSlide_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobOperationStepSlide_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "jobOperationStep"("id") ON DELETE CASCADE,
  CONSTRAINT "jobOperationStepSlide_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "jobOperationStepSlide_stepId_idx" ON "jobOperationStepSlide" ("stepId");
CREATE INDEX IF NOT EXISTS "jobOperationStepSlide_companyId_idx" ON "jobOperationStepSlide" ("companyId");

-- 3. Quote slides (copied from the template by get-method)
CREATE TABLE IF NOT EXISTS "quoteOperationStepSlide" (
  "id" TEXT NOT NULL DEFAULT id('slide'),
  "stepId" TEXT NOT NULL,
  "imagePath" TEXT NOT NULL,
  "caption" TEXT,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "quoteOperationStepSlide_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quoteOperationStepSlide_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "quoteOperationStep"("id") ON DELETE CASCADE,
  CONSTRAINT "quoteOperationStepSlide_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "quoteOperationStepSlide_stepId_idx" ON "quoteOperationStepSlide" ("stepId");
CREATE INDEX IF NOT EXISTS "quoteOperationStepSlide_companyId_idx" ON "quoteOperationStepSlide" ("companyId");

-- RLS — same shape as the *OperationStep parents (any employee reads; production perms write).
ALTER TABLE "public"."methodOperationStepSlide" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."jobOperationStepSlide" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."quoteOperationStepSlide" ENABLE ROW LEVEL SECURITY;

-- methodOperationStepSlide
DROP POLICY IF EXISTS "SELECT" ON "public"."methodOperationStepSlide";
CREATE POLICY "SELECT" ON "public"."methodOperationStepSlide"
FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
DROP POLICY IF EXISTS "INSERT" ON "public"."methodOperationStepSlide";
CREATE POLICY "INSERT" ON "public"."methodOperationStepSlide"
FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[]));
DROP POLICY IF EXISTS "UPDATE" ON "public"."methodOperationStepSlide";
CREATE POLICY "UPDATE" ON "public"."methodOperationStepSlide"
FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[]));
DROP POLICY IF EXISTS "DELETE" ON "public"."methodOperationStepSlide";
CREATE POLICY "DELETE" ON "public"."methodOperationStepSlide"
FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[]));

-- jobOperationStepSlide
DROP POLICY IF EXISTS "SELECT" ON "public"."jobOperationStepSlide";
CREATE POLICY "SELECT" ON "public"."jobOperationStepSlide"
FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
DROP POLICY IF EXISTS "INSERT" ON "public"."jobOperationStepSlide";
CREATE POLICY "INSERT" ON "public"."jobOperationStepSlide"
FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[]));
DROP POLICY IF EXISTS "UPDATE" ON "public"."jobOperationStepSlide";
CREATE POLICY "UPDATE" ON "public"."jobOperationStepSlide"
FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[]));
DROP POLICY IF EXISTS "DELETE" ON "public"."jobOperationStepSlide";
CREATE POLICY "DELETE" ON "public"."jobOperationStepSlide"
FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[]));

-- quoteOperationStepSlide
DROP POLICY IF EXISTS "SELECT" ON "public"."quoteOperationStepSlide";
CREATE POLICY "SELECT" ON "public"."quoteOperationStepSlide"
FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
DROP POLICY IF EXISTS "INSERT" ON "public"."quoteOperationStepSlide";
CREATE POLICY "INSERT" ON "public"."quoteOperationStepSlide"
FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[]));
DROP POLICY IF EXISTS "UPDATE" ON "public"."quoteOperationStepSlide";
CREATE POLICY "UPDATE" ON "public"."quoteOperationStepSlide"
FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[]));
DROP POLICY IF EXISTS "DELETE" ON "public"."quoteOperationStepSlide";
CREATE POLICY "DELETE" ON "public"."quoteOperationStepSlide"
FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[]));
