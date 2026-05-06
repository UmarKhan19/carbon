-- ============================================================
-- Seed job.autoGeneratePickingList from companySettings.defaultAutoGeneratePickingList
--
-- The column already has DEFAULT true. This BEFORE INSERT trigger
-- overrides that default with the company-level default whenever a
-- companySettings row exists. After creation the per-job value can
-- still be changed via UI (the trigger fires only on INSERT).
--
-- Trade-off: if a caller explicitly POSTs autoGeneratePickingList = true
-- on a company that defaults to false, we'll downgrade to false. This
-- is fine because the per-job toggle UI (Gap 3d) lets planners flip the
-- value back after the job exists. The common case (planner accepts
-- defaults) is exactly what the plan asks for.
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_default_auto_generate_picking_list()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_default BOOLEAN;
BEGIN
  SELECT cs."defaultAutoGeneratePickingList"
  INTO v_default
  FROM "companySettings" cs
  WHERE cs.id = NEW."companyId";

  IF v_default IS NOT NULL THEN
    NEW."autoGeneratePickingList" := v_default;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "job_default_auto_generate_picking_list" ON "job";
CREATE TRIGGER "job_default_auto_generate_picking_list"
BEFORE INSERT ON "job"
FOR EACH ROW
EXECUTE FUNCTION trigger_default_auto_generate_picking_list();
