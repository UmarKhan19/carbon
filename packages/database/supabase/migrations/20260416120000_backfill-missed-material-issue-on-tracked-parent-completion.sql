-- Backfill missed material auto-issue for operations whose parent output is Serial/Batch tracked.
--
-- Before 20260416, the jobOperationBatchComplete and jobOperationSerialComplete handlers in
-- functions/issue/index.ts skipped the jobMaterial backflush logic that the plain jobOperation
-- handler ran. Completing a serial or batch parent therefore left child materials with
-- quantityIssued = 0 and no itemLedger consumption entries.
--
-- This migration is idempotent and recovers regardless of current DB state by driving
-- each target independently toward its expected value:
--   itemLedger total consumption for (jobId, jobOperationId, itemId)
--     should equal -(SUM over materials of material.quantity × completedQuantity)
--   jobMaterial.quantityIssued for each material
--     should equal material.quantity × completedQuantity
-- Each statement only fills the shortfall, so re-running is a no-op.
-- Kitted (kit = true) Make to Order children's materials are included, matching the runtime helper.

-- =========================================================================================
-- Statement 1: Insert missing itemLedger Consumption rows for Inventory-tracked materials.
-- =========================================================================================

WITH
  affected_operations AS (
    SELECT
      jo.id                  AS "jobOperationId",
      jo."jobId",
      j."locationId",
      j."companyId",
      SUM(pq.quantity)       AS "completedQuantity"
    FROM "jobOperation" jo
    JOIN "jobMakeMethod" jmm ON jmm.id = jo."jobMakeMethodId"
    JOIN "item" parent       ON parent.id = jmm."itemId"
    JOIN "job" j             ON j.id = jo."jobId"
    JOIN "productionQuantity" pq
      ON pq."jobOperationId" = jo.id
     AND pq.type = 'Production'
    WHERE parent."itemTrackingType" IN ('Serial', 'Batch')
      AND j."locationId" IS NOT NULL
    GROUP BY jo.id, jo."jobId", j."locationId", j."companyId"
    HAVING SUM(pq.quantity) > 0
  ),

  direct_materials AS (
    SELECT
      jm.id,
      jm."itemId",
      jm."jobId",
      ao."jobOperationId",
      jm.quantity,
      jm."quantityIssued",
      jm."shelfId"           AS "materialShelfId",
      jm."defaultShelf",
      ao."completedQuantity",
      ao."locationId",
      ao."companyId"
    FROM "jobMaterial" jm
    JOIN affected_operations ao ON ao."jobOperationId" = jm."jobOperationId"
    WHERE jm."itemType" IN ('Material', 'Part', 'Consumable')
      AND jm."methodType" != 'Make to Order'
      AND jm."estimatedQuantity" > 0
      AND jm."requiresBatchTracking" = false
      AND jm."requiresSerialTracking" = false
  ),

  kitted_child_methods AS (
    SELECT
      jmm.id                 AS "childMakeMethodId",
      ao."jobOperationId",
      ao."completedQuantity",
      ao."locationId",
      ao."companyId"
    FROM "jobMaterial" jm
    JOIN affected_operations ao ON ao."jobOperationId" = jm."jobOperationId"
    JOIN "jobMakeMethod" jmm    ON jmm."parentMaterialId" = jm.id
    WHERE jm."itemType" IN ('Material', 'Part', 'Consumable')
      AND jm."methodType" = 'Make to Order'
      AND jm.kit = true
  ),

  kitted_materials AS (
    SELECT
      jm.id,
      jm."itemId",
      jm."jobId",
      kcm."jobOperationId",
      jm.quantity,
      jm."quantityIssued",
      jm."shelfId"           AS "materialShelfId",
      jm."defaultShelf",
      kcm."completedQuantity",
      kcm."locationId",
      kcm."companyId"
    FROM "jobMaterial" jm
    JOIN kitted_child_methods kcm ON kcm."childMakeMethodId" = jm."jobMakeMethodId"
    WHERE jm."itemType" IN ('Material', 'Part', 'Consumable')
      AND jm."methodType" != 'Make to Order'
      AND jm."estimatedQuantity" > 0
      AND jm."requiresBatchTracking" = false
      AND jm."requiresSerialTracking" = false
  ),

  all_materials AS (
    SELECT * FROM direct_materials
    UNION ALL
    SELECT * FROM kitted_materials
  ),

  -- itemLedger has no per-material key, so collapse to (jobId, jobOperationId, itemId).
  aggregated AS (
    SELECT
      m."jobId",
      m."jobOperationId",
      m."itemId",
      m."locationId",
      m."companyId",
      SUM(m.quantity * m."completedQuantity")   AS "expectedIssued",
      MIN(m."materialShelfId") FILTER (WHERE m."materialShelfId" IS NOT NULL)
                                                AS "materialShelfId",
      BOOL_OR(m."defaultShelf")                 AS "defaultShelf"
    FROM all_materials m
    GROUP BY m."jobId", m."jobOperationId", m."itemId", m."locationId", m."companyId"
  ),

  ledger_shortfalls AS (
    SELECT
      a.*,
      i."itemTrackingType",
      COALESCE((
        SELECT SUM(il.quantity)
        FROM "itemLedger" il
        WHERE il."itemId" = a."itemId"
          AND il."entryType" = 'Consumption'
          AND il."documentType" = 'Job Consumption'
          AND il."documentId" = a."jobId"
          AND il."documentLineId" = a."jobOperationId"
      ), 0) AS "existingLedgerQty"
    FROM aggregated a
    JOIN "item" i ON i.id = a."itemId"
  ),

  needs_ledger AS (
    SELECT
      s.*,
      (-s."expectedIssued" - s."existingLedgerQty") AS "missingQty"
    FROM ledger_shortfalls s
    WHERE s."itemTrackingType" = 'Inventory'
      AND (-s."expectedIssued" - s."existingLedgerQty") < 0
  ),

  ledger_resolved AS (
    SELECT
      n.*,
      COALESCE(
        n."materialShelfId",
        pm."defaultShelfId",
        (
          SELECT il."shelfId"
          FROM "itemLedger" il
          WHERE il."itemId" = n."itemId"
            AND il."locationId" = n."locationId"
            AND il."shelfId" IS NOT NULL
          GROUP BY il."shelfId"
          HAVING SUM(il.quantity) > 0
          ORDER BY SUM(il.quantity) DESC
          LIMIT 1
        )
      ) AS "resolvedShelfId"
    FROM needs_ledger n
    LEFT JOIN "pickMethod" pm
      ON pm."itemId" = n."itemId"
     AND pm."locationId" = n."locationId"
     AND pm."companyId" = n."companyId"
  )

INSERT INTO "itemLedger" (
  "entryType", "documentType", "documentId", "documentLineId",
  "companyId", "itemId", quantity, "locationId", "shelfId", "createdBy"
)
SELECT
  'Consumption',
  'Job Consumption',
  r."jobId",
  r."jobOperationId",
  r."companyId",
  r."itemId",
  r."missingQty",
  r."locationId",
  r."resolvedShelfId",
  'system'
FROM ledger_resolved r;

-- =========================================================================================
-- Statement 2: Close jobMaterial.quantityIssued deficit to match expected issuance.
-- =========================================================================================

WITH
  affected_operations AS (
    SELECT
      jo.id                  AS "jobOperationId",
      SUM(pq.quantity)       AS "completedQuantity"
    FROM "jobOperation" jo
    JOIN "jobMakeMethod" jmm ON jmm.id = jo."jobMakeMethodId"
    JOIN "item" parent       ON parent.id = jmm."itemId"
    JOIN "job" j             ON j.id = jo."jobId"
    JOIN "productionQuantity" pq
      ON pq."jobOperationId" = jo.id
     AND pq.type = 'Production'
    WHERE parent."itemTrackingType" IN ('Serial', 'Batch')
      AND j."locationId" IS NOT NULL
    GROUP BY jo.id
    HAVING SUM(pq.quantity) > 0
  ),

  direct_deficits AS (
    SELECT
      jm.id,
      (jm.quantity * ao."completedQuantity" - jm."quantityIssued") AS deficit
    FROM "jobMaterial" jm
    JOIN affected_operations ao ON ao."jobOperationId" = jm."jobOperationId"
    WHERE jm."itemType" IN ('Material', 'Part', 'Consumable')
      AND jm."methodType" != 'Make to Order'
      AND jm."estimatedQuantity" > 0
      AND jm."requiresBatchTracking" = false
      AND jm."requiresSerialTracking" = false
      AND (jm.quantity * ao."completedQuantity" - jm."quantityIssued") > 0
  ),

  kitted_child_methods AS (
    SELECT
      jmm.id                 AS "childMakeMethodId",
      ao."completedQuantity"
    FROM "jobMaterial" jm
    JOIN affected_operations ao ON ao."jobOperationId" = jm."jobOperationId"
    JOIN "jobMakeMethod" jmm    ON jmm."parentMaterialId" = jm.id
    WHERE jm."itemType" IN ('Material', 'Part', 'Consumable')
      AND jm."methodType" = 'Make to Order'
      AND jm.kit = true
  ),

  kitted_deficits AS (
    SELECT
      jm.id,
      (jm.quantity * kcm."completedQuantity" - jm."quantityIssued") AS deficit
    FROM "jobMaterial" jm
    JOIN kitted_child_methods kcm ON kcm."childMakeMethodId" = jm."jobMakeMethodId"
    WHERE jm."itemType" IN ('Material', 'Part', 'Consumable')
      AND jm."methodType" != 'Make to Order'
      AND jm."estimatedQuantity" > 0
      AND jm."requiresBatchTracking" = false
      AND jm."requiresSerialTracking" = false
      AND (jm.quantity * kcm."completedQuantity" - jm."quantityIssued") > 0
  ),

  all_deficits AS (
    SELECT * FROM direct_deficits
    UNION ALL
    SELECT * FROM kitted_deficits
  )

UPDATE "jobMaterial" jm
SET "quantityIssued" = jm."quantityIssued" + d.deficit
FROM all_deficits d
WHERE jm.id = d.id;
