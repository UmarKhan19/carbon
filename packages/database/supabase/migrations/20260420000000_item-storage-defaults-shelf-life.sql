-- ============================================================================
-- Shelf-life management + company-level expiry settings.
--
-- Storage defaults at item creation are handled NOT with new columns on the
-- "item" table, but by writing into the existing "pickMethod" table keyed on
-- (itemId, locationId). That matches Carbon's existing architecture: items
-- are company-wide, while per-location stocking facts (default storage
-- unit, replenishment rules, quantities, etc.) live on side tables.
-- Putting a "defaultLocationId" on the item would misrepresent the reality
-- that items live across multiple locations. The form-level requirement
-- from the customer doc ("Location + Shelf mandatory at item creation") is
-- satisfied by forcing the user to pick a (Location, StorageUnit) on
-- create and upserting a pickMethod row from that pick.
--
-- Shelf-life management lives on a new "itemShelfLife" table keyed by
-- itemId. Absence of a row = shelf life not managed for that item. This
-- keeps the "item" row narrow, matches how Carbon already segments
-- item-adjacent concerns (itemCost, itemReplenishment, itemPlanning etc.),
-- and replaces a 3-value enum with a cleaner 2-value mode on the shelf-life
-- row (the third option is "no row").
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
-- Adds one per-company config column to "companySettings":
--   - "nearExpiryWarningDays"        : threshold driving the "Expiring soon"
--                                      badge. Also acts as the master kill
--                                      switch - when NULL, both the amber
--                                      "expiring soon" and red "expired"
--                                      badges are suppressed company-wide.
--                                      When set, batches within this many
--                                      days of today get the amber badge,
--                                      and batches past expiry get the red
--                                      badge. Defaults to NULL (disabled).
--
-- Invariants are enforced at the Zod validator level (partValidator /
-- materialValidator / consumableValidator in
-- apps/erp/app/modules/items/items.models.ts), not the DB. DB interceptors
-- would over-enforce and break internal scaffolding paths that create items
-- without user-provided defaults (quote drag-to-line, CSV import, MCP
-- tools). Form-level enforcement is the right boundary.
--
-- Adds an AFTER-sync interceptor on "jobOperation" that stamps expiry on
-- the output batch when an operation transitions to 'Done'. Reads the
-- policy from "itemShelfLife" (no row = no stamp). Runs in the background
-- via the event system; no UI flow invokes it directly.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Per-item shelf-life policy. No row = not managed. Mode is constrained
--    to the two "actively managed" values.
--
--    - ItemSpecific: days required; triggerProcessId optional (null = any
--      operation on the item's make method stamps on completion).
--    - Calculated (Component Minimum): days and triggerProcessId must both
--      be null; expiry is inherited from the consumed component batches.
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
  CONSTRAINT "itemShelfLife_days_positive"
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
  ADD COLUMN "nearExpiryWarningDays" INTEGER
    CHECK (
      "nearExpiryWarningDays" IS NULL
      OR "nearExpiryWarningDays" BETWEEN 0 AND 365
    );


-- ----------------------------------------------------------------------------
-- 3. Shared helper: stamp shelf-life expiry on the output trackedEntity of a
--    completed job operation.
--
--    Resolution chain:
--      jobOperation.jobMakeMethodId -> jobMakeMethod.itemId -> item
--    This resolves the *operation's own* output item regardless of whether
--    it is the top-level job item or a sub-assembly, so sub-assemblies
--    stamp their own tracked entities on their own operation completions.
--
--    Two modes:
--      - ItemSpecific: expiry = CURRENT_DATE + itemShelfLife.days. Fires only
--        when (a) triggerProcessId is NULL (any operation on the make method
--        stamps), or (b) the completed operation's processId equals
--        triggerProcessId. FK equality - no string matching.
--        Sets attributes->>'expirationDate' on the seed trackedEntity created
--        when the job was inserted. Only stamps when expirationDate is still
--        absent from attributes, so replays don't silently shift dates.
--      - Calculated (Component Minimum): expiry = MIN(expirationDate) across
--        the expirationDate attributes of trackedEntity inputs consumed by
--        trackedActivity rows linked to this make method. Also only stamps
--        when not already set.
--
--    Only items with itemTrackingType Serial or Batch have a seed
--    trackedEntity to stamp. Fungible (Inventory / Non-Inventory) items
--    produce no trackedEntity, so this helper silently no-ops for them.
--    The Zod validator rejects setting a shelf-life policy on such items
--    at the form level.
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
    -- MIN expiry across components consumed by THIS make method.
    -- Component consumption is recorded as trackedActivity rows whose
    -- attributes->>'Job Make Method' = v_job_make_method_id. Input
    -- trackedEntity rows carry their own expirationDate in attributes.
    SELECT MIN((te.attributes->>'expirationDate')::DATE)
    INTO v_computed_expiry
    FROM "trackedActivityInput" tai
    JOIN "trackedActivity" ta ON ta."id" = tai."trackedActivityId"
    JOIN "trackedEntity" te ON te."id" = tai."trackedEntityId"
    WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
      AND (te.attributes->>'expirationDate') IS NOT NULL;

    IF v_computed_expiry IS NULL THEN
      RETURN;
    END IF;
  ELSE
    RETURN;
  END IF;

  -- Stamp the seed trackedEntity for this job make method's output.
  -- The seed row was inserted with attributes->>'Job Make Method' = jobMakeMethodId
  -- (see sync_insert_job_make_method / sync_insert_job_material_make_method).
  -- Only stamp when expirationDate is not yet set (idempotent guard).
  UPDATE "trackedEntity"
  SET "attributes" = "attributes" || jsonb_build_object('expirationDate', v_computed_expiry::TEXT)
  WHERE "sourceDocument" = 'Item'
    AND "sourceDocumentId" = v_item_id
    AND "attributes"->>'Job Make Method' = v_job_make_method_id
    AND ("attributes"->>'expirationDate') IS NULL;
END;
$$;


-- ----------------------------------------------------------------------------
-- 4. AFTER-sync interceptor: fires when jobOperation.status flips to 'Done'.
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
-- 5. Re-register the "jobOperation" event trigger. Preserves the existing
--    BEFORE interceptor sync_finish_job_operation (registered in
--    20260410031809_production-interceptors.sql) and adds our AFTER one.
-- ----------------------------------------------------------------------------
SELECT attach_event_trigger(
  'jobOperation',
  ARRAY['sync_finish_job_operation']::TEXT[],
  ARRAY['stamp_shelf_life_on_operation_done']::TEXT[]
);
