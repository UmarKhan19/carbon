-- ============================================================================
-- Migration: 20260426020000_tracked-entity-expiration-date-column
--
-- Goal:
--   Promote "expirationDate" from a JSONB attributes key to a first-class
--   DATE column on "trackedEntity".
--
--   Per Brad's review on PR #692: JSON attributes are fine for descriptive
--   pass-through data, but anything we sort by, filter on, or run business
--   logic against should be its own column. Same pattern as the earlier
--   Serial Number / Batch Number -> readableId promotion.
--
-- Steps:
--   1. ADD COLUMN "expirationDate" DATE NULL on "trackedEntity".
--   2. Partial index on rows where the date is set, for fast near-expiry
--      report queries.
--   3. Define the three DB functions that own trackedEntity creation /
--      stamping so they write the column directly (no JSONB key written).
-- ============================================================================

-- 1. Add the column.
ALTER TABLE "trackedEntity"
  ADD COLUMN "expirationDate" DATE NULL;

-- 2. Partial index. Predominantly used by near-expiry reports / sort.
CREATE INDEX "trackedEntity_expirationDate_idx"
  ON "trackedEntity" ("expirationDate")
  WHERE "expirationDate" IS NOT NULL;

-- ============================================================================
-- 3. DB functions that write trackedEntity.expirationDate.
--    Column-only — the JSONB attributes blob carries descriptive context
--    (Receipt Line, Supplier, etc) but never the expirationDate key.
--    Functions:
--      a. update_receipt_line_batch_tracking
--      b. update_receipt_line_serial_tracking
--      c. set_shelf_life_for_operation
-- ============================================================================

-- 3a. Receipt batch tracking. Column-only.
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
  v_tracked_entity_id := COALESCE(p_tracked_entity_id, nanoid());

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
    'Receipt', p_receipt_id
  );

  IF v_supplier_id IS NOT NULL THEN
    v_attributes := v_attributes || jsonb_build_object('Supplier', v_supplier_id);
  END IF;

  -- Caller-supplied expiry comes in via p_properties. Pull it out into the
  -- local DATE variable then strip it from the JSONB (column is canonical).
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

  -- Fall back to the per-item shelf-life policy when caller didn't pass one.
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
    "expirationDate" = EXCLUDED."expirationDate";
END;
$$ LANGUAGE plpgsql;


-- 3b. Receipt serial tracking. Column-only.
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
      "expirationDate" = v_expiration_date
    WHERE id = p_tracked_entity_id;
  END IF;
END;
$$ LANGUAGE plpgsql;


-- 3c. Shelf-life stamp helper. Column-only.
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

    SELECT MIN(te."expirationDate")
    INTO v_computed_expiry
    FROM "trackedActivityInput" tai
    JOIN "trackedActivity" ta  ON ta."id"      = tai."trackedActivityId"
    JOIN "trackedEntity"   te  ON te."id"      = tai."trackedEntityId"
    JOIN "itemShelfLife"   isl ON isl."itemId" = te."sourceDocumentId"
    WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
      AND isl."mode" IN ('Fixed Duration', 'Calculated')
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
