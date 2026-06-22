-- ============================================================
-- Invoice status + balance derived from paymentApplication
--
-- Today `balance` is a cached NUMERIC column on salesInvoice and
-- purchaseInvoice that is never decremented by anything, and the
-- `Paid` / `Partially Paid` status values are set by hand via
-- updateSalesInvoiceStatus / updatePurchaseInvoiceStatus. The
-- payment + paymentApplication tables (added in 20260519120000)
-- now make this derivable: a Posted payment's applications sum
-- exactly equals the AR/AP reduction. This migration drops the
-- cached column and recomputes balance + status in the views.
--
-- Precedence in the status CASE (Paid > Overdue): a paid invoice
-- can never be overdue.
-- ============================================================


-- ============================================================
-- Phase 1: Drop the existing views (they project `balance` from
-- the base table)
-- ============================================================

DROP VIEW IF EXISTS "salesInvoices";
DROP VIEW IF EXISTS "purchaseInvoices";


-- ============================================================
-- Phase 2: Drop the cached `balance` column from the base tables
-- ============================================================
-- The views were the only consumers in apps/erp; they're recreated
-- below with a derived balance. The convert edge function and the
-- packages/ee Xero sync providers (bill.ts / invoice.ts) also
-- touched the base column directly and were updated alongside this
-- migration to insert without it / read it from the views.

ALTER TABLE "salesInvoice" DROP COLUMN IF EXISTS "balance";
ALTER TABLE "purchaseInvoice" DROP COLUMN IF EXISTS "balance";


-- ============================================================
-- Phase 3: Recreate purchaseInvoices view with derived
-- balance + status
-- ============================================================
-- Active state for purchase invoices is 'Open' (renamed from
-- 'Submitted' in 20260422004200).

CREATE OR REPLACE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT
      pa."purchaseInvoiceId",
      SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount") AS amount
    FROM "paymentApplication" pa
    JOIN "payment" p ON p."id" = pa."paymentId"
    WHERE p."status" = 'Posted' AND pa."purchaseInvoiceId" IS NOT NULL
    GROUP BY pa."purchaseInvoiceId"
  )
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
    (pi."totalAmount" - COALESCE(s.amount, 0)) AS "balance",
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
      WHEN pi."status" IN ('Draft','Pending','Voided','Return','Debit Note Issued') THEN pi."status"::TEXT
      WHEN COALESCE(s.amount, 0) >= pi."totalAmount" AND pi."totalAmount" > 0 THEN 'Paid'
      WHEN COALESCE(s.amount, 0) > 0 THEN 'Partially Paid'
      WHEN pi."dateDue" < CURRENT_DATE AND pi."status" = 'Open' THEN 'Overdue'
      ELSE pi."status"::TEXT
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
  LEFT JOIN "purchaseInvoiceDelivery" pid ON pid."id" = pi."id"
  LEFT JOIN settled s ON s."purchaseInvoiceId" = pi."id";


-- ============================================================
-- Phase 4: Recreate salesInvoices view with derived
-- balance + status
-- ============================================================
-- Active state for sales invoices is 'Submitted'.
-- The base salesInvoice has a `tags` column; preserve it.

CREATE OR REPLACE VIEW "salesInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT
      pa."salesInvoiceId",
      SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount") AS amount
    FROM "paymentApplication" pa
    JOIN "payment" p ON p."id" = pa."paymentId"
    WHERE p."status" = 'Posted' AND pa."salesInvoiceId" IS NOT NULL
    GROUP BY pa."salesInvoiceId"
  )
  SELECT
    si."id",
    si."invoiceId",
    si."customerId",
    si."customerReference",
    si."invoiceCustomerId",
    si."invoiceCustomerLocationId",
    si."invoiceCustomerContactId",
    si."paymentTermId",
    si."postingDate",
    si."dateIssued",
    si."dateDue",
    si."datePaid",
    si."locationId",
    si."currencyCode",
    si."subtotal",
    si."totalDiscount",
    si."totalAmount",
    si."totalTax",
    (si."totalAmount" - COALESCE(s.amount, 0)) AS "balance",
    si."exchangeRate",
    si."exchangeRateUpdatedAt",
    si."opportunityId",
    si."shipmentId",
    si."assignee",
    si."companyId",
    si."customFields",
    si."internalNotes",
    si."externalNotes",
    si."tags",
    si."createdAt",
    si."createdBy",
    si."updatedAt",
    si."updatedBy",
    sil."thumbnailPath",
    sil."itemType",
    sil."invoiceTotal" + COALESCE(ss."shippingCost", 0) AS "invoiceTotal",
    sil."lines",
    CASE
      WHEN si."status" IN ('Draft','Pending','Voided','Return','Credit Note Issued') THEN si."status"::TEXT
      WHEN COALESCE(s.amount, 0) >= si."totalAmount" AND si."totalAmount" > 0 THEN 'Paid'
      WHEN COALESCE(s.amount, 0) > 0 THEN 'Partially Paid'
      WHEN si."dateDue" < CURRENT_DATE AND si."status" = 'Submitted' THEN 'Overdue'
      ELSE si."status"::TEXT
    END AS status
  FROM "salesInvoice" si
  LEFT JOIN (
    SELECT
      sil."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        DISTINCT (1+COALESCE(sil."taxPercent", 0))*(COALESCE(sil."quantity", 0)*(COALESCE(sil."unitPrice", 0)) + COALESCE(sil."shippingCost", 0) + COALESCE(sil."addOnCost", 0)) + COALESCE(sil."nonTaxableAddOnCost", 0)
      ) AS "invoiceTotal",
      SUM(COALESCE(sil."shippingCost", 0)) AS "shippingCost",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        json_build_object(
          'id', sil.id,
          'invoiceLineType', sil."invoiceLineType",
          'quantity', sil."quantity",
          'unitPrice', sil."unitPrice",
          'itemId', sil."itemId"
        )
      ) AS "lines"
    FROM "salesInvoiceLine" sil
    LEFT JOIN "item" i
      ON i."id" = sil."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY sil."invoiceId"
  ) sil ON sil."invoiceId" = si."id"
  JOIN "salesInvoiceShipment" ss ON ss."id" = si."id"
  LEFT JOIN settled s ON s."salesInvoiceId" = si."id";
