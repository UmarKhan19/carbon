-- Fix typo in update_purchase_invoice_line_price_exchange_rate trigger function where it tried to update purchaseInvoiceLine using column purchaseInvoiceId instead of invoiceId
CREATE OR REPLACE FUNCTION update_purchase_invoice_line_price_exchange_rate()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "purchaseInvoiceLine"
  SET "exchangeRate" = NEW."exchangeRate",
      "updatedBy" = COALESCE(NEW."updatedBy", 'system'),
      "updatedAt" = NOW()
  WHERE "invoiceId" = NEW."id";
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix existing purchaseInvoiceLine records that were not updated due to the trigger bug.
-- NOTE: updatedBy must be set to avoid NOT NULL violation in the purchaseInvoicePriceChange
-- event interceptor (sync_purchase_invoice_line_price_change) which fires on unitPrice change.
UPDATE "purchaseInvoiceLine" pl
SET "exchangeRate" = pi."exchangeRate",
    "updatedBy" = COALESCE(pi."updatedBy", 'system'),
    "updatedAt" = NOW()
FROM "purchaseInvoice" pi
WHERE pl."invoiceId" = pi."id" AND (pl."exchangeRate" IS DISTINCT FROM pi."exchangeRate" OR pl."exchangeRate" IS NULL);

-- Add a BEFORE INSERT trigger to ensure new lines always inherit the parent's exchange rate
-- This prevents lines from being stuck at exchangeRate = 1 if the client fails to pass it correctly.
CREATE OR REPLACE FUNCTION sync_purchase_invoice_line_exchange_rate_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."exchangeRate" IS NULL OR NEW."exchangeRate" = 1 THEN
    SELECT "exchangeRate" INTO NEW."exchangeRate"
    FROM "purchaseInvoice"
    WHERE "id" = NEW."invoiceId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS purchase_invoice_line_exchange_rate_insert_trigger ON "purchaseInvoiceLine";
CREATE TRIGGER purchase_invoice_line_exchange_rate_insert_trigger
BEFORE INSERT ON "purchaseInvoiceLine"
FOR EACH ROW
EXECUTE FUNCTION sync_purchase_invoice_line_exchange_rate_on_insert();

-- Fix purchaseOrders and purchaseInvoices views to correctly divide supplierShippingCost by exchangeRate instead of multiplying
-- to convert it from supplier currency to company base currency (USD)

DROP VIEW IF EXISTS "purchaseOrders";
CREATE OR REPLACE VIEW "purchaseOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    pl."thumbnailPath",
    pl."itemType", 
    pl."orderTotal" + pd."supplierShippingCost" / CASE WHEN p."exchangeRate" = 0 THEN 1 ELSE p."exchangeRate" END AS "orderTotal",
    pd."shippingMethodId",
    pd."shippingTermId",
    pd."receiptRequestedDate",
    pd."receiptPromisedDate",
    pd."deliveryDate",
    pd."dropShipment",
    pp."paymentTermId",
    pd."locationId",
    pd."supplierShippingCost"
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
  LEFT JOIN "purchaseOrderPayment" pp ON pp."id" = p."id";


DROP VIEW IF EXISTS "purchaseInvoices";
CREATE OR REPLACE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS
  SELECT
    pi."id",
    pi."invoiceId",
    pi."supplierId",
    pi."invoiceSupplierId",
    pi."supplierInteractionId",
    pi."supplierReference",
    pi."invoiceSupplierContactId",
    pi."invoiceSupplierLocationId",
    pi."locationId",
    pi."postingDate",
    pi."dateIssued",
    pi."dateDue",
    pi."datePaid",
    pi."paymentTermId",
    pi."currencyCode",
    pi."exchangeRate",
    pi."exchangeRateUpdatedAt",
    pi."subtotal",
    pi."totalDiscount",
    pi."totalAmount",
    pi."totalTax",
    pi."balance",
    pi."assignee",
    pi."createdBy",
    pi."createdAt",
    pi."updatedBy",
    pi."updatedAt",
    pi."internalNotes",
    pi."customFields",
    pi."companyId",
    pl."thumbnailPath",
    pl."itemType",
    pl."orderTotal" + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END AS "orderTotal",
    CASE
      WHEN pi."dateDue" < CURRENT_DATE AND pi."datePaid" IS NULL THEN 'Overdue'
      ELSE pi."status"
    END AS status,
    pt."name" AS "paymentTermName"
  FROM "purchaseInvoice" pi
  LEFT JOIN (
    SELECT
      pol."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(COALESCE(pol."quantity", 0)*(COALESCE(pol."unitPrice", 0)) + COALESCE(pol."shippingCost", 0) + COALESCE(pol."taxAmount", 0)) AS "orderTotal",
      MIN(i."type") AS "itemType"
    FROM "purchaseInvoiceLine" pol
    LEFT JOIN "item" i
      ON i."id" = pol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY pol."invoiceId"
  ) pl ON pl."invoiceId" = pi."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = pi."paymentTermId"
  LEFT JOIN "purchaseInvoiceDelivery" pid ON pid."id" = pi."id";
