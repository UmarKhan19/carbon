-- Associate a material (part/consumable) and a tool with a specific operation STEP, so the
-- MES can show only the parts/tools relevant to the step the operator is on — and scan a
-- serial/batch part at the step where it's actually used.
--
-- Nullable FK = backward compatible: every existing row stays operation-level (NULL = "applies
-- to the whole operation"). Authored on the method template and copied to job/quote by
-- get-method, exactly like steps/slides/tools/parameters. ON DELETE SET NULL because a
-- material/tool is owned by the OPERATION and only *assigned* to a step — deleting the step
-- must not delete the material; it just reverts to operation-level. Mirrors the stepId pattern
-- from 20260621154233_operation-step-slides.sql (which FKs the *OperationStep "id").

-- Materials ---------------------------------------------------------------------------------
-- IF NOT EXISTS so a re-run (shared dev volume whose bookkeeping was pruned by the
-- branch-switch migration repair) is a no-op instead of a hard failure.
ALTER TABLE "methodMaterial"
  ADD COLUMN IF NOT EXISTS "methodOperationStepId" TEXT
    REFERENCES "methodOperationStep"("id") ON DELETE SET NULL;
ALTER TABLE "jobMaterial"
  ADD COLUMN IF NOT EXISTS "jobOperationStepId" TEXT
    REFERENCES "jobOperationStep"("id") ON DELETE SET NULL;
ALTER TABLE "quoteMaterial"
  ADD COLUMN IF NOT EXISTS "quoteOperationStepId" TEXT
    REFERENCES "quoteOperationStep"("id") ON DELETE SET NULL;

-- Tools -------------------------------------------------------------------------------------
ALTER TABLE "methodOperationTool"
  ADD COLUMN IF NOT EXISTS "methodOperationStepId" TEXT
    REFERENCES "methodOperationStep"("id") ON DELETE SET NULL;
ALTER TABLE "jobOperationTool"
  ADD COLUMN IF NOT EXISTS "jobOperationStepId" TEXT
    REFERENCES "jobOperationStep"("id") ON DELETE SET NULL;
ALTER TABLE "quoteOperationTool"
  ADD COLUMN IF NOT EXISTS "quoteOperationStepId" TEXT
    REFERENCES "quoteOperationStep"("id") ON DELETE SET NULL;

-- Index every new FK (per conventions: index companyId and every FK).
CREATE INDEX IF NOT EXISTS "methodMaterial_methodOperationStepId_idx" ON "methodMaterial" ("methodOperationStepId");
CREATE INDEX IF NOT EXISTS "jobMaterial_jobOperationStepId_idx" ON "jobMaterial" ("jobOperationStepId");
CREATE INDEX IF NOT EXISTS "quoteMaterial_quoteOperationStepId_idx" ON "quoteMaterial" ("quoteOperationStepId");
CREATE INDEX IF NOT EXISTS "methodOperationTool_methodOperationStepId_idx" ON "methodOperationTool" ("methodOperationStepId");
CREATE INDEX IF NOT EXISTS "jobOperationTool_jobOperationStepId_idx" ON "jobOperationTool" ("jobOperationStepId");
CREATE INDEX IF NOT EXISTS "quoteOperationTool_quoteOperationStepId_idx" ON "quoteOperationTool" ("quoteOperationStepId");
