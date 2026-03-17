-- 1. Create enum
CREATE TYPE "nonConformanceSystemActionType" AS ENUM (
  'Containment', 'Corrective', 'Preventive', 'Verification', 'Communication'
);

-- 2. Add column
ALTER TABLE "nonConformanceRequiredAction"
  ADD COLUMN "systemType" "nonConformanceSystemActionType";

-- 3. Backfill existing seeded records (match by name + createdBy = 'system')
UPDATE "nonConformanceRequiredAction" SET "systemType" = 'Containment'   WHERE name = 'Containment Action'    AND "createdBy" = 'system';
UPDATE "nonConformanceRequiredAction" SET "systemType" = 'Corrective'    WHERE name = 'Corrective Action'     AND "createdBy" = 'system';
UPDATE "nonConformanceRequiredAction" SET "systemType" = 'Preventive'    WHERE name = 'Preventive Action'     AND "createdBy" = 'system';
UPDATE "nonConformanceRequiredAction" SET "systemType" = 'Verification'  WHERE name = 'Verification'          AND "createdBy" = 'system';
UPDATE "nonConformanceRequiredAction" SET "systemType" = 'Communication' WHERE name = 'Customer Communication' AND "createdBy" = 'system';

-- 4. Partial unique index — each company gets at most one of each system type
CREATE UNIQUE INDEX "nonConformanceRequiredAction_companyId_systemType_unique"
  ON "nonConformanceRequiredAction" ("companyId", "systemType")
  WHERE "systemType" IS NOT NULL;

-- 5. Protect system actions from deletion or systemType changes
CREATE OR REPLACE FUNCTION protect_system_required_actions()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."systemType" IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete a system-defined required action. You may deactivate it instead.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."systemType" IS NOT NULL AND (NEW."systemType" IS DISTINCT FROM OLD."systemType") THEN
      RAISE EXCEPTION 'Cannot change the systemType of a system-defined required action.';
    END IF;
    IF OLD."systemType" IS NULL AND NEW."systemType" IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot assign a systemType to a custom required action.';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "protect_system_required_actions_trigger"
  BEFORE DELETE OR UPDATE ON "nonConformanceRequiredAction"
  FOR EACH ROW EXECUTE FUNCTION protect_system_required_actions();

-- 6. Index for view subquery performance
CREATE INDEX "nonConformanceRequiredAction_systemType_idx"
  ON "nonConformanceRequiredAction" ("systemType")
  WHERE "systemType" IS NOT NULL;

-- 7. Quality issue target setting
ALTER TABLE "companySettings"
  ADD COLUMN "qualityIssueTarget" INTEGER NOT NULL DEFAULT 20;

-- 8. Updated issues view — uses systemType instead of name
CREATE OR REPLACE VIEW "issues" WITH(SECURITY_INVOKER=true) AS
  SELECT
    ncr.*,
    nci."items",
    CASE
      WHEN EXISTS (
        SELECT 1 FROM "nonConformanceActionTask" ncat
        JOIN "nonConformanceRequiredAction" ncra ON ncat."actionTypeId" = ncra.id
        WHERE ncat."nonConformanceId" = ncr.id
          AND ncra."systemType" = 'Containment'
          AND ncat.status IN ('In Progress', 'Completed')
      ) THEN 'Contained'
      ELSE 'Uncontained'
    END AS "ContainmentStatus"
  FROM "nonConformance" ncr
  LEFT JOIN (
    SELECT "nonConformanceId", array_agg("itemId"::text) as items
    FROM "nonConformanceItem"
    GROUP BY "nonConformanceId"
  ) nci ON nci."nonConformanceId" = ncr."id";
