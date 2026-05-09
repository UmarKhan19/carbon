-- Migration to change purchaseInvoiceStatus enum value from "Submitted" to "Open"
-- Following the temporary text column pattern used for maintenanceSeverity

-- Step 1: Drop the view that depends on the purchaseInvoice status
DROP VIEW IF EXISTS "purchaseInvoices";

-- Step 2: Add temporary TEXT columns to store current values
ALTER TABLE "purchaseInvoice" ADD COLUMN "status_temp" TEXT;
ALTER TABLE "purchaseInvoiceStatusHistory" ADD COLUMN "status_temp" TEXT;

-- Step 3: Copy existing values to temporary columns
UPDATE "purchaseInvoice" SET "status_temp" = "status"::TEXT;
UPDATE "purchaseInvoiceStatusHistory" SET "status_temp" = "status"::TEXT;

-- Step 4: Drop the status columns
ALTER TABLE "purchaseInvoice" DROP COLUMN "status";
ALTER TABLE "purchaseInvoiceStatusHistory" DROP COLUMN "status";

-- Step 5: Drop the old enum type
DROP TYPE IF EXISTS "purchaseInvoiceStatus";

-- Step 6: Create the new enum type with "Open" instead of "Submitted"
CREATE TYPE "purchaseInvoiceStatus" AS ENUM (
  'Draft',
  'Pending',
  'Open',
  'Return',
  'Debit Note Issued',
  'Paid',
  'Partially Paid',
  'Overdue',
  'Voided'
);

-- Step 7: Add the status columns back with the new enum type
ALTER TABLE "purchaseInvoice" ADD COLUMN "status" "purchaseInvoiceStatus";
ALTER TABLE "purchaseInvoiceStatusHistory" ADD COLUMN "status" "purchaseInvoiceStatus";

-- Step 8: Update the new columns, mapping "Submitted" to "Open"
UPDATE "purchaseInvoice" SET "status" =
  CASE
    WHEN "status_temp" = 'Submitted' THEN 'Open'::"purchaseInvoiceStatus"
    ELSE "status_temp"::"purchaseInvoiceStatus"
  END;

UPDATE "purchaseInvoiceStatusHistory" SET "status" =
  CASE
    WHEN "status_temp" = 'Submitted' THEN 'Open'::"purchaseInvoiceStatus"
    ELSE "status_temp"::"purchaseInvoiceStatus"
  END;

-- Step 9: Make the columns NOT NULL and set default for purchaseInvoice
ALTER TABLE "purchaseInvoice" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "purchaseInvoice" ALTER COLUMN "status" SET DEFAULT 'Draft';
ALTER TABLE "purchaseInvoiceStatusHistory" ALTER COLUMN "status" SET NOT NULL;

-- Step 10: Drop the temporary columns
ALTER TABLE "purchaseInvoice" DROP COLUMN "status_temp";
ALTER TABLE "purchaseInvoiceStatusHistory" DROP COLUMN "status_temp";

-- Step 11: Recreate the purchaseInvoices view
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
    pl."orderTotal" + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END AS "orderTotal",
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
