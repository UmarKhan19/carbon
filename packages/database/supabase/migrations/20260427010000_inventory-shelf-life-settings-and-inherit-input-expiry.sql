-- ============================================================================
-- Migration: 20260427010000_inventory-shelf-life-settings-and-inherit-input-expiry
--
-- Goal:
--   Two related shelf-life changes bundled together:
--
--   1. Consolidate every company-level shelf-life knob into the existing
--      companySettings.inventoryShelfLife JSONB blob, dropping the
--      now-redundant flat columns. Final blob shape:
--
--        {
--          "calculatedInputScope":  "AllInputs" | "ManagedInputsOnly",
--          "expiredEntityPolicy":   "Warn" | "Block" | "BlockWithOverride",
--          "nearExpiryWarningDays": number | null,
--          "defaultShelfLifeDays":  number
--        }
--
--      Adds the new "expiredEntityPolicy" knob in the same pass — controls
--      what happens when an operator tries to consume a tracked entity past
--      its expirationDate. Default 'Block' so the safe behavior is the
--      default.
--
--   2. Let Fixed Duration items optionally cap by the earliest input
--      expiry. Until now Fixed Duration produced a flat clock (today + N
--      days) and ignored input expiries. Customers in food / pharma need
--      the output to inherit the earliest input expiry when it's sooner —
--      flour shouldn't outlive its rice. Calculated mode already does this
--      implicitly, but that mode has no fixed clock at all, so it isn't
--      always the right answer when you want a default of "N days" with a
--      stale-input cap.
--
--      New flag on itemShelfLife: "inheritEarliestInputExpiry" BOOLEAN.
--      Only meaningful when mode = 'Fixed Duration'. Default false
--      (preserves existing behavior on every existing row).
--
--      When true:
--        expiry = LEAST(today + days, MIN(input expirationDate))
--        - inputs without expirationDate are skipped (ignored)
--        - if all inputs lack expirationDate, falls back to today + days
--        - the same companySettings.inventoryShelfLife.calculatedInputScope
--          knob (AllInputs vs ManagedInputsOnly) decides which inputs feed
--          MIN — keeps the rule uniform with Calculated mode.
-- ============================================================================

-- 1. Backfill the JSONB blob with values from the existing flat columns
--    plus the new expiredEntityPolicy default. `||` keeps any keys already
--    present (idempotent).
UPDATE "companySettings"
SET "inventoryShelfLife" = COALESCE("inventoryShelfLife", '{}'::JSONB)
  || jsonb_build_object(
       'nearExpiryWarningDays', "nearExpiryWarningDays",
       'defaultShelfLifeDays',  "defaultShelfLifeDays",
       'expiredEntityPolicy',   COALESCE(
         "inventoryShelfLife"->>'expiredEntityPolicy',
         'Block'
       )
     );


-- 2. Drop the now-redundant flat columns.
ALTER TABLE "companySettings"
  DROP COLUMN IF EXISTS "nearExpiryWarningDays",
  DROP COLUMN IF EXISTS "defaultShelfLifeDays";


-- 3. Inherit-earliest-input-expiry flag on itemShelfLife.
ALTER TABLE "itemShelfLife"
  ADD COLUMN "inheritEarliestInputExpiry" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "itemShelfLife"
  ADD CONSTRAINT "itemShelfLife_inheritEarliestInputExpiry_only_fixed_duration"
    CHECK (
      "mode" = 'Fixed Duration'
      OR "inheritEarliestInputExpiry" = false
    );


-- 4. Re-define the stamp helper to honor the new flag inside the Fixed
--    Duration branch. Other branches unchanged.
CREATE OR REPLACE FUNCTION set_shelf_life_for_operation(
  p_job_operation_id TEXT,
  p_event            "shelfLifeTriggerTiming"
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id                       TEXT;
  v_job_make_method_id           TEXT;
  v_operation_process_id         TEXT;
  v_item_id                      TEXT;
  v_company_id                   TEXT;
  v_shelf_life_mode              "shelfLifeMode";
  v_shelf_life_days              NUMERIC;
  v_shelf_life_trigger_process   TEXT;
  v_shelf_life_trigger_timing    "shelfLifeTriggerTiming";
  v_inherit_inputs               BOOLEAN;
  v_input_scope                  TEXT;
  v_computed_expiry              DATE;
  v_input_min                    DATE;
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

  SELECT
    "mode", "days", "triggerProcessId", "triggerTiming",
    "inheritEarliestInputExpiry"
  INTO
    v_shelf_life_mode, v_shelf_life_days, v_shelf_life_trigger_process,
    v_shelf_life_trigger_timing, v_inherit_inputs
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

    -- Cap by earliest input expiry when the flag is on.
    IF v_inherit_inputs THEN
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
        INTO v_input_min
        FROM "trackedActivityInput" tai
        JOIN "trackedActivity" ta ON ta."id" = tai."trackedActivityId"
        JOIN "trackedEntity"   te ON te."id" = tai."trackedEntityId"
        WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
          AND te."expirationDate" IS NOT NULL;
      ELSE
        SELECT MIN(te."expirationDate")
        INTO v_input_min
        FROM "trackedActivityInput" tai
        JOIN "trackedActivity" ta  ON ta."id"      = tai."trackedActivityId"
        JOIN "trackedEntity"   te  ON te."id"      = tai."trackedEntityId"
        JOIN "itemShelfLife"   isl ON isl."itemId" = te."sourceDocumentId"
        WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
          AND isl."mode" IN ('Fixed Duration', 'Calculated')
          AND te."expirationDate" IS NOT NULL;
      END IF;

      IF v_input_min IS NOT NULL AND v_input_min < v_computed_expiry THEN
        v_computed_expiry := v_input_min;
      END IF;
    END IF;

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
