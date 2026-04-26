-- ============================================================================
-- Migration: 20260426040000_calculated-shelf-life-input-scope
--
-- Goal:
--   Make the "Calculated" shelf-life MIN computation scope a company-level
--   setting, namespaced under a new JSONB column "inventoryShelfLife" on
--   companySettings so future inventory shelf-life knobs can land in the
--   same blob without further migrations.
--
--   Current key inside the blob:
--     calculatedInputScope: 'AllInputs' | 'ManagedInputsOnly'
--
--       'AllInputs'           (default) - MIN across every consumed input
--                             that carries an expirationDate, regardless
--                             of how that input's expiry was sourced.
--                             Right answer for food / perishables.
--
--       'ManagedInputsOnly'   MIN across only inputs whose own
--                             itemShelfLife.mode is 'Fixed Duration' or
--                             'Calculated'. Skips Set-on-Receipt inputs
--                             whose expiry came from a supplier stamp.
--
-- Steps:
--   1. ADD COLUMN "inventoryShelfLife" JSONB on companySettings with the
--      default policy.
--   2. Re-define set_shelf_life_for_operation to read the JSON path and
--      branch its query accordingly.
-- ============================================================================

-- 1. JSONB blob for inventory shelf-life knobs.
ALTER TABLE "companySettings"
  ADD COLUMN "inventoryShelfLife" JSONB NOT NULL
    DEFAULT '{"calculatedInputScope": "AllInputs"}'::JSONB;


-- 2. Function reads companySettings.inventoryShelfLife.calculatedInputScope.
CREATE OR REPLACE FUNCTION set_shelf_life_for_operation(
  p_job_operation_id TEXT,
  p_event            "shelfLifeTriggerTiming"
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id                     TEXT;
  v_job_make_method_id         TEXT;
  v_operation_process_id       TEXT;
  v_item_id                    TEXT;
  v_company_id                 TEXT;
  v_shelf_life_mode            "shelfLifeMode";
  v_shelf_life_days            NUMERIC;
  v_shelf_life_trigger_process TEXT;
  v_shelf_life_trigger_timing  "shelfLifeTriggerTiming";
  v_input_scope                TEXT;
  v_computed_expiry            DATE;
BEGIN
  SELECT
    jo."jobId",
    jo."jobMakeMethodId",
    jo."processId",
    jmm."itemId",
    i."companyId"
  INTO
    v_job_id,
    v_job_make_method_id,
    v_operation_process_id,
    v_item_id,
    v_company_id
  FROM "jobOperation" jo
  JOIN "jobMakeMethod" jmm ON jmm."id" = jo."jobMakeMethodId"
  JOIN "item"          i  ON i."id"  = jmm."itemId"
  WHERE jo."id" = p_job_operation_id;

  IF v_item_id IS NULL THEN
    RETURN;
  END IF;

  SELECT "mode", "days", "triggerProcessId", "triggerTiming"
  INTO v_shelf_life_mode, v_shelf_life_days, v_shelf_life_trigger_process,
       v_shelf_life_trigger_timing
  FROM "itemShelfLife"
  WHERE "itemId" = v_item_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_shelf_life_mode = 'Fixed Duration' THEN
    IF v_shelf_life_days IS NULL THEN
      RETURN;
    END IF;

    IF v_shelf_life_trigger_process IS NULL THEN
      IF p_event <> 'After' THEN
        RETURN;
      END IF;
    ELSE
      IF v_operation_process_id IS DISTINCT FROM v_shelf_life_trigger_process THEN
        RETURN;
      END IF;
      IF p_event <> v_shelf_life_trigger_timing THEN
        RETURN;
      END IF;
    END IF;

    v_computed_expiry := (CURRENT_DATE + (v_shelf_life_days || ' days')::INTERVAL)::DATE;

  ELSIF v_shelf_life_mode = 'Calculated' THEN
    IF p_event <> 'After' THEN
      RETURN;
    END IF;

    SELECT COALESCE(
      "inventoryShelfLife"->>'calculatedInputScope',
      'AllInputs'
    )
    INTO v_input_scope
    FROM "companySettings"
    WHERE "id" = v_company_id;

    IF v_input_scope IS NULL THEN
      v_input_scope := 'AllInputs';
    END IF;

    IF v_input_scope = 'AllInputs' THEN
      SELECT MIN(te."expirationDate")
      INTO v_computed_expiry
      FROM "trackedActivityInput" tai
      JOIN "trackedActivity" ta ON ta."id" = tai."trackedActivityId"
      JOIN "trackedEntity"   te ON te."id" = tai."trackedEntityId"
      WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
        AND te."expirationDate" IS NOT NULL;
    ELSE
      -- 'ManagedInputsOnly': skip inputs that don't carry their own
      -- shelf-life policy in Fixed Duration / Calculated mode.
      SELECT MIN(te."expirationDate")
      INTO v_computed_expiry
      FROM "trackedActivityInput" tai
      JOIN "trackedActivity" ta  ON ta."id"      = tai."trackedActivityId"
      JOIN "trackedEntity"   te  ON te."id"      = tai."trackedEntityId"
      JOIN "itemShelfLife"   isl ON isl."itemId" = te."sourceDocumentId"
      WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
        AND isl."mode" IN ('Fixed Duration', 'Calculated')
        AND te."expirationDate" IS NOT NULL;
    END IF;

    IF v_computed_expiry IS NULL THEN
      RETURN;
    END IF;

  ELSIF v_shelf_life_mode = 'Set on Receipt' THEN
    RETURN;

  ELSE
    RETURN;
  END IF;

  UPDATE "trackedEntity"
  SET "expirationDate" = v_computed_expiry
  WHERE "sourceDocument" = 'Item'
    AND "sourceDocumentId" = v_item_id
    AND "attributes"->>'Job Make Method' = v_job_make_method_id
    AND "expirationDate" IS NULL;
END;
$$;
