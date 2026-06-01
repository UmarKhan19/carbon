-- MRP-generated purchase orders skip the approval workflow. Flag the origin so
-- `finalize` can bypass `isApprovalRequired` for system-suggested replenishment
-- orders, and re-arm approval the moment a user edits the order.
ALTER TABLE "purchaseOrder"
  ADD COLUMN "mrpGenerated" BOOLEAN NOT NULL DEFAULT FALSE;

-- The `purchaseOrders` view selects `p.*`, which Postgres snapshots at creation
-- time, so it must be re-created to expose the new column. Definition copied from
-- 20260525120000_po-pdf-buyer-and-optional-state.sql.
DROP VIEW IF EXISTS "purchaseOrders";
CREATE OR REPLACE VIEW "purchaseOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    pl."thumbnailPath",
    pl."itemType",
    pl."orderTotal" + pd."supplierShippingCost" * p."exchangeRate" AS "orderTotal",
    pd."shippingMethodId",
    pd."shippingTermId",
    pd."receiptRequestedDate",
    pd."receiptPromisedDate",
    pd."deliveryDate",
    pd."dropShipment",
    pp."paymentTermId",
    pd."locationId",
    pd."supplierShippingCost",
    pd."incoterm",
    pd."incotermLocation",
    u."fullName"   AS "createdByFullName",
    u."email"      AS "createdByEmail",
    u."phone"      AS "createdByPhone",
    ua."fullName"  AS "assigneeFullName",
    ua."email"     AS "assigneeEmail",
    ua."phone"     AS "assigneePhone",
    uam."fullName" AS "accountManagerFullName",
    uam."email"    AS "accountManagerEmail",
    uam."phone"    AS "accountManagerPhone"
  FROM "purchaseOrder" p
  LEFT JOIN (
    SELECT
      pol."purchaseOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(COALESCE(pol."purchaseQuantity", 0)*(COALESCE(pol."unitPrice", 0)) + COALESCE(pol."shippingCost", 0) + COALESCE(pol."taxAmount", 0)) AS "orderTotal",
      MIN(i."type") AS "itemType"
    FROM "purchaseOrderLine" pol
    LEFT JOIN "item" i
      ON i."id" = pol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY pol."purchaseOrderId"
  ) pl ON pl."purchaseOrderId" = p."id"
  LEFT JOIN "purchaseOrderDelivery" pd ON pd."id" = p."id"
  LEFT JOIN "shippingTerm" st ON st."id" = pd."shippingTermId"
  LEFT JOIN "purchaseOrderPayment" pp ON pp."id" = p."id"
  LEFT JOIN "user" u   ON u."id"   = p."createdBy"
  LEFT JOIN "user" ua  ON ua."id"  = p."assignee"
  LEFT JOIN "supplier" s ON s."id" = p."supplierId"
  LEFT JOIN "user" uam ON uam."id" = s."accountManagerId";
