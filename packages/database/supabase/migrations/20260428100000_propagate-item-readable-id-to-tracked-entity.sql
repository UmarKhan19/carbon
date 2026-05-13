-- =============================================================================
-- Propagate item.readableIdWithRevision changes to trackedEntity.sourceDocumentReadableId
--
-- trackedEntity.sourceDocumentReadableId is denormalized at insert time from
-- the item's readableIdWithRevision (a generated column from readableId +
-- revision). When the item is renamed, the denormalized value goes stale —
-- the Tracked Entities table renders the old value because the loader reads
-- the column directly without joining item.
--
-- Add an AFTER UPDATE interceptor on item that updates every trackedEntity
-- with sourceDocument = 'Item' and sourceDocumentId = item.id when the
-- readable identifier changes.
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_propagate_item_readable_id_to_tracked_entity(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'readableIdWithRevision') IS NOT DISTINCT FROM (p_old->>'readableIdWithRevision') THEN
    RETURN;
  END IF;

  UPDATE "trackedEntity"
  SET "sourceDocumentReadableId" = p_new->>'readableIdWithRevision'
  WHERE "sourceDocument" = 'Item'
    AND "sourceDocumentId" = p_new->>'id';
END;
$$;

-- Re-attach with the existing AFTER interceptors plus the new one.
SELECT attach_event_trigger(
  'item',
  ARRAY[]::TEXT[],
  ARRAY[
    'sync_create_item_related_records',
    'sync_create_make_method_related_records',
    'sync_propagate_item_readable_id_to_tracked_entity'
  ]::TEXT[]
);

-- Backfill rows that drifted before the trigger existed.
UPDATE "trackedEntity" te
SET "sourceDocumentReadableId" = i."readableIdWithRevision"
FROM "item" i
WHERE te."sourceDocument" = 'Item'
  AND te."sourceDocumentId" = i."id"
  AND te."sourceDocumentReadableId" IS DISTINCT FROM i."readableIdWithRevision";
