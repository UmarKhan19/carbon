-- Inventory quantity accuracy for rejected lots
--
-- Context: planning (purchasing + production) treats quantityOnHand as
-- quantity-available. Today quantityOnHand is `SUM(itemLedger.quantity)`,
-- which still counts ledger rows whose tracked entity is Rejected. Those
-- units cannot be used, so they artificially inflate available supply.
--
-- On-hand semantics (as of this migration):
--   * `Available`, `Reserved`, `Consumed` — count toward quantityOnHand
--     as before. (Consumed has an offsetting negative ledger row from
--     consumption; Reserved is physically present; reservations are
--     tracked separately via SO/PO/job quantities.)
--   * `On Hold` — counts toward quantityOnHand. Held units are physically
--     in the warehouse pending inspection; planners still want to see the
--     supply. A companion `quantityOnHold` column surfaces the subset for
--     UI display.
--   * `Rejected` — excluded from quantityOnHand. A companion
--     `quantityRejected` column surfaces the excluded total.
--
-- Strategy: mirror trackedEntity.status onto itemLedger so reads don't
-- need a JOIN. Extend get_inventory_quantities to filter on the column.

-- ---------------------------------------------------------------------------
-- 1. Denormalized status column on itemLedger
-- ---------------------------------------------------------------------------

ALTER TABLE "itemLedger"
  ADD COLUMN IF NOT EXISTS "trackedEntityStatus" "trackedEntityStatus";

-- Backfill from existing trackedEntity rows
UPDATE "itemLedger" il
SET "trackedEntityStatus" = te."status"
FROM "trackedEntity" te
WHERE il."trackedEntityId" = te."id"
  AND il."trackedEntityStatus" IS DISTINCT FROM te."status";

-- Partial index: used by the trackedEntity -> itemLedger sync trigger and
-- by UI paths that drill into rows of a specific tracked entity.
CREATE INDEX IF NOT EXISTS "itemLedger_trackedEntityId_idx"
  ON "itemLedger"("trackedEntityId")
  WHERE "trackedEntityId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Trigger: on itemLedger INSERT / trackedEntityId change, copy status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_item_ledger_tracked_entity_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."trackedEntityId" IS NOT NULL THEN
    SELECT "status" INTO NEW."trackedEntityStatus"
    FROM "trackedEntity"
    WHERE "id" = NEW."trackedEntityId";
  ELSE
    NEW."trackedEntityStatus" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_item_ledger_tracked_entity_status_trigger
  ON "itemLedger";
CREATE TRIGGER set_item_ledger_tracked_entity_status_trigger
  BEFORE INSERT OR UPDATE OF "trackedEntityId" ON "itemLedger"
  FOR EACH ROW
  EXECUTE FUNCTION set_item_ledger_tracked_entity_status();

-- ---------------------------------------------------------------------------
-- 3. Trigger: on trackedEntity.status change, cascade to itemLedger rows
--
-- SECURITY DEFINER is required: itemLedger has no UPDATE RLS policy
-- (see 20240912181702_item-ledger-rls-update.sql), so a non-definer trigger
-- would be silently no-op'd by RLS when the calling user is e.g. quality
-- staff dispositioning a tracked entity.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_item_ledger_on_tracked_entity_status_change()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "itemLedger"
  SET "trackedEntityStatus" = NEW."status"
  WHERE "trackedEntityId" = NEW."id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_item_ledger_on_tracked_entity_status_change_trigger
  ON "trackedEntity";
CREATE TRIGGER sync_item_ledger_on_tracked_entity_status_change_trigger
  AFTER UPDATE OF "status" ON "trackedEntity"
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION sync_item_ledger_on_tracked_entity_status_change();

-- ---------------------------------------------------------------------------
-- 4. Recreate get_inventory_quantities with status-aware on-hand logic
--
-- Changes vs. the previous version (20260331133250_make-method-fixes.sql):
--   - `quantityOnHand` is now filtered: ledger rows whose linked tracked
--     entity is 'On Hold' or 'Rejected' are excluded.
--   - Two new return columns `quantityOnHold` and `quantityRejected`
--     surface the excluded quantities for UI display.
--   - Usage / demand / days-remaining calculations are unchanged.
--   - No JOIN; filter uses the new denormalized `trackedEntityStatus`.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS get_inventory_quantities(TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_inventory_quantities(company_id TEXT, location_id TEXT)
  RETURNS TABLE (
    "id" TEXT,
    "readableId" TEXT,
    "readableIdWithRevision" TEXT,
    "name" TEXT,
    "active" BOOLEAN,
    "type" "itemType",
    "itemTrackingType" "itemTrackingType",
    "replenishmentSystem" "itemReplenishmentSystem",
    "materialSubstanceId" TEXT,
    "materialFormId" TEXT,
    "dimensionId" TEXT,
    "dimension" TEXT,
    "finishId" TEXT,
    "finish" TEXT,
    "gradeId" TEXT,
    "grade" TEXT,
    "materialType" TEXT,
    "materialTypeId" TEXT,
    "thumbnailPath" TEXT,
    "unitOfMeasureCode" TEXT,
    "leadTime" INTEGER,
    "lotSize" INTEGER,
    "reorderingPolicy" "itemReorderingPolicy",
    "demandAccumulationPeriod" INTEGER,
    "demandAccumulationSafetyStock" NUMERIC,
    "reorderPoint" INTEGER,
    "reorderQuantity" INTEGER,
    "minimumOrderQuantity" INTEGER,
    "maximumOrderQuantity" INTEGER,
    "maximumInventoryQuantity" NUMERIC,
    "orderMultiple" INTEGER,
    "quantityOnHand" NUMERIC,
    "quantityOnHold" NUMERIC,
    "quantityRejected" NUMERIC,
    "quantityOnSalesOrder" NUMERIC,
    "quantityOnPurchaseOrder" NUMERIC,
    "quantityOnProductionOrder" NUMERIC,
    "quantityOnProductionDemand" NUMERIC,
    "demandForecast" NUMERIC,
    "usageLast30Days" NUMERIC,
    "usageLast90Days" NUMERIC,
    "daysRemaining" NUMERIC
  ) AS $$
  BEGIN
    RETURN QUERY

WITH
  open_purchase_orders AS (
    SELECT
      pol."itemId",
      SUM(pol."quantityToReceive" * pol."conversionFactor") AS "quantityOnPurchaseOrder"
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
    GROUP BY pol."itemId"
  ),
  open_sales_orders AS (
    SELECT
      sol."itemId",
      SUM(sol."quantityToSend") AS "quantityOnSalesOrder"
    FROM
      "salesOrder" so
      INNER JOIN "salesOrderLine" sol
        ON sol."salesOrderId" = so."id"
    WHERE
      so."status" IN (
        'Confirmed',
        'To Ship and Invoice',
        'To Ship',
        'To Invoice',
        'In Progress'
      )
      AND so."companyId" = company_id
      AND sol."locationId" = location_id
    GROUP BY sol."itemId"
  ),
  open_job_requirements AS (
    SELECT
      jm."itemId",
      SUM(jm."quantityToIssue") AS "quantityOnProductionDemand"
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
    GROUP BY jm."itemId"
  ),
  open_jobs AS (
    SELECT
      j."itemId",
      SUM(j."productionQuantity" + j."scrapQuantity" - j."quantityReceivedToInventory" - j."quantityShipped") AS "quantityOnProductionOrder"
    FROM job j
    WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    GROUP BY j."itemId"
  ),
  item_ledgers AS (
    SELECT
      "itemId",
      -- quantityOnHand excludes only Rejected tracked entities. On Hold
      -- units are still physically in the warehouse and count toward
      -- on-hand. Rows with no tracked entity always count.
      SUM("quantity") FILTER (
        WHERE "trackedEntityStatus" IS NULL
           OR "trackedEntityStatus" != 'Rejected'
      ) AS "quantityOnHand",
      SUM("quantity") FILTER (WHERE "trackedEntityStatus" = 'On Hold')
        AS "quantityOnHold",
      SUM("quantity") FILTER (WHERE "trackedEntityStatus" = 'Rejected')
        AS "quantityRejected",
      SUM(CASE
        WHEN "entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
        AND "createdAt" >= CURRENT_DATE - INTERVAL '30 days'
        THEN -"quantity"
        ELSE 0
      END) / 30 AS "usageLast30Days",
      SUM(CASE
        WHEN "entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
        AND "createdAt" >= CURRENT_DATE - INTERVAL '90 days'
        THEN -"quantity"
        ELSE 0
      END) / 90 AS "usageLast90Days"
    FROM "itemLedger"
    WHERE "companyId" = company_id
      AND "locationId" = location_id
    GROUP BY "itemId"
  ),
  demand_forecast AS (
    SELECT "itemId", SUM(qty) AS "demandForecast"
    FROM (
      SELECT "itemId", "actualQuantity" AS qty
      FROM "demandActual"
      WHERE "companyId" = company_id AND "locationId" = location_id
      UNION ALL
      SELECT "itemId", "forecastQuantity" AS qty
      FROM "demandForecast"
      WHERE "companyId" = company_id AND "locationId" = location_id
    ) combined
    GROUP BY "itemId"
  )

SELECT
  i."id",
  i."readableId",
  i."readableIdWithRevision",
  i."name",
  i."active",
  i."type",
  i."itemTrackingType",
  i."replenishmentSystem",
  m."materialSubstanceId",
  m."materialFormId",
  m."dimensionId",
  md."name" AS "dimension",
  m."finishId",
  mf."name" AS "finish",
  m."gradeId",
  mg."name" AS "grade",
  mt."name" AS "materialType",
  m."materialTypeId",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  ir."leadTime",
  ir."lotSize",
  ip."reorderingPolicy",
  ip."demandAccumulationPeriod",
  ip."demandAccumulationSafetyStock",
  ip."reorderPoint",
  ip."reorderQuantity",
  ip."minimumOrderQuantity",
  ip."maximumOrderQuantity",
  ip."maximumInventoryQuantity",
  ip."orderMultiple",
  COALESCE(il."quantityOnHand", 0) AS "quantityOnHand",
  COALESCE(il."quantityOnHold", 0) AS "quantityOnHold",
  COALESCE(il."quantityRejected", 0) AS "quantityRejected",
  COALESCE(so."quantityOnSalesOrder", 0) AS "quantityOnSalesOrder",
  COALESCE(po."quantityOnPurchaseOrder", 0) AS "quantityOnPurchaseOrder",
  COALESCE(jo."quantityOnProductionOrder", 0) AS "quantityOnProductionOrder",
  COALESCE(jr."quantityOnProductionDemand", 0) AS "quantityOnProductionDemand",
  COALESCE(df."demandForecast", 0) AS "demandForecast",
  COALESCE(il."usageLast30Days", 0) AS "usageLast30Days",
  COALESCE(il."usageLast90Days", 0) AS "usageLast90Days",
  CASE
    WHEN COALESCE(il."usageLast30Days", 0) > 0
    THEN ROUND(COALESCE(il."quantityOnHand", 0) / il."usageLast30Days", 2)
    ELSE NULL
  END AS "daysRemaining"
FROM
  "item" i
  LEFT JOIN item_ledgers il ON i."id" = il."itemId"
  LEFT JOIN open_sales_orders so ON i."id" = so."itemId"
  LEFT JOIN open_purchase_orders po ON i."id" = po."itemId"
  LEFT JOIN open_jobs jo ON i."id" = jo."itemId"
  LEFT JOIN open_job_requirements jr ON i."id" = jr."itemId"
  LEFT JOIN demand_forecast df ON i."id" = df."itemId"
  LEFT JOIN material m ON i."readableId" = m."id" AND m."companyId" = company_id
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "materialDimension" md ON m."dimensionId" = md."id"
  LEFT JOIN "materialFinish" mf ON m."finishId" = mf."id"
  LEFT JOIN "materialGrade" mg ON m."gradeId" = mg."id"
  LEFT JOIN "materialType" mt ON m."materialTypeId" = mt."id"
  LEFT JOIN "itemReplenishment" ir ON i."id" = ir."itemId" AND ir."companyId" = company_id
  LEFT JOIN "itemPlanning" ip ON i."id" = ip."itemId" AND ip."locationId" = location_id
WHERE
  i."itemTrackingType" <> 'Non-Inventory' AND i."companyId" = company_id;
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 5. Recreate itemStockQuantities materialized view with the same filter
--    so the useItems store badge agrees with planning.
-- ---------------------------------------------------------------------------

-- Unschedule existing cron job (references the old matview)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-item-stock-quantities') THEN
    PERFORM cron.unschedule('refresh-item-stock-quantities');
  END IF;
END $$;

DROP MATERIALIZED VIEW IF EXISTS "itemStockQuantities";

CREATE MATERIALIZED VIEW "itemStockQuantities" AS
SELECT
  "itemId",
  "companyId",
  COALESCE("locationId", '') AS "locationId",
  SUM("quantity") FILTER (
    WHERE "trackedEntityStatus" IS NULL
       OR "trackedEntityStatus" != 'Rejected'
  ) AS "quantityOnHand"
FROM "itemLedger"
GROUP BY "itemId", "companyId", COALESCE("locationId", '');

CREATE UNIQUE INDEX "itemStockQuantities_itemId_companyId_locationId_idx"
  ON "itemStockQuantities" ("itemId", "companyId", "locationId");

CREATE INDEX "itemStockQuantities_companyId_idx"
  ON "itemStockQuantities" ("companyId");

SELECT
  cron.schedule(
    'refresh-item-stock-quantities',
    '*/30 * * * *',
    $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY "itemStockQuantities";
    $$
  );

-- ---------------------------------------------------------------------------
-- 6. Recreate get_job_quantity_on_hand so production planning
--    (JobMaterialsTable) sees the same status-aware on-hand. Body copied
--    verbatim from 20260417000300_storage-unit-recreate-dependents.sql with
--    one change: the `item_ledgers` CTE now excludes Rejected tracked
--    entities from the `quantityOnHand` sum.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_job_quantity_on_hand(job_id TEXT, company_id TEXT, location_id TEXT)
  RETURNS TABLE (
    "id" TEXT,
    "jobMaterialItemId" TEXT,
    "jobMakeMethodId" TEXT,
    "itemReadableId" TEXT,
    "name" TEXT,
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "methodType" "methodType",
    "type" "itemType",
    "thumbnailPath" TEXT,
    "unitOfMeasureCode" TEXT,
    "quantityPerParent" NUMERIC,
    "estimatedQuantity" NUMERIC,
    "quantityIssued" NUMERIC,
    "quantityOnHandInStorageUnit" NUMERIC,
    "quantityOnHandNotInStorageUnit" NUMERIC,
    "quantityOnSalesOrder" NUMERIC,
    "quantityOnPurchaseOrder" NUMERIC,
    "quantityOnProductionOrder" NUMERIC,
    "quantityFromProductionOrderInStorageUnit" NUMERIC,
    "quantityFromProductionOrderNotInStorageUnit" NUMERIC,
    "quantityInTransitToStorageUnit" NUMERIC,
    "storageUnitId" TEXT,
    "storageUnitName" TEXT
  ) AS $$
  BEGIN
    RETURN QUERY

WITH
  job_materials AS (
    SELECT
      jm."id",
      jm."itemId",
      jm."jobMakeMethodId",
      jm."description",
      jm."methodType",
      jm."quantity",
      jm."estimatedQuantity",
      jm."quantityIssued",
      jm."storageUnitId"
    FROM
      "jobMaterial" jm
    WHERE
      jm."jobId" = job_id
  ),
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
      SUM(pol."quantityToReceive" * pol."conversionFactor") AS "quantityOnPurchaseOrder"
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
      INNER JOIN job_materials jm
        ON jm."itemId" = pol."itemId"
    WHERE
      po."status" IN (
        'To Receive',
        'To Receive and Invoice'
      )
      AND po."companyId" = company_id
      AND pol."locationId" = location_id
    GROUP BY pol."itemId"
  ),
  open_stock_transfers_to AS (
    SELECT
      stl."itemId",
      stl."toStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnStockTransferTo"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    INNER JOIN job_materials jm ON jm."itemId" = stl."itemId"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    GROUP BY stl."itemId", stl."toStorageUnitId"
  ),
  open_stock_transfers_from AS (
    SELECT
      stl."itemId",
      stl."fromStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnStockTransferFrom"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    INNER JOIN job_materials jm ON jm."itemId" = stl."itemId"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    GROUP BY stl."itemId", stl."fromStorageUnitId"
  ),
  stock_transfers_in_transit AS (
    SELECT
      COALESCE(stt."itemId", stf."itemId") AS "itemId",
      COALESCE(stt."storageUnitId", stf."storageUnitId") AS "storageUnitId",
      COALESCE(stt."quantityOnStockTransferTo", 0) - COALESCE(stf."quantityOnStockTransferFrom", 0) AS "quantityInTransit"
    FROM open_stock_transfers_to stt
    FULL OUTER JOIN open_stock_transfers_from stf ON stt."itemId" = stf."itemId" AND stt."storageUnitId" = stf."storageUnitId"
  ),
  open_sales_orders AS (
    SELECT
      sol."itemId" AS "salesOrderItemId",
      SUM(sol."quantityToSend") AS "quantityOnSalesOrder"
    FROM
      "salesOrder" so
      INNER JOIN "salesOrderLine" sol
        ON sol."salesOrderId" = so."id"
      INNER JOIN job_materials jm
        ON jm."itemId" = sol."itemId"
    WHERE
      so."status" IN (
        'Confirmed',
        'To Ship and Invoice',
        'To Ship',
        'To Invoice',
        'In Progress'
      )
      AND so."companyId" = company_id
      AND sol."locationId" = location_id
    GROUP BY sol."itemId"
  ),
  open_jobs AS (
    SELECT
      j."itemId" AS "jobItemId",
      SUM(j."productionQuantity" + j."scrapQuantity" - j."quantityReceivedToInventory" - j."quantityShipped") AS "quantityOnProductionOrder"
    FROM job j
    WHERE j."status" IN (
      'Ready',
      'In Progress',
      'Paused'
    )
    GROUP BY j."itemId"
  ),
  open_job_requirements AS (
    SELECT
      jm."itemId",
      jm."storageUnitId",
      SUM(jm."quantityToIssue") AS "quantityOnProductionDemand"
    FROM "jobMaterial" jm
    INNER JOIN "job" j ON jm."jobId" = j."id"
    INNER JOIN job_materials jmat
      ON jmat."itemId" = jm."itemId"
    WHERE j."status" IN (
        'Planned',
        'Ready',
        'In Progress',
        'Paused'
      )
    AND jm."methodType" != 'Make to Order'
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    GROUP BY jm."itemId", jm."storageUnitId"
  ),
  open_job_requirements_in_storage_unit AS (
    SELECT
      ojr."itemId",
      SUM(ojr."quantityOnProductionDemand") AS "quantityOnProductionDemandInStorageUnit"
    FROM open_job_requirements ojr
    INNER JOIN job_materials jm
      ON jm."itemId" = ojr."itemId" AND jm."storageUnitId" = ojr."storageUnitId"
    GROUP BY ojr."itemId"
  ),
  open_job_requirements_not_in_storage_unit AS (
    SELECT
      ojr."itemId",
      SUM(ojr."quantityOnProductionDemand") AS "quantityOnProductionDemandNotInStorageUnit"
    FROM open_job_requirements ojr
    INNER JOIN job_materials jm
      ON jm."itemId" = ojr."itemId" AND (jm."storageUnitId" IS NULL OR jm."storageUnitId" != ojr."storageUnitId")
    GROUP BY ojr."itemId"
  ),
  item_ledgers AS (
    SELECT
      il."itemId" AS "ledgerItemId",
      il."storageUnitId",
      -- quantityOnHand excludes only Rejected tracked entities. On Hold
      -- units are still physically in the warehouse and count toward
      -- on-hand. Rows with no tracked entity always count.
      SUM(il."quantity") FILTER (
        WHERE il."trackedEntityStatus" IS NULL
           OR il."trackedEntityStatus" != 'Rejected'
      ) AS "quantityOnHand"
    FROM "itemLedger" il
    INNER JOIN job_materials jm
      ON jm."itemId" = il."itemId"
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
    GROUP BY il."itemId", il."storageUnitId"
  ),
  item_ledgers_in_storage_unit AS (
    SELECT
      il."ledgerItemId",
      SUM(il."quantityOnHand") AS "quantityOnHandInStorageUnit"
    FROM item_ledgers il
    INNER JOIN job_materials jm
      ON jm."itemId" = il."ledgerItemId" AND jm."storageUnitId" = il."storageUnitId"
    GROUP BY il."ledgerItemId"
  ),
  item_ledgers_not_in_storage_unit AS (
    SELECT
      il."ledgerItemId",
      SUM(il."quantityOnHand") AS "quantityOnHandNotInStorageUnit"
    FROM item_ledgers il
    INNER JOIN job_materials jm
      ON jm."itemId" = il."ledgerItemId" AND (jm."storageUnitId" IS NULL OR jm."storageUnitId" != il."storageUnitId")
    GROUP BY il."ledgerItemId"
  )

SELECT
  jm."id",
  jm."itemId" AS "jobMaterialItemId",
  jm."jobMakeMethodId",
  i."readableId" AS "itemReadableId",
  i."name",
  jm."description",
  i."itemTrackingType",
  jm."methodType",
  i."type",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  jm."quantity" as "quantityPerParent",
  jm."estimatedQuantity",
  jm."quantityIssued",
  COALESCE(ils."quantityOnHandInStorageUnit", 0) AS "quantityOnHandInStorageUnit",
  COALESCE(ilns."quantityOnHandNotInStorageUnit", 0) AS "quantityOnHandNotInStorageUnit",
  COALESCE(so."quantityOnSalesOrder", 0) AS "quantityOnSalesOrder",
  COALESCE(po."quantityOnPurchaseOrder", 0) AS "quantityOnPurchaseOrder",
  COALESCE(oj."quantityOnProductionOrder", 0) AS "quantityOnProductionOrder",
  COALESCE(ojis."quantityOnProductionDemandInStorageUnit", 0) AS "quantityFromProductionOrderInStorageUnit",
  COALESCE(ojns."quantityOnProductionDemandNotInStorageUnit", 0) AS "quantityFromProductionOrderNotInStorageUnit",
  COALESCE(stit."quantityInTransit", 0) AS "quantityInTransitToStorageUnit",
  jm."storageUnitId",
  s."name" AS "storageUnitName"
FROM
  job_materials jm
  INNER JOIN "item" i ON i."id" = jm."itemId"
  LEFT JOIN "storageUnit" s ON s."id" = jm."storageUnitId"
  LEFT JOIN item_ledgers_in_storage_unit ils ON i."id" = ils."ledgerItemId"
  LEFT JOIN item_ledgers_not_in_storage_unit ilns ON i."id" = ilns."ledgerItemId"
  LEFT JOIN open_sales_orders so ON i."id" = so."salesOrderItemId"
  LEFT JOIN open_purchase_orders po ON i."id" = po."purchaseOrderItemId"
  LEFT JOIN open_jobs oj ON i."id" = oj."jobItemId"
  LEFT JOIN open_job_requirements_in_storage_unit ojis ON i."id" = ojis."itemId"
  LEFT JOIN open_job_requirements_not_in_storage_unit ojns ON i."id" = ojns."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN stock_transfers_in_transit stit ON jm."itemId" = stit."itemId" AND jm."storageUnitId" = stit."storageUnitId";
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
