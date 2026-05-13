-- ============================================================================
-- Set shelf-life start at receipt time for Buy items + drop "stamp" verbiage.
--
-- Background
--   set_shelf_life_for_operation (renamed from stamp_shelf_life_for_operation)
--   only fires on jobOperation Before/After events. Buy items received via
--   a purchase order never hit a job operation, so their trackedEntity rows
--   never receive an expirationDate, even when itemShelfLife.mode =
--   'Fixed Duration'.
--
--   This migration:
--     1. Renames stamp_shelf_life_* helpers to set_shelf_life_*. The verb
--        "stamp" misrepresented the action - these helpers set the start
--        of the shelf-life window on the output trackedEntity.
--     2. Adds resolve_shelf_life_start_for_receipt(itemId, receiptId)
--        returning receipt.postingDate (or CURRENT_DATE) + days for
--        Fixed Duration items, NULL otherwise.
--     3. Extends update_receipt_line_batch_tracking and
--        update_receipt_line_serial_tracking to merge that computed
--        expirationDate into the trackedEntity attributes when the caller
--        did not supply one.
--
--   Set on Receipt mode is unchanged: the user supplies expiryDate via the
--   form. Calculated mode is irrelevant at receipt time (depends on
--   consumed sub-batches that don't exist yet).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Rename the per-operation helper.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS stamp_shelf_life_for_operation(TEXT, "shelfLifeTriggerTiming");

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

-- ----------------------------------------------------------------------------
-- 2. Rename interceptors. Drop old stamp_* versions and re-create as set_*.
--    Re-register the jobOperation event trigger to point at new names.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS stamp_shelf_life_on_operation_done(TEXT, TEXT, JSONB, JSONB);
DROP FUNCTION IF EXISTS stamp_shelf_life_on_operation_started(TEXT, TEXT, JSONB, JSONB);

CREATE OR REPLACE FUNCTION set_shelf_life_on_operation_done(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_status TEXT;
  v_new_status TEXT;
BEGIN
  IF p_operation <> 'UPDATE' THEN
    RETURN;
  END IF;

  v_new_status := p_new->>'status';
  IF v_new_status <> 'Done' THEN
    RETURN;
  END IF;

  v_old_status := p_old->>'status';
  IF v_old_status = 'Done' THEN
    RETURN;
  END IF;

  PERFORM set_shelf_life_for_operation(p_new->>'id', 'After');
END;
$$;

CREATE OR REPLACE FUNCTION set_shelf_life_on_operation_started(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_status TEXT;
  v_new_status TEXT;
BEGIN
  IF p_operation <> 'UPDATE' THEN
    RETURN;
  END IF;

  v_new_status := p_new->>'status';
  IF v_new_status <> 'In Progress' THEN
    RETURN;
  END IF;

  v_old_status := p_old->>'status';
  IF v_old_status = 'In Progress' THEN
    RETURN;
  END IF;

  PERFORM set_shelf_life_for_operation(p_new->>'id', 'Before');
END;
$$;

SELECT attach_event_trigger(
  'jobOperation',
  ARRAY['sync_finish_job_operation']::TEXT[],
  ARRAY[
    'set_shelf_life_on_operation_done',
    'set_shelf_life_on_operation_started'
  ]::TEXT[]
);

-- ----------------------------------------------------------------------------
-- 3. Resolve shelf-life start date for a receipt-tracked item.
--    Returns NULL when the item has no shelf-life policy or the policy
--    mode does not auto-compute at receipt time. Anchors on receipt
--    postingDate when set, else CURRENT_DATE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_shelf_life_start_for_receipt(
  p_item_id    TEXT,
  p_receipt_id TEXT
) RETURNS DATE
LANGUAGE plpgsql
AS $$
DECLARE
  v_mode   "shelfLifeMode";
  v_days   NUMERIC;
  v_anchor DATE;
BEGIN
  SELECT "mode", "days" INTO v_mode, v_days
  FROM "itemShelfLife"
  WHERE "itemId" = p_item_id;

  IF NOT FOUND OR v_mode <> 'Fixed Duration' OR v_days IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE("postingDate", CURRENT_DATE)
  INTO v_anchor
  FROM "receipt"
  WHERE id = p_receipt_id;

  RETURN (v_anchor + (v_days || ' days')::INTERVAL)::DATE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Extend update_receipt_line_batch_tracking. When p_properties does not
--    include an expirationDate AND the item is on Fixed Duration shelf
--    life, derive expirationDate from the policy and merge it into the
--    attributes JSONB.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_receipt_line_batch_tracking(
  p_receipt_line_id TEXT,
  p_receipt_id TEXT,
  p_batch_number TEXT,
  p_quantity NUMERIC,
  p_tracked_entity_id TEXT DEFAULT NULL,
  p_properties JSONB DEFAULT '{}'
) RETURNS void AS $$
DECLARE
  v_tracked_entity_id  TEXT;
  v_item_id            TEXT;
  v_item_readable_id   TEXT;
  v_company_id         TEXT;
  v_created_by         TEXT;
  v_supplier_id        TEXT;
  v_attributes         JSONB;
  v_resolved_expiry    DATE;
  v_expiration_date    DATE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_receipt_line_id));

  SELECT
    rl."itemId",
    i."readableIdWithRevision",
    rl."companyId",
    rl."createdBy",
    r."supplierId"
  INTO
    v_item_id,
    v_item_readable_id,
    v_company_id,
    v_created_by,
    v_supplier_id
  FROM "receiptLine" rl
  JOIN "receipt" r ON r.id = rl."receiptId"
  JOIN "item" i ON i.id = rl."itemId"
  WHERE rl.id = p_receipt_line_id;

  IF p_tracked_entity_id IS NOT NULL THEN
    v_tracked_entity_id := p_tracked_entity_id;
  ELSE
    SELECT id INTO v_tracked_entity_id
    FROM "trackedEntity"
    WHERE attributes->>'Receipt Line' = p_receipt_line_id
      AND "companyId" = v_company_id
    LIMIT 1;

    IF v_tracked_entity_id IS NULL THEN
      v_tracked_entity_id := nanoid();
    END IF;
  END IF;

  v_attributes := jsonb_build_object(
    'Receipt Line', p_receipt_line_id,
    'Receipt', p_receipt_id
  );

  IF v_supplier_id IS NOT NULL THEN
    v_attributes := v_attributes || jsonb_build_object('Supplier', v_supplier_id);
  END IF;

  IF (p_properties ? 'expirationDate') THEN
    BEGIN
      v_expiration_date := (p_properties->>'expirationDate')::DATE;
    EXCEPTION WHEN OTHERS THEN
      v_expiration_date := NULL;
    END;
    v_attributes := v_attributes || (p_properties - 'expirationDate');
  ELSE
    v_attributes := v_attributes || p_properties;
  END IF;

  IF v_expiration_date IS NULL THEN
    v_resolved_expiry := resolve_shelf_life_start_for_receipt(v_item_id, p_receipt_id);
    IF v_resolved_expiry IS NOT NULL THEN
      v_expiration_date := v_resolved_expiry;
    END IF;
  END IF;

  INSERT INTO "trackedEntity" (
    "id",
    "quantity",
    "status",
    "sourceDocument",
    "sourceDocumentId",
    "sourceDocumentReadableId",
    "readableId",
    "attributes",
    "companyId",
    "createdBy",
    "itemId",
    "expirationDate"
  )
  VALUES (
    v_tracked_entity_id,
    p_quantity,
    'On Hold',
    'Item',
    v_item_id,
    v_item_readable_id,
    p_batch_number,
    v_attributes,
    v_company_id,
    v_created_by,
    v_item_id,
    v_expiration_date
  )
  ON CONFLICT (id) DO UPDATE SET
    "quantity" = EXCLUDED."quantity",
    "readableId" = EXCLUDED."readableId",
    "attributes" = EXCLUDED."attributes",
    "itemId" = EXCLUDED."itemId",
    "expirationDate" = COALESCE(EXCLUDED."expirationDate", "trackedEntity"."expirationDate");
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 5. Extend update_receipt_line_serial_tracking the same way. When
--    p_expiry_date is null/empty AND the item is on Fixed Duration shelf
--    life, derive expirationDate from the policy.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS update_receipt_line_serial_tracking;
CREATE OR REPLACE FUNCTION update_receipt_line_serial_tracking(
  p_receipt_line_id TEXT,
  p_receipt_id TEXT,
  p_serial_number TEXT,
  p_index INTEGER,
  p_tracked_entity_id TEXT DEFAULT NULL,
  p_expiry_date TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_item_id            TEXT;
  v_item_readable_id   TEXT;
  v_company_id         TEXT;
  v_created_by         TEXT;
  v_supplier_id        TEXT;
  v_attributes         JSONB;
  v_resolved_expiry    DATE;
  v_expiration_date    DATE;
BEGIN
  SELECT
    rl."itemId",
    i."readableIdWithRevision",
    rl."companyId",
    rl."createdBy",
    r."supplierId"
  INTO
    v_item_id,
    v_item_readable_id,
    v_company_id,
    v_created_by,
    v_supplier_id
  FROM "receiptLine" rl
  JOIN "receipt" r ON r.id = rl."receiptId"
  JOIN "item" i ON i.id = rl."itemId"
  WHERE rl.id = p_receipt_line_id;

  v_attributes := jsonb_build_object(
    'Receipt Line', p_receipt_line_id,
    'Receipt', p_receipt_id,
    'Receipt Line Index', p_index
  );

  IF v_supplier_id IS NOT NULL THEN
    v_attributes := v_attributes || jsonb_build_object('Supplier', v_supplier_id);
  END IF;

  IF p_expiry_date IS NOT NULL AND p_expiry_date <> '' THEN
    BEGIN
      v_expiration_date := p_expiry_date::DATE;
    EXCEPTION WHEN OTHERS THEN
      v_expiration_date := NULL;
    END;
  ELSE
    v_resolved_expiry := resolve_shelf_life_start_for_receipt(v_item_id, p_receipt_id);
    IF v_resolved_expiry IS NOT NULL THEN
      v_expiration_date := v_resolved_expiry;
    END IF;
  END IF;

  IF p_tracked_entity_id IS NULL THEN
    INSERT INTO "trackedEntity" (
      "quantity",
      "status",
      "sourceDocument",
      "sourceDocumentId",
      "sourceDocumentReadableId",
      "readableId",
      "attributes",
      "companyId",
      "createdBy",
      "itemId",
      "expirationDate"
    )
    VALUES (
      1,
      'On Hold',
      'Item',
      v_item_id,
      v_item_readable_id,
      p_serial_number,
      v_attributes,
      v_company_id,
      v_created_by,
      v_item_id,
      v_expiration_date
    );
  ELSE
    UPDATE "trackedEntity"
    SET
      "readableId" = p_serial_number,
      "attributes" = v_attributes,
      "sourceDocumentReadableId" = v_item_readable_id,
      "itemId" = v_item_id,
      "expirationDate" = COALESCE(v_expiration_date, "expirationDate")
    WHERE id = p_tracked_entity_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
