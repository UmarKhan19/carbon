-- Fix `update_receipt_line_serial_tracking`: it was reintroduced in the
-- shelf-life feature commit with a reference to `receiptLine.itemReadableId`,
-- which was removed by migration 41c0a6f26. The batch-tracking sibling RPC
-- joins `item` and reads `readableIdWithRevision`; mirror that here so
-- receipts can actually save serial tracking for Set-on-Receipt (and any
-- other) items.

CREATE OR REPLACE FUNCTION public.update_receipt_line_serial_tracking(
  p_receipt_line_id text,
  p_receipt_id text,
  p_serial_number text,
  p_index integer,
  p_tracked_entity_id text DEFAULT NULL::text,
  p_expiry_date text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_item_id TEXT;
  v_item_readable_id TEXT;
  v_company_id TEXT;
  v_created_by TEXT;
  v_supplier_id TEXT;
  v_attributes JSONB;
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
      "createdBy"
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
      v_created_by
    );
  ELSE
    UPDATE "trackedEntity"
    SET
      "readableId" = p_serial_number,
      "attributes" = v_attributes,
      "sourceDocumentReadableId" = v_item_readable_id
    WHERE id = p_tracked_entity_id;
  END IF;
END;
$function$;
