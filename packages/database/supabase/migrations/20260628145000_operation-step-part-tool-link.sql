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
ALTER TABLE "methodMaterial"
  ADD COLUMN "methodOperationStepId" TEXT
    REFERENCES "methodOperationStep"("id") ON DELETE SET NULL;
ALTER TABLE "jobMaterial"
  ADD COLUMN "jobOperationStepId" TEXT
    REFERENCES "jobOperationStep"("id") ON DELETE SET NULL;
ALTER TABLE "quoteMaterial"
  ADD COLUMN "quoteOperationStepId" TEXT
    REFERENCES "quoteOperationStep"("id") ON DELETE SET NULL;

-- Tools -------------------------------------------------------------------------------------
ALTER TABLE "methodOperationTool"
  ADD COLUMN "methodOperationStepId" TEXT
    REFERENCES "methodOperationStep"("id") ON DELETE SET NULL;
ALTER TABLE "jobOperationTool"
  ADD COLUMN "jobOperationStepId" TEXT
    REFERENCES "jobOperationStep"("id") ON DELETE SET NULL;
ALTER TABLE "quoteOperationTool"
  ADD COLUMN "quoteOperationStepId" TEXT
    REFERENCES "quoteOperationStep"("id") ON DELETE SET NULL;

-- Index every new FK (per conventions: index companyId and every FK).
CREATE INDEX "methodMaterial_methodOperationStepId_idx" ON "methodMaterial" ("methodOperationStepId");
CREATE INDEX "jobMaterial_jobOperationStepId_idx" ON "jobMaterial" ("jobOperationStepId");
CREATE INDEX "quoteMaterial_quoteOperationStepId_idx" ON "quoteMaterial" ("quoteOperationStepId");
CREATE INDEX "methodOperationTool_methodOperationStepId_idx" ON "methodOperationTool" ("methodOperationStepId");
CREATE INDEX "jobOperationTool_jobOperationStepId_idx" ON "jobOperationTool" ("jobOperationStepId");
CREATE INDEX "quoteOperationTool_quoteOperationStepId_idx" ON "quoteOperationTool" ("quoteOperationStepId");
