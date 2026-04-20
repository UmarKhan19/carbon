-- ============================================================================
-- Item storage defaults + shelf-life management.
--
-- Adds three new columns to "item" (storage defaults only):
--   - "defaultLocationId"            : required for inventory-tracked types
--   - "defaultStorageUnitId"         : required for inventory-tracked types
--                                      (top-level = "shelf" in customer terms)
--   - "defaultNestedStorageUnitId"   : optional L2 default. When set, its
--                                      parentId must equal defaultStorageUnitId
--                                      and receipt flows require a storage
--                                      unit on the receipt line.
--
-- Shelf-life management lives on a new "itemShelfLife" table keyed by
-- itemId. Absence of a row = shelf life not managed for that item. This
-- keeps the "item" row narrow, matches how Carbon already segments
-- item-adjacent concerns (itemCost, itemReplenishment, itemPlanning etc.),
-- and replaces a 3-value enum on "item" with a cleaner 2-value mode on the
-- shelf-life row (the third option is "no row").
--
-- Shelf-life semantics (from the customer doc "Shelf Life Starting Logic"):
--   - ItemSpecific, no triggerProcess  = clock starts when any operation
--     on the make method that produces this item completes (e.g. a
--     subassembly with a defined lifetime). For raw materials received from
--     suppliers, the trigger is the Receipt flow, handled in the receipt
--     tracking UI - independent of this interceptor.
--   - ItemSpecific, with triggerProcess = clock starts only when an
--     operation using the named process completes (Harvest, Packaging,
--     Pasteurisation, etc.). The same batch is stamped in place - no new
--     batch is created per the "treatment does not create a new article"
--     rule.
--   - Calculated                       = Component Minimum. The output
--     batch inherits the earliest expiry among the consumed component
--     batches for that make method. Uses no shelfLifeDays.
--
-- Adds two per-company config columns to "companySettings":
--   - "nearExpiryWarningDays"        : threshold driving the "Expiring soon"
--                                      badge (default 14).
--   - "expiredBadgeEnabled"          : whether to show the red "Expired"
--                                      badge (default true).
--
-- Invariants enforced via event-system interceptors (see
-- 20260116215036_event_system_impl.sql and
-- 20260410030406_event-system-after-interceptors.sql):
--   - inventory-tracked types (Part, Material, Consumable) require both
--     defaultLocationId and defaultStorageUnitId on INSERT and on UPDATEs
--     that would clear a previously-set value
--   - defaultNestedStorageUnitId.parentId must equal defaultStorageUnitId
--
-- Also adds an AFTER-sync interceptor on "jobOperation" that stamps expiry
-- on the output batch when an operation transitions to 'Done'. Reads the
-- policy from "itemShelfLife" (no row = no stamp). This is the "background"
-- shelf-life trigger - it fires automatically via the event system; no UI
-- flow invokes it directly.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Storage default columns on "item"
-- ----------------------------------------------------------------------------
ALTER TABLE "item"
  ADD COLUMN "defaultLocationId" TEXT,
  ADD COLUMN "defaultStorageUnitId" TEXT,
  ADD COLUMN "defaultNestedStorageUnitId" TEXT,
  ADD CONSTRAINT "item_defaultLocationId_fkey"
    FOREIGN KEY ("defaultLocationId") REFERENCES "location"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "item_defaultStorageUnitId_fkey"
    FOREIGN KEY ("defaultStorageUnitId") REFERENCES "storageUnit"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "item_defaultNestedStorageUnitId_fkey"
    FOREIGN KEY ("defaultNestedStorageUnitId") REFERENCES "storageUnit"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "item_defaultLocationId_idx"
  ON "item" ("defaultLocationId");
CREATE INDEX "item_defaultStorageUnitId_idx"
  ON "item" ("defaultStorageUnitId");


-- ----------------------------------------------------------------------------
-- 1b. Per-item shelf-life policy. No row = not managed. Mode is constrained
--     to the two "actively managed" values.
--
--     - ItemSpecific: days required; triggerProcessId optional (null = any
--       operation on the item's make method stamps on completion).
--     - Calculated (Component Minimum): days and triggerProcessId must both
--       be null; expiry is inherited from the consumed component batches.
-- ----------------------------------------------------------------------------
CREATE TABLE "itemShelfLife" (
  "itemId"            TEXT NOT NULL,
  "mode"              TEXT NOT NULL
    CHECK ("mode" IN ('ItemSpecific', 'Calculated')),
  "days"              NUMERIC,
  "triggerProcessId"  TEXT,
  "companyId"         TEXT NOT NULL,
  "createdBy"         TEXT NOT NULL,
  "createdAt"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy"         TEXT,
  "updatedAt"         TIMESTAMP WITH TIME ZONE,
  "customFields"      JSONB,

  CONSTRAINT "itemShelfLife_pkey" PRIMARY KEY ("itemId"),
  CONSTRAINT "itemShelfLife_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemShelfLife_triggerProcessId_fkey"
    FOREIGN KEY ("triggerProcessId") REFERENCES "process"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "itemShelfLife_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemShelfLife_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "itemShelfLife_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id"),
  CONSTRAINT "itemShelfLife_days_nonNegative"
    CHECK ("days" IS NULL OR "days" > 0),
  CONSTRAINT "itemShelfLife_days_only_itemSpecific"
    CHECK ("days" IS NULL OR "mode" = 'ItemSpecific'),
  CONSTRAINT "itemShelfLife_triggerProcessId_only_itemSpecific"
    CHECK ("triggerProcessId" IS NULL OR "mode" = 'ItemSpecific'),
  CONSTRAINT "itemShelfLife_itemSpecific_requires_days"
    CHECK ("mode" <> 'ItemSpecific' OR "days" IS NOT NULL)
);

CREATE INDEX "itemShelfLife_companyId_idx"
  ON "itemShelfLife" ("companyId");
CREATE INDEX "itemShelfLife_triggerProcessId_idx"
  ON "itemShelfLife" ("triggerProcessId");

ALTER TABLE "itemShelfLife" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts_view can view item shelf life" ON "itemShelfLife"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_create can insert item shelf life" ON "itemShelfLife"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId")
    AND has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update item shelf life" ON "itemShelfLife"
  FOR UPDATE
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete item shelf life" ON "itemShelfLife"
  FOR DELETE
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('parts_delete', "companyId")
  );

CREATE POLICY "Requests with an API key can access item shelf life" ON "itemShelfLife"
  FOR ALL USING (has_valid_api_key_for_company("companyId"));


-- ----------------------------------------------------------------------------
-- 2. Columns on "companySettings"
-- ----------------------------------------------------------------------------
ALTER TABLE "companySettings"
  ADD COLUMN "nearExpiryWarningDays" INTEGER NOT NULL DEFAULT 14
    CHECK ("nearExpiryWarningDays" >= 0),
  ADD COLUMN "expiredBadgeEnabled" BOOLEAN NOT NULL DEFAULT true;


-- ----------------------------------------------------------------------------
-- 3. Interceptor: inventory-tracked types (Part, Material, Consumable) must
--    carry defaultLocationId + defaultStorageUnitId.
--
--    - INSERT: defaults must be supplied.
--    - UPDATE: only blocks clearing a previously-set default. Items that
--      predate this migration keep their NULLs until the user edits them
--      through the form (which supplies the defaults). A regression - going
--      from a set value back to NULL - is rejected.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION item_enforce_storage_defaults(
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
  v_type           TEXT;
  v_new_location   TEXT;
  v_new_storage    TEXT;
  v_old_location   TEXT;
  v_old_storage    TEXT;
BEGIN
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN
    RETURN;
  END IF;

  v_type := p_new->>'type';
  IF v_type NOT IN ('Part', 'Material', 'Consumable') THEN
    RETURN;
  END IF;

  v_new_location := p_new->>'defaultLocationId';
  v_new_storage  := p_new->>'defaultStorageUnitId';

  IF p_operation = 'INSERT' THEN
    IF v_new_location IS NULL THEN
      RAISE EXCEPTION
        'Item type % requires a default location', v_type;
    END IF;
    IF v_new_storage IS NULL THEN
      RAISE EXCEPTION
        'Item type % requires a default storage unit', v_type;
    END IF;
    RETURN;
  END IF;

  -- UPDATE: only block clearing previously-set defaults.
  v_old_location := p_old->>'defaultLocationId';
  v_old_storage  := p_old->>'defaultStorageUnitId';

  IF v_old_location IS NOT NULL AND v_new_location IS NULL THEN
    RAISE EXCEPTION
      'Cannot clear default location on item type %', v_type;
  END IF;

  IF v_old_storage IS NOT NULL AND v_new_storage IS NULL THEN
    RAISE EXCEPTION
      'Cannot clear default storage unit on item type %', v_type;
  END IF;
END;
$$;


-- ----------------------------------------------------------------------------
-- 4. Interceptor: when defaultNestedStorageUnitId is set, its parentId must
--    equal defaultStorageUnitId (and defaultStorageUnitId must be present).
--    Also ensures both resolve to the same locationId, matching the invariant
--    already enforced on the storageUnit hierarchy itself.
--    Fires on INSERT / UPDATE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION item_enforce_nested_storage_parent(
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
  v_nested_id          TEXT;
  v_default_id         TEXT;
  v_nested_parent_id   TEXT;
  v_nested_location_id TEXT;
  v_default_location_id TEXT;
BEGIN
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN
    RETURN;
  END IF;

  v_nested_id := p_new->>'defaultNestedStorageUnitId';
  IF v_nested_id IS NULL THEN
    RETURN;
  END IF;

  v_default_id := p_new->>'defaultStorageUnitId';
  IF v_default_id IS NULL THEN
    RAISE EXCEPTION
      'Nested default storage unit requires a top-level default storage unit';
  END IF;

  SELECT "parentId", "locationId"
  INTO v_nested_parent_id, v_nested_location_id
  FROM "storageUnit"
  WHERE "id" = v_nested_id;

  IF v_nested_parent_id IS NULL THEN
    RAISE EXCEPTION
      'Storage unit % is not nested and cannot be used as a nested default',
      v_nested_id;
  END IF;

  IF v_nested_parent_id IS DISTINCT FROM v_default_id THEN
    RAISE EXCEPTION
      'Nested default storage unit % must be a child of default storage unit %',
      v_nested_id, v_default_id;
  END IF;

  IF (p_new->>'defaultLocationId') IS NOT NULL
     AND v_nested_location_id IS DISTINCT FROM (p_new->>'defaultLocationId') THEN
    RAISE EXCEPTION
      'Nested default storage unit % is in location %, but item is in location %',
      v_nested_id, v_nested_location_id, (p_new->>'defaultLocationId');
  END IF;

  IF (p_new->>'defaultLocationId') IS NOT NULL THEN
    SELECT "locationId"
    INTO v_default_location_id
    FROM "storageUnit"
    WHERE "id" = v_default_id;

    IF v_default_location_id IS DISTINCT FROM (p_new->>'defaultLocationId') THEN
      RAISE EXCEPTION
        'Default storage unit % is in location %, but item is in location %',
        v_default_id, v_default_location_id, (p_new->>'defaultLocationId');
    END IF;
  END IF;
END;
$$;


-- ----------------------------------------------------------------------------
-- 5. Re-register the "item" event trigger. attach_event_trigger() DROPs and
--    re-CREATEs, so we must preserve the AFTER interceptors registered in
--    20260410031802_item-interceptors.sql.
-- ----------------------------------------------------------------------------
SELECT attach_event_trigger(
  'item',
  ARRAY[
    'item_enforce_storage_defaults',
    'item_enforce_nested_storage_parent'
  ]::TEXT[],
  ARRAY[
    'sync_create_item_related_records',
    'sync_create_make_method_related_records'
  ]::TEXT[]
);


-- ----------------------------------------------------------------------------
-- 6. Shared helper: stamp shelf-life expiry on the output batches of a
--    completed job operation.
--
--    Resolution chain:
--      jobOperation.jobMakeMethodId -> jobMakeMethod.itemId -> item
--    This resolves the *operation's own* output item regardless of whether
--    it is the top-level job item or a sub-assembly, so sub-assemblies
--    stamp their own batches on their own operation completions.
--
--    Two modes:
--      - ItemSpecific: expiry = CURRENT_DATE + itemShelfLife.days. Fires only
--        when (a) shelfLifeTriggerProcessId is NULL (any operation on the
--        make method stamps), or (b) the completed operation's processId
--        equals shelfLifeTriggerProcessId. FK equality - no string matching.
--        Mutates expirationDate on the existing batch - no new batch row.
--        Only stamps when expirationDate is still NULL, so replays don't
--        silently shift dates.
--      - Calculated (Component Minimum): expiry = MIN(expirationDate) across
--        consumed component batches of the same make method. Also only
--        stamps when expirationDate is NULL.
--
--    Safe to re-run on the same row: idempotent via IS NULL guards.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stamp_shelf_life_for_completed_operation(
  p_job_operation_id TEXT
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
  v_shelf_life_mode            TEXT;
  v_shelf_life_days            NUMERIC;
  v_shelf_life_trigger_process TEXT;
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

  -- Absence of a row in "itemShelfLife" means shelf life is not managed
  -- for this item. The helper returns early in that case.
  SELECT "mode", "days", "triggerProcessId"
  INTO v_shelf_life_mode, v_shelf_life_days, v_shelf_life_trigger_process
  FROM "itemShelfLife"
  WHERE "itemId" = v_item_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_shelf_life_mode = 'ItemSpecific' THEN
    -- days is NOT NULL on ItemSpecific per the table CHECK, but keep the
    -- guard for safety.
    IF v_shelf_life_days IS NULL THEN
      RETURN;
    END IF;

    IF v_shelf_life_trigger_process IS NOT NULL
       AND v_operation_process_id IS DISTINCT FROM v_shelf_life_trigger_process THEN
      RETURN;
    END IF;

    v_computed_expiry := (CURRENT_DATE + (v_shelf_life_days || ' days')::INTERVAL)::DATE;

  ELSIF v_shelf_life_mode = 'Calculated' THEN
    -- MIN expiry across components consumed by THIS make method. Scoped by
    -- jobMakeMethodId rather than jobId so sub-assemblies correctly inherit
    -- from their own consumed components, not the whole job's components.
    SELECT MIN(bn."expirationDate")
    INTO v_computed_expiry
    FROM "jobMaterialTracking" jmt
    JOIN "jobMaterial" jm ON jm."id" = jmt."jobMaterialId"
    JOIN "batchNumber" bn ON bn."id" = jmt."batchNumberId"
    WHERE jm."jobMakeMethodId" = v_job_make_method_id
      AND bn."expirationDate" IS NOT NULL;

    IF v_computed_expiry IS NULL THEN
      RETURN;
    END IF;
  ELSE
    RETURN;
  END IF;

  -- Stamp output batches produced for this make method's item whose expiry
  -- is still unset. jobProductionTracking is keyed by (jobId, itemId) rather
  -- than jobOperationId, so we filter by the resolved itemId to reach only
  -- this make method's output.
  UPDATE "batchNumber" bn
  SET "expirationDate" = v_computed_expiry
  WHERE bn."id" IN (
    SELECT jpt."batchNumberId"
    FROM "jobProductionTracking" jpt
    WHERE jpt."jobId" = v_job_id
      AND jpt."itemId" = v_item_id
      AND jpt."batchNumberId" IS NOT NULL
  )
  AND bn."expirationDate" IS NULL;
END;
$$;


-- ----------------------------------------------------------------------------
-- 7. AFTER-sync interceptor: fires when jobOperation.status flips to 'Done'.
--    Delegates to the shared helper above. Runs in the background via the
--    event-system - no UI path invokes it explicitly.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stamp_shelf_life_on_operation_done(
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

  PERFORM stamp_shelf_life_for_completed_operation(p_new->>'id');
END;
$$;


-- ----------------------------------------------------------------------------
-- 8. Re-register the "jobOperation" event trigger. Preserves the existing
--    BEFORE interceptor sync_finish_job_operation (registered in
--    20260410031809_production-interceptors.sql) and adds our AFTER one.
-- ----------------------------------------------------------------------------
SELECT attach_event_trigger(
  'jobOperation',
  ARRAY['sync_finish_job_operation']::TEXT[],
  ARRAY['stamp_shelf_life_on_operation_done']::TEXT[]
);
