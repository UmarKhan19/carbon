-- Issue #448: make "In Progress" a real, filterable status on the salesOrders view.
-- "In Progress" was previously only computed in SalesStatus.tsx, so the DB never
-- had any row with that status and the filter could not match anything.
-- This rewrites the view to override the forwarded s.status with a CASE expression
-- that returns 'In Progress' when the order has any unfinished Make-to-Order line
-- (and is not Closed/Cancelled), mirroring hasIncompleteJobs() in packages/utils.

DROP VIEW IF EXISTS "salesOrders";
CREATE OR REPLACE VIEW "salesOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s."id",
    s."salesOrderId",
    s."revisionId",
    s."orderDate",
    s."customerId",
    s."customerLocationId",
    s."customerContactId",
    s."customerEngineeringContactId",
    s."customerReference",
    s."currencyCode",
    s."exchangeRate",
    s."exchangeRateUpdatedAt",
    s."assignee",
    s."salesPersonId",
    s."opportunityId",
    s."locationId",
    s."companyId",
    s."closedAt",
    s."closedBy",
    s."completedDate",
    s."sentCompleteDate",
    s."customFields",
    s."internalNotes",
    s."externalNotes",
    s."createdAt",
    s."createdBy",
    s."updatedAt",
    s."updatedBy",
    CASE
      WHEN s."status" NOT IN ('Closed', 'Cancelled')
       AND EXISTS (
         SELECT 1
         FROM "salesOrderLine" sol
         WHERE sol."salesOrderId" = s."id"
           AND sol."methodType" = 'Make to Order'
           AND COALESCE((
             SELECT SUM(j."quantityComplete")
             FROM "job" j
             WHERE j."salesOrderLineId" = sol."id"
               AND j."salesOrderId"     = sol."salesOrderId"
           ), 0) < sol."saleQuantity"
       )
      THEN 'In Progress'::"salesOrderStatus"
      ELSE s."status"
    END AS "status",
    sl."thumbnailPath",
    sl."itemType",
    sl."orderTotal" + COALESCE(ss."shippingCost", 0) AS "orderTotal",
    sl."jobs",
    sl."lines",
    st."name" AS "shippingTermName",
    sp."paymentTermId",
    ss."shippingMethodId",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    ss."shippingCost",
    ss."incoterm",
    ss."incotermLocation",
    (
      SELECT COALESCE(
        jsonb_object_agg(
          eim."integration",
          CASE
            WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
            ELSE to_jsonb(eim."externalId")
          END
        ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
        '{}'::jsonb
      )
      FROM "externalIntegrationMapping" eim
      WHERE eim."entityType" = 'salesOrder' AND eim."entityId" = s."id"
    ) AS "externalId"
  FROM "salesOrder" s
  LEFT JOIN (
    SELECT
      sol."salesOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        DISTINCT (1+COALESCE(sol."taxPercent", 0))*(COALESCE(sol."saleQuantity", 0)*(COALESCE(sol."unitPrice", 0)) + COALESCE(sol."shippingCost", 0) + COALESCE(sol."addOnCost", 0)) + COALESCE(sol."nonTaxableAddOnCost", 0)
      ) AS "orderTotal",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        CASE
          WHEN j.id IS NOT NULL THEN json_build_object(
            'id', j.id,
            'jobId', j."jobId",
            'status', j."status",
            'dueDate', j."dueDate",
            'productionQuantity', j."productionQuantity",
            'quantityComplete', j."quantityComplete",
            'quantityShipped', j."quantityShipped",
            'quantity', j."quantity",
            'scrapQuantity', j."scrapQuantity",
            'salesOrderLineId', sol.id,
            'assignee', j."assignee"
          )
          ELSE NULL
        END
      ) FILTER (WHERE j.id IS NOT NULL) AS "jobs",
      ARRAY_AGG(
        json_build_object(
          'id', sol.id,
          'methodType', sol."methodType",
          'saleQuantity', sol."saleQuantity"
        )
      ) AS "lines"
    FROM "salesOrderLine" sol
    LEFT JOIN "item" i
      ON i."id" = sol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    LEFT JOIN "job" j ON j."salesOrderId" = sol."salesOrderId" AND j."salesOrderLineId" = sol."id"
    GROUP BY sol."salesOrderId"
  ) sl ON sl."salesOrderId" = s."id"
  LEFT JOIN "salesOrderShipment" ss ON ss."id" = s."id"
  LEFT JOIN "shippingTerm" st ON st."id" = ss."shippingTermId"
  LEFT JOIN "salesOrderPayment" sp ON sp."id" = s."id";
