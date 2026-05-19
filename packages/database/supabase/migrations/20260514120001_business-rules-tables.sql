-- Business Rules refactor — rename existing item-rule tables and add
-- support for storageUnit + workCenter target types.

----------------------------------------------------------------------
-- 1. Rename core rule table + constraints/indexes/policies
----------------------------------------------------------------------

ALTER TABLE "itemRule" RENAME TO "businessRule";

ALTER TABLE "businessRule" RENAME CONSTRAINT "itemRule_companyId_fkey"     TO "businessRule_companyId_fkey";
ALTER TABLE "businessRule" RENAME CONSTRAINT "itemRule_createdBy_fkey"     TO "businessRule_createdBy_fkey";
ALTER TABLE "businessRule" RENAME CONSTRAINT "itemRule_updatedBy_fkey"     TO "businessRule_updatedBy_fkey";
ALTER TABLE "businessRule" RENAME CONSTRAINT "itemRule_companyId_name_key" TO "businessRule_companyId_name_key";
ALTER TABLE "businessRule" RENAME CONSTRAINT "itemRule_surfaces_nonempty"  TO "businessRule_surfaces_nonempty";

ALTER INDEX IF EXISTS "itemRule_companyId_idx"                RENAME TO "businessRule_companyId_idx";
ALTER INDEX IF EXISTS "itemRule_companyId_active_partial_idx" RENAME TO "businessRule_companyId_active_partial_idx";

----------------------------------------------------------------------
-- 2. Add new columns to businessRule
----------------------------------------------------------------------

ALTER TABLE "businessRule"
  ADD COLUMN "targetType"   "businessRuleTargetType" NOT NULL DEFAULT 'item',
  ADD COLUMN "appliesToAll" BOOLEAN                  NOT NULL DEFAULT FALSE;

-- Common filter: rules for a given company + targetType + active flag.
CREATE INDEX "businessRule_companyId_targetType_active_idx"
  ON "businessRule" ("companyId", "targetType")
  WHERE "active" = TRUE;

----------------------------------------------------------------------
-- 3. Move businessRule RLS off parts_* permissions onto settings_*
----------------------------------------------------------------------

DROP POLICY IF EXISTS "SELECT" ON "public"."businessRule";
DROP POLICY IF EXISTS "INSERT" ON "public"."businessRule";
DROP POLICY IF EXISTS "UPDATE" ON "public"."businessRule";
DROP POLICY IF EXISTS "DELETE" ON "public"."businessRule";

CREATE POLICY "SELECT" ON "public"."businessRule"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."businessRule"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."businessRule"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."businessRule"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_delete'))::text[]
  )
);

----------------------------------------------------------------------
-- 4. Rename item assignment table
----------------------------------------------------------------------

ALTER TABLE "itemRuleAssignment" RENAME TO "businessRuleItemAssignment";

ALTER TABLE "businessRuleItemAssignment"
  RENAME CONSTRAINT "itemRuleAssignment_pkey"            TO "businessRuleItemAssignment_pkey";
ALTER TABLE "businessRuleItemAssignment"
  RENAME CONSTRAINT "itemRuleAssignment_itemId_fkey"     TO "businessRuleItemAssignment_itemId_fkey";
ALTER TABLE "businessRuleItemAssignment"
  RENAME CONSTRAINT "itemRuleAssignment_ruleId_fkey"     TO "businessRuleItemAssignment_ruleId_fkey";
ALTER TABLE "businessRuleItemAssignment"
  RENAME CONSTRAINT "itemRuleAssignment_companyId_fkey"  TO "businessRuleItemAssignment_companyId_fkey";
ALTER TABLE "businessRuleItemAssignment"
  RENAME CONSTRAINT "itemRuleAssignment_createdBy_fkey"  TO "businessRuleItemAssignment_createdBy_fkey";

ALTER INDEX IF EXISTS "itemRuleAssignment_itemId_idx"            RENAME TO "businessRuleItemAssignment_itemId_idx";
ALTER INDEX IF EXISTS "itemRuleAssignment_ruleId_idx"            RENAME TO "businessRuleItemAssignment_ruleId_idx";
ALTER INDEX IF EXISTS "itemRuleAssignment_companyId_idx"         RENAME TO "businessRuleItemAssignment_companyId_idx";
ALTER INDEX IF EXISTS "itemRuleAssignment_itemId_companyId_idx"  RENAME TO "businessRuleItemAssignment_itemId_companyId_idx";

----------------------------------------------------------------------
-- 5. Storage unit assignment table
----------------------------------------------------------------------

CREATE TABLE "businessRuleStorageUnitAssignment" (
  "storageUnitId" TEXT NOT NULL,
  "ruleId"        TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "createdBy"     TEXT NOT NULL,
  "createdAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "businessRuleStorageUnitAssignment_pkey"
    PRIMARY KEY ("storageUnitId", "ruleId"),
  CONSTRAINT "businessRuleStorageUnitAssignment_storageUnitId_fkey"
    FOREIGN KEY ("storageUnitId") REFERENCES "storageUnit"("id") ON DELETE CASCADE,
  CONSTRAINT "businessRuleStorageUnitAssignment_ruleId_fkey"
    FOREIGN KEY ("ruleId")        REFERENCES "businessRule"("id") ON DELETE CASCADE,
  CONSTRAINT "businessRuleStorageUnitAssignment_companyId_fkey"
    FOREIGN KEY ("companyId")     REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "businessRuleStorageUnitAssignment_createdBy_fkey"
    FOREIGN KEY ("createdBy")     REFERENCES "user"("id")
);

CREATE INDEX "businessRuleStorageUnitAssignment_storageUnitId_idx"
  ON "businessRuleStorageUnitAssignment" ("storageUnitId");
CREATE INDEX "businessRuleStorageUnitAssignment_ruleId_idx"
  ON "businessRuleStorageUnitAssignment" ("ruleId");
CREATE INDEX "businessRuleStorageUnitAssignment_companyId_idx"
  ON "businessRuleStorageUnitAssignment" ("companyId");
CREATE INDEX "businessRuleStorageUnitAssignment_storageUnitId_companyId_idx"
  ON "businessRuleStorageUnitAssignment" ("storageUnitId", "companyId");

ALTER TABLE "businessRuleStorageUnitAssignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."businessRuleStorageUnitAssignment"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."businessRuleStorageUnitAssignment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."businessRuleStorageUnitAssignment"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."businessRuleStorageUnitAssignment"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
  )
);

----------------------------------------------------------------------
-- 6. Work center assignment table
----------------------------------------------------------------------

CREATE TABLE "businessRuleWorkCenterAssignment" (
  "workCenterId" TEXT NOT NULL,
  "ruleId"       TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "createdBy"    TEXT NOT NULL,
  "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "businessRuleWorkCenterAssignment_pkey"
    PRIMARY KEY ("workCenterId", "ruleId"),
  CONSTRAINT "businessRuleWorkCenterAssignment_workCenterId_fkey"
    FOREIGN KEY ("workCenterId") REFERENCES "workCenter"("id") ON DELETE CASCADE,
  CONSTRAINT "businessRuleWorkCenterAssignment_ruleId_fkey"
    FOREIGN KEY ("ruleId")       REFERENCES "businessRule"("id") ON DELETE CASCADE,
  CONSTRAINT "businessRuleWorkCenterAssignment_companyId_fkey"
    FOREIGN KEY ("companyId")    REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "businessRuleWorkCenterAssignment_createdBy_fkey"
    FOREIGN KEY ("createdBy")    REFERENCES "user"("id")
);

CREATE INDEX "businessRuleWorkCenterAssignment_workCenterId_idx"
  ON "businessRuleWorkCenterAssignment" ("workCenterId");
CREATE INDEX "businessRuleWorkCenterAssignment_ruleId_idx"
  ON "businessRuleWorkCenterAssignment" ("ruleId");
CREATE INDEX "businessRuleWorkCenterAssignment_companyId_idx"
  ON "businessRuleWorkCenterAssignment" ("companyId");
CREATE INDEX "businessRuleWorkCenterAssignment_workCenterId_companyId_idx"
  ON "businessRuleWorkCenterAssignment" ("workCenterId", "companyId");

ALTER TABLE "businessRuleWorkCenterAssignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."businessRuleWorkCenterAssignment"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."businessRuleWorkCenterAssignment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."businessRuleWorkCenterAssignment"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."businessRuleWorkCenterAssignment"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_delete'))::text[]
  )
);

----------------------------------------------------------------------
-- 7. customFieldTable rename
----------------------------------------------------------------------

UPDATE "customFieldTable"
   SET "table" = 'businessRule',
       "name"  = 'Business Rule'
 WHERE "table" = 'itemRule';
