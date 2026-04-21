-- =============================================================================
-- Fix sync_insert_job_make_method to restore tracked-entity seeding.
--
-- The event-system rewrite in 20260410031803_job-interceptors.sql dropped two
-- behaviors from the original insert_job_make_method() trigger defined in
-- 20250301125444_tracked-materials.sql:
--
--   1. Setting jobMakeMethod.requiresSerialTracking / requiresBatchTracking
--      from the item's itemTrackingType.
--   2. Inserting a seed trackedEntity with
--      attributes->>'Job Make Method' = <new jobMakeMethod.id>, which is what
--      JobProperties.tsx looks up to render the Serial/Batch Number input.
--
-- The sibling sync_insert_job_material_make_method in
-- 20260410031810_make-method-interceptors.sql already preserves both
-- behaviors — this migration brings the root-level job interceptor back in
-- line with it.
--
-- The function is already attached via attach_event_trigger('job', ...) in
-- 20260410031803_job-interceptors.sql, so no re-attachment is needed here.
-- =============================================================================

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
    "quantity", "status", "companyId", "createdBy", "attributes"
  ) VALUES (
    'Item', p_new->>'itemId', v_item_readable_id,
    COALESCE((p_new->>'quantity')::numeric, 1), 'Reserved',
    p_new->>'companyId', p_new->>'createdBy',
    jsonb_build_object('Job', p_new->>'id', 'Job Make Method', v_job_make_method_id)
  );
END;
$$;
