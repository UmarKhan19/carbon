-- The PDF thumbnail toggle is now per-document-template (Line Items block
-- "Show thumbnails" option). Before dropping the company-level flags, bake the
-- preference of companies that turned thumbnails OFF into their existing
-- document templates so their documents keep rendering the same way.
-- (Companies with no stored template just fall back to the template default,
-- which is thumbnails ON — matching the old column default of true.)

-- Sales documents: quote / sales order / sales invoice / packing slip.
UPDATE "documentTemplate" dt
SET blocks = (
  SELECT jsonb_agg(
    CASE
      WHEN block->>'type' = 'lineItems' THEN jsonb_set(
        block,
        '{options}',
        COALESCE(block->'options', '{}'::jsonb) || '{"showThumbnails": false}'::jsonb
      )
      ELSE block
    END
  )
  FROM jsonb_array_elements(dt.blocks) AS block
)
FROM "companySettings" cs
WHERE cs.id = dt."companyId"
  AND dt."documentType" IN ('quote', 'salesOrder', 'salesInvoice', 'packingSlip')
  AND cs."includeThumbnailsOnSalesPdfs" = false
  AND dt.blocks @> '[{"type":"lineItems"}]';

-- Purchasing documents: purchase order.
UPDATE "documentTemplate" dt
SET blocks = (
  SELECT jsonb_agg(
    CASE
      WHEN block->>'type' = 'lineItems' THEN jsonb_set(
        block,
        '{options}',
        COALESCE(block->'options', '{}'::jsonb) || '{"showThumbnails": false}'::jsonb
      )
      ELSE block
    END
  )
  FROM jsonb_array_elements(dt.blocks) AS block
)
FROM "companySettings" cs
WHERE cs.id = dt."companyId"
  AND dt."documentType" = 'purchaseOrder'
  AND cs."includeThumbnailsOnPurchasingPdfs" = false
  AND dt.blocks @> '[{"type":"lineItems"}]';

ALTER TABLE "companySettings"
  DROP COLUMN IF EXISTS "includeThumbnailsOnSalesPdfs";
ALTER TABLE "companySettings"
  DROP COLUMN IF EXISTS "includeThumbnailsOnPurchasingPdfs";
