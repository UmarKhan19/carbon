-- ============================================================================
-- Migration: 20260425010000_tracked-entity-item-fk
--
-- Goal:
--   Add a direct, FK-enforced link from "trackedEntity" to "item". The legacy
--   ("sourceDocument", "sourceDocumentId") pair is polymorphic — it can point
--   at item, receipt, shipment, jobMakeMethod, etc. — so it cannot carry a
--   single referential-integrity constraint. As a result, deleting an item
--   leaves orphan trackedEntity rows behind (verified in production).
--
--   This migration introduces a new "itemId" TEXT column with an explicit
--   FK to "item"("id") and ON DELETE RESTRICT. The column is NULLABLE for
--   now so existing rows that cannot be reliably backfilled stay queryable
--   while we ship the code paths that populate it on insert. A follow-up
--   migration will tighten to NOT NULL once all insert sites carry it.
--
-- Steps:
--   1. ADD COLUMN "itemId" TEXT NULL on "trackedEntity".
--   2. Backfill "itemId" from "sourceDocumentId" where sourceDocument='Item'.
--      (This is the common case — every batch/serial entity created via
--      update_receipt_line_*_tracking and the seed entities created at
--      job/material insert use sourceDocument='Item' with sourceDocumentId
--      pointing at the item id.)
--   3. Backfill "itemId" for rows whose attributes carry a hint that lets
--      us join through to an item: "Job Make Method" -> jobMakeMethod.itemId,
--      "Job Material" -> jobMaterial.itemId, "Receipt Line" -> receiptLine.itemId.
--      Only fills rows that are still NULL after step 2.
--   4. ADD CONSTRAINT FK "trackedEntity_itemId_fkey" REFERENCES "item"("id")
--      ON DELETE RESTRICT ON UPDATE CASCADE.
--   5. CREATE INDEX on ("itemId") for delete-time existence checks and
--      future ad-hoc lineage queries.
--
-- What this migration does NOT do:
--   - Make "itemId" NOT NULL. Some existing rows may not have a derivable
--     item (e.g. attributes blob has no recognized hint and sourceDocument
--     is not 'Item'). Those rows stay NULL until a manual review or a
--     code-side backfill catches them. New inserts must set itemId — that
--     change lives in a separate code PR touching the edge functions and
--     update_receipt_line_*_tracking helpers.
--   - Drop "sourceDocument"/"sourceDocumentId". Those columns still carry
--     useful provenance ("which receipt did this come from?") and other
--     code paths read them. Keep them around.
-- ============================================================================

-- 1. Add the column nullable so backfill can proceed in-place.
ALTER TABLE "trackedEntity"
  ADD COLUMN "itemId" TEXT NULL;

-- 2. Backfill the common case: rows tagged sourceDocument='Item' already
--    carry the item id in sourceDocumentId. Direct copy.
UPDATE "trackedEntity"
SET "itemId" = "sourceDocumentId"
WHERE "sourceDocument" = 'Item'
  AND "itemId" IS NULL
  AND "sourceDocumentId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "item" i WHERE i."id" = "trackedEntity"."sourceDocumentId"
  );

-- 3a. Rows whose attributes carry a "Job Make Method" hint -> resolve via
--     jobMakeMethod.itemId. Covers seed entities created at job/material
--     insert that for some reason landed without sourceDocument='Item'.
UPDATE "trackedEntity" te
SET "itemId" = jmm."itemId"
FROM "jobMakeMethod" jmm
WHERE te."itemId" IS NULL
  AND te."attributes" ? 'Job Make Method'
  AND jmm."id" = te."attributes"->>'Job Make Method'
  AND jmm."itemId" IS NOT NULL;

-- 3b. Rows whose attributes carry a "Job Material" hint -> resolve via
--     jobMaterial.itemId.
UPDATE "trackedEntity" te
SET "itemId" = jm."itemId"
FROM "jobMaterial" jm
WHERE te."itemId" IS NULL
  AND te."attributes" ? 'Job Material'
  AND jm."id" = te."attributes"->>'Job Material'
  AND jm."itemId" IS NOT NULL;

-- 3c. Rows whose attributes carry a "Receipt Line" hint -> resolve via
--     receiptLine.itemId.
UPDATE "trackedEntity" te
SET "itemId" = rl."itemId"
FROM "receiptLine" rl
WHERE te."itemId" IS NULL
  AND te."attributes" ? 'Receipt Line'
  AND rl."id" = te."attributes"->>'Receipt Line'
  AND rl."itemId" IS NOT NULL;

-- 4. Attach the FK. ON DELETE RESTRICT means an item with any tracked
--    entity (even a Consumed one) cannot be hard-deleted; callers must
--    deactivate ("active = false") instead. Nullable rows satisfy the FK
--    trivially — the constraint only checks non-null values.
ALTER TABLE "trackedEntity"
  ADD CONSTRAINT "trackedEntity_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Index for fast lookups when checking existence at item delete time
--    and when querying entities by item.
CREATE INDEX "trackedEntity_itemId_idx" ON "trackedEntity" ("itemId");


-- ============================================================================
-- 6. Re-define the four DB functions that INSERT into trackedEntity so they
--    populate the new "itemId" column. These are the only callers that own
--    the trackedEntity row creation flow inside the database (everything
--    else creates trackedEntity rows from edge functions, which are updated
--    in a separate code change).
--
--    a. update_receipt_line_batch_tracking
--    b. update_receipt_line_serial_tracking
--    c. sync_insert_job_make_method (root job seed)
--    d. sync_insert_job_material_make_method (sub-assembly seeds)
--    e. sync_update_job_material_make_method_item_id (re-seed on type swap)
--
--    Each kept identical aside from adding "itemId" to the INSERT column
--    list and the matching value. No behavior change beyond column fill.
-- ============================================================================

-- 6a. Receipt batch tracking
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

  v_attributes := v_attributes || p_properties;

  IF (v_attributes ? 'expirationDate') = false THEN
    v_resolved_expiry := resolve_shelf_life_start_for_receipt(v_item_id, p_receipt_id);
    IF v_resolved_expiry IS NOT NULL THEN
      v_attributes := v_attributes || jsonb_build_object('expirationDate', v_resolved_expiry::TEXT);
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
    "itemId"
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
    v_item_id
  )
  ON CONFLICT (id) DO UPDATE SET
    "quantity" = EXCLUDED."quantity",
    "readableId" = EXCLUDED."readableId",
    "attributes" = EXCLUDED."attributes",
    "itemId" = EXCLUDED."itemId";
END;
$$ LANGUAGE plpgsql;

-- 6b. Receipt serial tracking
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
    v_attributes := v_attributes || jsonb_build_object('expirationDate', p_expiry_date);
  ELSE
    v_resolved_expiry := resolve_shelf_life_start_for_receipt(v_item_id, p_receipt_id);
    IF v_resolved_expiry IS NOT NULL THEN
      v_attributes := v_attributes || jsonb_build_object('expirationDate', v_resolved_expiry::TEXT);
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
      "itemId"
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
      v_item_id
    );
  ELSE
    UPDATE "trackedEntity"
    SET
      "readableId" = p_serial_number,
      "attributes" = v_attributes,
      "sourceDocumentReadableId" = v_item_readable_id,
      "itemId" = v_item_id
    WHERE id = p_tracked_entity_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 6c. Root job make method seed
CREATE OR REPLACE FUNCTION sync_insert_job_make_method(
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
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_job_make_method_id TEXT;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  SELECT "readableIdWithRevision", "itemTrackingType"
    INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = p_new->>'itemId';

  INSERT INTO "jobMakeMethod" (
    "jobId", "itemId", "companyId", "createdBy",
    "requiresSerialTracking", "requiresBatchTracking"
  ) VALUES (
    p_new->>'id', p_new->>'itemId', p_new->>'companyId', p_new->>'createdBy',
    v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch'
  )
  RETURNING "id" INTO v_job_make_method_id;

  INSERT INTO "trackedEntity" (
    "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
    "quantity", "status", "companyId", "createdBy", "attributes", "itemId"
  ) VALUES (
    'Item', p_new->>'itemId', v_item_readable_id,
    COALESCE((p_new->>'quantity')::numeric, 1), 'Reserved',
    p_new->>'companyId', p_new->>'createdBy',
    jsonb_build_object('Job', p_new->>'id', 'Job Make Method', v_job_make_method_id),
    p_new->>'itemId'
  );
END;
$$;

-- 6d. Sub-assembly seed (insert path)
CREATE OR REPLACE FUNCTION sync_insert_job_material_make_method(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_job_make_method_id TEXT;
  v_version NUMERIC(10, 2);
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;
  IF (p_new->>'methodType') != 'Make to Order' THEN RETURN; END IF;
  IF (p_new->>'itemId') IS NULL THEN RETURN; END IF;

  SELECT "readableIdWithRevision", "itemTrackingType"
    INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = p_new->>'itemId';

  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = p_new->>'itemId';

  INSERT INTO "jobMakeMethod" (
    "jobId", "parentMaterialId", "itemId", "companyId", "createdBy",
    "requiresSerialTracking", "requiresBatchTracking", "version"
  ) VALUES (
    p_new->>'jobId', p_new->>'id', p_new->>'itemId', p_new->>'companyId', p_new->>'createdBy',
    v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch', v_version
  )
  RETURNING "id" INTO v_job_make_method_id;

  INSERT INTO "trackedEntity" (
    "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
    "quantity", "status", "companyId", "createdBy", "attributes", "itemId"
  ) VALUES (
    'Item', p_new->>'itemId', v_item_readable_id,
    (p_new->>'quantity')::numeric, 'Reserved',
    p_new->>'companyId', p_new->>'createdBy',
    jsonb_build_object('Job', p_new->>'jobId', 'Job Make Method', v_job_make_method_id, 'Job Material', p_new->>'id'),
    p_new->>'itemId'
  );
END;
$$;

-- 6e. Sub-assembly seed (update path: methodType swap or itemId change)
CREATE OR REPLACE FUNCTION sync_update_job_material_make_method_item_id(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_job_make_method_id TEXT;
  v_version NUMERIC(10, 2);
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  IF NOT (
    ((p_old->>'methodType') = 'Make to Order' AND (p_old->>'itemId') IS DISTINCT FROM (p_new->>'itemId'))
    OR ((p_new->>'methodType') = 'Make to Order' AND (p_old->>'methodType') != 'Make to Order')
  ) THEN
    RETURN;
  END IF;

  SELECT "readableIdWithRevision", "itemTrackingType"
    INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = p_new->>'itemId';

  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = p_new->>'itemId';

  IF NOT EXISTS (
    SELECT 1 FROM "jobMakeMethod"
    WHERE "jobId" = p_new->>'jobId' AND "parentMaterialId" = p_new->>'id'
  ) THEN
    INSERT INTO "jobMakeMethod" (
      "jobId", "parentMaterialId", "itemId", "companyId", "createdBy",
      "requiresSerialTracking", "requiresBatchTracking", "version"
    ) VALUES (
      p_new->>'jobId', p_new->>'id', p_new->>'itemId', p_new->>'companyId', p_new->>'createdBy',
      v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch', v_version
    )
    RETURNING "id" INTO v_job_make_method_id;

    INSERT INTO "trackedEntity" (
      "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
      "quantity", "status", "companyId", "createdBy", "attributes", "itemId"
    ) VALUES (
      'Item', p_new->>'itemId', v_item_readable_id,
      (p_new->>'quantity')::numeric, 'Reserved',
      p_new->>'companyId', p_new->>'createdBy',
      jsonb_build_object('Job', p_new->>'jobId', 'Job Make Method', v_job_make_method_id, 'Job Material', p_new->>'id'),
      p_new->>'itemId'
    );
  ELSE
    UPDATE "jobMakeMethod"
    SET "itemId" = p_new->>'itemId',
        "requiresSerialTracking" = (v_item_tracking_type = 'Serial'),
        "requiresBatchTracking" = (v_item_tracking_type = 'Batch'),
        "version" = v_version
    WHERE "jobId" = p_new->>'jobId' AND "parentMaterialId" = p_new->>'id'
    RETURNING "id" INTO v_job_make_method_id;

    INSERT INTO "trackedEntity" (
      "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
      "quantity", "status", "companyId", "createdBy", "attributes", "itemId"
    ) VALUES (
      'Item', p_new->>'itemId', v_item_readable_id,
      (p_new->>'quantity')::numeric, 'Reserved',
      p_new->>'companyId', p_new->>'createdBy',
      jsonb_build_object('Job', p_new->>'jobId', 'Job Make Method', v_job_make_method_id, 'Job Material', p_new->>'id'),
      p_new->>'itemId'
    );
  END IF;
END;
$$;
