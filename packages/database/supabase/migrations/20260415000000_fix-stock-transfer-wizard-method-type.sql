-- Fix get_item_shelf_requirements_by_location and get_item_shelf_requirements_by_location_and_item
-- to use the new methodType enum values ('Make to Order' instead of 'Make')
-- These were missed in the 20260321143847_method-type-migration.sql

DROP FUNCTION IF EXISTS get_item_shelf_requirements_by_location;
CREATE OR REPLACE FUNCTION get_item_shelf_requirements_by_location(company_id TEXT, location_id TEXT)
  RETURNS TABLE (
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "name" TEXT,
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "type" "itemType",
    "thumbnailPath" TEXT,
    "unitOfMeasureCode" TEXT,
    "quantityOnHandInShelf" NUMERIC,
    "quantityRequiredByShelf" NUMERIC,
    "quantityIncoming" NUMERIC,
    "shelfId" TEXT,
    "shelfName" TEXT,
    "isDefaultShelf" BOOLEAN
  ) AS $$
  BEGIN
    RETURN QUERY

WITH
  item_shelves AS (
    SELECT DISTINCT
      il."itemId",
      il."shelfId"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
  ),
  open_job_requirements_in_shelf AS (
    SELECT
      jm."itemId",
      jm."shelfId",
      SUM(jm."quantityToIssue") AS "quantityOnProductionDemandInShelf"
    FROM "jobMaterial" jm
    INNER JOIN "job" j ON jm."jobId" = j."id"
    WHERE j."status" IN (
        'Planned',
        'Ready',
        'In Progress',
        'Paused'
      )
    AND jm."methodType" != 'Make to Order'
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    GROUP BY jm."itemId", jm."shelfId"
  ),
  active_stock_transfers_from_shelf AS (
    SELECT
      stl."itemId",
      stl."fromShelfId" AS "shelfId",
      SUM(stl."outstandingQuantity") AS "quantityOnActiveStockTransferFromShelf"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    AND stl."fromShelfId" IS NOT NULL
    GROUP BY stl."itemId", stl."fromShelfId"
  ),
  active_stock_transfers_to_shelf AS (
    SELECT
      stl."itemId",
      stl."toShelfId" AS "shelfId",
      SUM(stl."outstandingQuantity") AS "quantityOnActiveStockTransferToShelf"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    AND stl."toShelfId" IS NOT NULL
    GROUP BY stl."itemId", stl."toShelfId"
  ),
  open_jobs AS (
    SELECT
      j."itemId" AS "jobItemId",
      j."shelfId",
      SUM(j."productionQuantity" - j."quantityReceivedToInventory") AS "quantityFromProduction"
    FROM job j
    WHERE j."status" IN (
      'Ready',
      'In Progress',
      'Paused',
      'Planned'
    ) AND "salesOrderId" IS NULL
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    GROUP BY j."itemId", j."shelfId"
  ),
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
      pol."shelfId",
      SUM(pol."quantityToReceive" * pol."conversionFactor") AS "quantityFromPurchaseOrder"
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
    WHERE
      po."status" IN (
        'Planned',
        'To Receive',
        'To Receive and Invoice'
      )
      AND po."companyId" = company_id
      AND pol."locationId" = location_id
    GROUP BY pol."itemId", pol."shelfId"
  ),
  item_ledgers_in_shelf AS (
    SELECT
      il."itemId" AS "ledgerItemId",
      il."shelfId",
      SUM(il."quantity") AS "quantityOnHandInShelf"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
    GROUP BY il."itemId", il."shelfId"
  ),
  items_with_activity AS (
    SELECT DISTINCT active_items."itemId", active_items."shelfId"
    FROM (
      SELECT ils."ledgerItemId" AS "itemId", ils."shelfId"
      FROM item_ledgers_in_shelf ils
      WHERE ils."quantityOnHandInShelf" > 0

      UNION

      SELECT ojis."itemId", ojis."shelfId"
      FROM open_job_requirements_in_shelf ojis
      WHERE ojis."quantityOnProductionDemandInShelf" > 0

      UNION

      SELECT astfs."itemId", astfs."shelfId"
      FROM active_stock_transfers_from_shelf astfs
      WHERE astfs."quantityOnActiveStockTransferFromShelf" > 0

      UNION

      SELECT astts."itemId", astts."shelfId"
      FROM active_stock_transfers_to_shelf astts
      WHERE astts."quantityOnActiveStockTransferToShelf" > 0

      UNION

      SELECT oj."jobItemId" AS "itemId", oj."shelfId"
      FROM open_jobs oj
      WHERE oj."quantityFromProduction" > 0

      UNION

      SELECT opo."purchaseOrderItemId" AS "itemId", opo."shelfId"
      FROM open_purchase_orders opo
      WHERE opo."quantityFromPurchaseOrder" > 0
    ) active_items
  )

SELECT
  ish."itemId",
  i."readableId" AS "itemReadableId",
  i."name",
  i."name" AS "description",
  i."itemTrackingType",
  i."type",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  COALESCE(ils."quantityOnHandInShelf", 0) + COALESCE(astts."quantityOnActiveStockTransferToShelf", 0) AS "quantityOnHandInShelf",
  COALESCE(ojis."quantityOnProductionDemandInShelf", 0) + COALESCE(astfs."quantityOnActiveStockTransferFromShelf", 0) AS "quantityRequiredByShelf",
  COALESCE(oj."quantityFromProduction", 0) + COALESCE(opo."quantityFromPurchaseOrder", 0) AS "quantityIncoming",
  ish."shelfId",
  s."name" AS "shelfName",
  COALESCE(pm."defaultShelfId" = ish."shelfId", false) AS "isDefaultShelf"
FROM
  items_with_activity ish
  INNER JOIN "item" i ON i."id" = ish."itemId"
  LEFT JOIN "shelf" s ON s."id" = ish."shelfId"
  LEFT JOIN item_ledgers_in_shelf ils ON i."id" = ils."ledgerItemId" AND ish."shelfId" IS NOT DISTINCT FROM ils."shelfId"
  LEFT JOIN open_job_requirements_in_shelf ojis ON i."id" = ojis."itemId" AND ish."shelfId" IS NOT DISTINCT FROM ojis."shelfId"
  LEFT JOIN active_stock_transfers_from_shelf astfs ON i."id" = astfs."itemId" AND ish."shelfId" IS NOT DISTINCT FROM astfs."shelfId"
  LEFT JOIN active_stock_transfers_to_shelf astts ON i."id" = astts."itemId" AND ish."shelfId" IS NOT DISTINCT FROM astts."shelfId"
  LEFT JOIN open_jobs oj ON i."id" = oj."jobItemId" AND ish."shelfId" IS NOT DISTINCT FROM oj."shelfId"
  LEFT JOIN open_purchase_orders opo ON i."id" = opo."purchaseOrderItemId" AND ish."shelfId" IS NOT DISTINCT FROM opo."shelfId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "pickMethod" pm ON pm."itemId" = i."id" AND pm."locationId" = location_id
ORDER BY (COALESCE(ils."quantityOnHandInShelf", 0) + COALESCE(astts."quantityOnActiveStockTransferToShelf", 0) - COALESCE(ojis."quantityOnProductionDemandInShelf", 0) - COALESCE(astfs."quantityOnActiveStockTransferFromShelf", 0)) ASC;
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


DROP FUNCTION IF EXISTS get_item_shelf_requirements_by_location_and_item;
CREATE OR REPLACE FUNCTION get_item_shelf_requirements_by_location_and_item(company_id TEXT, location_id TEXT, item_id TEXT DEFAULT NULL)
  RETURNS TABLE (
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "name" TEXT,
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "type" "itemType",
    "thumbnailPath" TEXT,
    "unitOfMeasureCode" TEXT,
    "quantityOnHandInShelf" NUMERIC,
    "quantityRequiredByShelf" NUMERIC,
    "quantityIncoming" NUMERIC,
    "shelfId" TEXT,
    "shelfName" TEXT,
    "isDefaultShelf" BOOLEAN
  ) AS $$
  BEGIN
    RETURN QUERY

WITH
  item_shelves AS (
    SELECT DISTINCT
      il."itemId",
      il."shelfId"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
      AND (item_id IS NULL OR il."itemId" = item_id)
  ),
  open_job_requirements_in_shelf AS (
    SELECT
      jm."itemId",
      jm."shelfId",
      SUM(jm."quantityToIssue") AS "quantityOnProductionDemandInShelf"
    FROM "jobMaterial" jm
    INNER JOIN "job" j ON jm."jobId" = j."id"
    WHERE j."status" IN (
        'Planned',
        'Ready',
        'In Progress',
        'Paused'
      )
    AND jm."methodType" != 'Make to Order'
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    AND (item_id IS NULL OR jm."itemId" = item_id)
    GROUP BY jm."itemId", jm."shelfId"
  ),
  active_stock_transfers_from_shelf AS (
    SELECT
      stl."itemId",
      stl."fromShelfId" AS "shelfId",
      SUM(stl."outstandingQuantity") AS "quantityOnActiveStockTransferFromShelf"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    AND stl."fromShelfId" IS NOT NULL
    AND (item_id IS NULL OR stl."itemId" = item_id)
    GROUP BY stl."itemId", stl."fromShelfId"
  ),
  active_stock_transfers_to_shelf AS (
    SELECT
      stl."itemId",
      stl."toShelfId" AS "shelfId",
      SUM(stl."outstandingQuantity") AS "quantityOnActiveStockTransferToShelf"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    AND stl."toShelfId" IS NOT NULL
    AND (item_id IS NULL OR stl."itemId" = item_id)
    GROUP BY stl."itemId", stl."toShelfId"
  ),
  open_jobs AS (
    SELECT
      j."itemId" AS "jobItemId",
      j."shelfId",
      SUM(j."productionQuantity" - j."quantityReceivedToInventory") AS "quantityFromProduction"
    FROM job j
    WHERE j."status" IN (
      'Ready',
      'In Progress',
      'Paused',
      'Planned'
    ) AND "salesOrderId" IS NULL
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    AND (item_id IS NULL OR j."itemId" = item_id)
    GROUP BY j."itemId", j."shelfId"
  ),
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
      pol."shelfId",
      SUM(pol."quantityToReceive" * pol."conversionFactor") AS "quantityFromPurchaseOrder"
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
    WHERE
      po."status" IN (
        'Planned',
        'To Receive',
        'To Receive and Invoice'
      )
      AND po."companyId" = company_id
      AND pol."locationId" = location_id
      AND (item_id IS NULL OR pol."itemId" = item_id)
    GROUP BY pol."itemId", pol."shelfId"
  ),
  item_ledgers_in_shelf AS (
    SELECT
      il."itemId" AS "ledgerItemId",
      il."shelfId",
      SUM(il."quantity") AS "quantityOnHandInShelf"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
      AND (item_id IS NULL OR il."itemId" = item_id)
    GROUP BY il."itemId", il."shelfId"
  ),
  items_with_activity AS (
    SELECT DISTINCT active_items."itemId", active_items."shelfId"
    FROM (
      SELECT ils."ledgerItemId" AS "itemId", ils."shelfId"
      FROM item_ledgers_in_shelf ils
      WHERE ils."quantityOnHandInShelf" > 0

      UNION

      SELECT ojis."itemId", ojis."shelfId"
      FROM open_job_requirements_in_shelf ojis
      WHERE ojis."quantityOnProductionDemandInShelf" > 0

      UNION

      SELECT astfs."itemId", astfs."shelfId"
      FROM active_stock_transfers_from_shelf astfs
      WHERE astfs."quantityOnActiveStockTransferFromShelf" > 0

      UNION

      SELECT astts."itemId", astts."shelfId"
      FROM active_stock_transfers_to_shelf astts
      WHERE astts."quantityOnActiveStockTransferToShelf" > 0

      UNION

      SELECT oj."jobItemId" AS "itemId", oj."shelfId"
      FROM open_jobs oj
      WHERE oj."quantityFromProduction" > 0

      UNION

      SELECT opo."purchaseOrderItemId" AS "itemId", opo."shelfId"
      FROM open_purchase_orders opo
      WHERE opo."quantityFromPurchaseOrder" > 0
    ) active_items
  )

SELECT
  ish."itemId",
  i."readableId" AS "itemReadableId",
  i."name",
  i."name" AS "description",
  i."itemTrackingType",
  i."type",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  COALESCE(ils."quantityOnHandInShelf", 0) + COALESCE(astts."quantityOnActiveStockTransferToShelf", 0) AS "quantityOnHandInShelf",
  COALESCE(ojis."quantityOnProductionDemandInShelf", 0) + COALESCE(astfs."quantityOnActiveStockTransferFromShelf", 0) AS "quantityRequiredByShelf",
  COALESCE(oj."quantityFromProduction", 0) + COALESCE(opo."quantityFromPurchaseOrder", 0) AS "quantityIncoming",
  ish."shelfId",
  s."name" AS "shelfName",
  COALESCE(pm."defaultShelfId" = ish."shelfId", false) AS "isDefaultShelf"
FROM
  items_with_activity ish
  INNER JOIN "item" i ON i."id" = ish."itemId"
  LEFT JOIN "shelf" s ON s."id" = ish."shelfId"
  LEFT JOIN item_ledgers_in_shelf ils ON i."id" = ils."ledgerItemId" AND ish."shelfId" IS NOT DISTINCT FROM ils."shelfId"
  LEFT JOIN open_job_requirements_in_shelf ojis ON i."id" = ojis."itemId" AND ish."shelfId" IS NOT DISTINCT FROM ojis."shelfId"
  LEFT JOIN active_stock_transfers_from_shelf astfs ON i."id" = astfs."itemId" AND ish."shelfId" IS NOT DISTINCT FROM astfs."shelfId"
  LEFT JOIN active_stock_transfers_to_shelf astts ON i."id" = astts."itemId" AND ish."shelfId" IS NOT DISTINCT FROM astts."shelfId"
  LEFT JOIN open_jobs oj ON i."id" = oj."jobItemId" AND ish."shelfId" IS NOT DISTINCT FROM oj."shelfId"
  LEFT JOIN open_purchase_orders opo ON i."id" = opo."purchaseOrderItemId" AND ish."shelfId" IS NOT DISTINCT FROM opo."shelfId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "pickMethod" pm ON pm."itemId" = i."id" AND pm."locationId" = location_id
ORDER BY (COALESCE(ils."quantityOnHandInShelf", 0) + COALESCE(astts."quantityOnActiveStockTransferToShelf", 0) - COALESCE(ojis."quantityOnProductionDemandInShelf", 0) - COALESCE(astfs."quantityOnActiveStockTransferFromShelf", 0)) DESC;
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
