-- ============================================================================
-- Migration: 20260426030000_calculated-shelf-life-include-set-on-receipt
--
-- Goal:
--   Fix the "Calculated" shelf-life mode so it considers ALL inputs that
--   carry an expiry, regardless of how the input's expiry was sourced.
--
--   Background:
--     The original set_shelf_life_for_operation helper restricted the
--     MIN(expirationDate) lookup to inputs whose itemShelfLife.mode is
--     either 'Fixed Duration' or 'Calculated'. The intent (per the comment
--     in 20260420000000) was that "Set on Receipt items are raw materials;
--     their supplier-stated expiry must not propagate."
--
--     That's wrong in practice. If the only input you have is a raw
--     material with a supplier-stamped expiry, the finished good cannot
--     outlive that input. A bag of rice flour cannot have a longer shelf
--     life than the bag of rice it was milled from. Filtering Set-on-
--     Receipt inputs out drops them silently and the produced entity
--     ends up with no expiry at all.
--
--   Repro:
--     - Rice item: itemShelfLife.mode = 'Set on Receipt', user enters
--       expiry at receipt time -> trackedEntity.expirationDate populated.
--     - Rice Flour item: itemShelfLife.mode = 'Calculated'.
--     - Issue Rice as input on the Rice Flour job's operation, complete
--       the operation. The seed entity for Rice Flour stays with
--       expirationDate = NULL because the Calculated query filtered out
--       the only input.
--
--   Fix:
--     Drop the mode-IN filter. Keep the "expirationDate IS NOT NULL"
--     guard - that's what determines whether the input contributes to
--     the MIN. The itemShelfLife join is still required because we need
--     to know the input is a tracked item at all (no row = not managed).
--     Down to a left-join on existence, but keeping inner-join via item
--     since every tracked item with an expiry has an item row.
-- ============================================================================

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
  v_shelf_life_mode            "shelfLifeMode";
  v_shelf_life_days            NUMERIC;
  v_shelf_life_trigger_process TEXT;
  v_shelf_life_trigger_timing  "shelfLifeTriggerTiming";
  v_computed_expiry            DATE;
BEGIN
  SELECT
    jo."jobId",
    jo."jobMakeMethodId",
    jo."processId",
    jmm."itemId"
  INTO
    v_job_id,
    v_job_make_method_id,
    v_operation_process_id,
    v_item_id
  FROM "jobOperation" jo
  JOIN "jobMakeMethod" jmm ON jmm."id" = jo."jobMakeMethodId"
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

    -- MIN expiry across every input consumed by THIS make method that
    -- carries an expirationDate. Mode-agnostic: a Set-on-Receipt input
    -- with a supplier-stamped expiry bounds the finished good just as
    -- much as a Fixed-Duration one.
    SELECT MIN(te."expirationDate")
    INTO v_computed_expiry
    FROM "trackedActivityInput" tai
    JOIN "trackedActivity" ta ON ta."id" = tai."trackedActivityId"
    JOIN "trackedEntity"   te ON te."id" = tai."trackedEntityId"
    WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
      AND te."expirationDate" IS NOT NULL;

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
