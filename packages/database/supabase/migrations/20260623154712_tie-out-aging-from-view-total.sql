-- ============================================================
-- Fix: tie-out + aging RPCs must read the LIVE invoice total
--
-- Migration 20260604120000 deprecated the stored
-- salesInvoice/purchaseInvoice."totalAmount" columns (the recompute
-- interceptors were dropped) and moved totals into the views. The
-- balance + 'Paid' status were repointed at the live line total in
-- 20260623151204, but the AR/AP tie-out and aging RPCs still read the
-- now-unmaintained STORED base "totalAmount". For invoices posted after
-- that change the stored column is 0, so:
--   - get_ar_tie_out shows a phantom variance (GL has the $, subledger
--     reads 0), which would spuriously trigger "Create adjusting entry".
--   - get_ar_aging undercounts the open balance for those invoices.
--
-- The salesInvoices / purchaseInvoices views already expose the
-- authoritative live total as "totalAmount". Point all six RPCs at the
-- views instead of the base tables so "totalAmount" becomes the live
-- total. Every other column referenced (id, exchangeRate, companyId,
-- postingDate, status, customerId/supplierId, invoiceId, dateDue,
-- currencyCode, dateIssued) is exposed identically by the views, and the
-- views do not drop rows (salesInvoices INNER JOINs salesInvoiceShipment,
-- which every sales invoice has; purchaseInvoices LEFT JOINs). The view's
-- derived "status" passes Draft/Pending/Voided through unchanged, so the
-- NOT IN ('Draft','Pending','Voided') filter selects the same row set.
-- No formula, currency, settled, bucket, or signature change — only the
-- FROM source.
-- ============================================================


-- ============================================================
-- AR tie-out
-- ============================================================

CREATE OR REPLACE FUNCTION get_ar_tie_out(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "subledgerBalance" NUMERIC,
  "glBalance" NUMERIC,
  "variance" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH
    -- Active invoices' open amount in invoice currency.
    invoice_open AS (
      SELECT
        si."id",
        si."totalAmount",
        si."exchangeRate",
        si."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount")
          FROM "paymentApplication" pa
          JOIN "payment" p ON p."id" = pa."paymentId"
          WHERE pa."salesInvoiceId" = si."id"
            AND p."status" = 'Posted'
            -- Cut on the payment's posting date (= the journal postingDate
            -- the GL side uses), NOT the free-form appliedDate, so the
            -- subledger and GL reconcile as of the same clock.
            AND p."postingDate" <= _as_of_date
        ), 0) AS open_inv_ccy
      FROM "salesInvoices" si
      WHERE si."companyId" = _company_id
        AND si."postingDate" <= _as_of_date
        AND si."status" NOT IN ('Draft', 'Pending', 'Voided')
    ),
    -- Unapplied portion of Posted Receipts, in payment currency.
    payment_unapplied AS (
      SELECT
        p."id",
        p."totalAmount",
        p."exchangeRate",
        p."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount")
          FROM "paymentApplication" pa
          WHERE pa."paymentId" = p."id"
        ), 0) AS unapplied_pay_ccy
      FROM "payment" p
      WHERE p."companyId" = _company_id
        AND p."paymentType" = 'Receipt'
        AND p."status" = 'Posted'
        AND p."postingDate" <= _as_of_date
    ),
    subledger AS (
      SELECT
        COALESCE(SUM(open_inv_ccy * "exchangeRate"), 0)
        -
        COALESCE((SELECT SUM(unapplied_pay_ccy * "exchangeRate") FROM payment_unapplied), 0)
        AS amount
      FROM invoice_open
    ),
    ar_account AS (
      SELECT "receivablesAccount" AS account_id
      FROM "accountDefault"
      WHERE "companyId" = _company_id
    ),
    gl AS (
      SELECT COALESCE(SUM(jl."amount"), 0) AS amount
      FROM "journalLine" jl
      JOIN "journal" j ON j."id" = jl."journalId"
      JOIN ar_account a ON jl."accountId" = a.account_id
      WHERE jl."companyId" = _company_id
        AND j."postingDate" <= _as_of_date
        AND j."status" = 'Posted'
    )
  SELECT
    subledger.amount AS "subledgerBalance",
    gl.amount AS "glBalance",
    subledger.amount - gl.amount AS "variance"
  FROM subledger, gl;
$$;


-- ============================================================
-- AP tie-out (mirror of AR)
-- ============================================================

CREATE OR REPLACE FUNCTION get_ap_tie_out(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "subledgerBalance" NUMERIC,
  "glBalance" NUMERIC,
  "variance" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH
    invoice_open AS (
      SELECT
        pi."id",
        pi."totalAmount",
        pi."exchangeRate",
        pi."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount")
          FROM "paymentApplication" pa
          JOIN "payment" p ON p."id" = pa."paymentId"
          WHERE pa."purchaseInvoiceId" = pi."id"
            AND p."status" = 'Posted'
            -- See AR note: reconcile on payment.postingDate, not appliedDate.
            AND p."postingDate" <= _as_of_date
        ), 0) AS open_inv_ccy
      FROM "purchaseInvoices" pi
      WHERE pi."companyId" = _company_id
        AND pi."postingDate" <= _as_of_date
        AND pi."status" NOT IN ('Draft', 'Pending', 'Voided')
    ),
    payment_unapplied AS (
      SELECT
        p."id",
        p."totalAmount",
        p."exchangeRate",
        p."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount")
          FROM "paymentApplication" pa
          WHERE pa."paymentId" = p."id"
        ), 0) AS unapplied_pay_ccy
      FROM "payment" p
      WHERE p."companyId" = _company_id
        AND p."paymentType" = 'Disbursement'
        AND p."status" = 'Posted'
        AND p."postingDate" <= _as_of_date
    ),
    subledger AS (
      SELECT
        COALESCE(SUM(open_inv_ccy * "exchangeRate"), 0)
        -
        COALESCE((SELECT SUM(unapplied_pay_ccy * "exchangeRate") FROM payment_unapplied), 0)
        AS amount
      FROM invoice_open
    ),
    ap_account AS (
      SELECT "payablesAccount" AS account_id
      FROM "accountDefault"
      WHERE "companyId" = _company_id
    ),
    gl AS (
      SELECT COALESCE(SUM(jl."amount"), 0) AS amount
      FROM "journalLine" jl
      JOIN "journal" j ON j."id" = jl."journalId"
      JOIN ap_account a ON jl."accountId" = a.account_id
      WHERE jl."companyId" = _company_id
        AND j."postingDate" <= _as_of_date
        AND j."status" = 'Posted'
    )
  SELECT
    subledger.amount AS "subledgerBalance",
    gl.amount AS "glBalance",
    subledger.amount - gl.amount AS "variance"
  FROM subledger, gl;
$$;


-- ============================================================
-- Drill-down: open AR invoices per customer (as-of date)
-- ============================================================

CREATE OR REPLACE FUNCTION get_ar_open_by_customer(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "customerId" TEXT,
  "invoiceId" TEXT,
  "invoiceNumber" TEXT,
  "dateDue" DATE,
  "currencyCode" TEXT,
  "exchangeRate" NUMERIC,
  "totalAmount" NUMERIC,
  "settled" NUMERIC,
  "openInCurrency" NUMERIC,
  "openInBase" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  SELECT
    si."customerId",
    si."id" AS "invoiceId",
    si."invoiceId" AS "invoiceNumber",
    si."dateDue",
    si."currencyCode",
    si."exchangeRate",
    si."totalAmount",
    COALESCE(s.settled, 0) AS "settled",
    (si."totalAmount" - COALESCE(s.settled, 0)) AS "openInCurrency",
    (si."totalAmount" - COALESCE(s.settled, 0)) * si."exchangeRate" AS "openInBase"
  FROM "salesInvoices" si
  LEFT JOIN LATERAL (
    SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount") AS settled
    FROM "paymentApplication" pa
    JOIN "payment" p ON p."id" = pa."paymentId"
    WHERE pa."salesInvoiceId" = si."id"
      AND p."status" = 'Posted'
      AND p."postingDate" <= _as_of_date
  ) s ON true
  WHERE si."companyId" = _company_id
    AND si."postingDate" <= _as_of_date
    AND si."status" NOT IN ('Draft', 'Pending', 'Voided')
    AND (si."totalAmount" - COALESCE(s.settled, 0)) <> 0
  ORDER BY si."customerId", si."dateDue" NULLS LAST;
$$;


-- ============================================================
-- Drill-down: open AP invoices per supplier (as-of date)
-- ============================================================

CREATE OR REPLACE FUNCTION get_ap_open_by_supplier(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "supplierId" TEXT,
  "invoiceId" TEXT,
  "invoiceNumber" TEXT,
  "dateDue" DATE,
  "currencyCode" TEXT,
  "exchangeRate" NUMERIC,
  "totalAmount" NUMERIC,
  "settled" NUMERIC,
  "openInCurrency" NUMERIC,
  "openInBase" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  SELECT
    pi."supplierId",
    pi."id" AS "invoiceId",
    pi."invoiceId" AS "invoiceNumber",
    pi."dateDue",
    pi."currencyCode",
    pi."exchangeRate",
    pi."totalAmount",
    COALESCE(s.settled, 0) AS "settled",
    (pi."totalAmount" - COALESCE(s.settled, 0)) AS "openInCurrency",
    (pi."totalAmount" - COALESCE(s.settled, 0)) * pi."exchangeRate" AS "openInBase"
  FROM "purchaseInvoices" pi
  LEFT JOIN LATERAL (
    SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount") AS settled
    FROM "paymentApplication" pa
    JOIN "payment" p ON p."id" = pa."paymentId"
    WHERE pa."purchaseInvoiceId" = pi."id"
      AND p."status" = 'Posted'
      AND p."postingDate" <= _as_of_date
  ) s ON true
  WHERE pi."companyId" = _company_id
    AND pi."postingDate" <= _as_of_date
    AND pi."status" NOT IN ('Draft', 'Pending', 'Voided')
    AND (pi."totalAmount" - COALESCE(s.settled, 0)) <> 0
  ORDER BY pi."supplierId", pi."dateDue" NULLS LAST;
$$;


-- ============================================================
-- AR aging
-- ============================================================

CREATE OR REPLACE FUNCTION get_ar_aging(
  _company_id TEXT,
  _as_of_date DATE,
  _aging_method TEXT DEFAULT 'dueDate',
  _bucket1 INTEGER DEFAULT 30,
  _bucket2 INTEGER DEFAULT 60,
  _bucket3 INTEGER DEFAULT 90
)
RETURNS TABLE (
  "customerId" TEXT,
  "paymentTerm" TEXT,
  "current" NUMERIC,
  "bucket1" NUMERIC,
  "bucket2" NUMERIC,
  "bucket3" NUMERIC,
  "bucket4" NUMERIC,
  "unapplied" NUMERIC,
  "total" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH open_invoices AS (
    SELECT
      si."customerId",
      CASE
        WHEN _aging_method = 'documentDate'
          THEN COALESCE(si."dateIssued", si."postingDate")
        ELSE si."dateDue"
      END AS age_date,
      (si."totalAmount" - COALESCE((
        SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount")
        FROM "paymentApplication" pa
        JOIN "payment" p ON p."id" = pa."paymentId"
        WHERE pa."salesInvoiceId" = si."id"
          AND p."status" = 'Posted'
          -- Reconcile on payment.postingDate (matches the tie-out report),
          -- not the free-form appliedDate.
          AND p."postingDate" <= _as_of_date
      ), 0)) * si."exchangeRate" AS open_base
    FROM "salesInvoices" si
    WHERE si."companyId" = _company_id
      AND si."postingDate" <= _as_of_date
      AND si."status" NOT IN ('Draft', 'Pending', 'Voided')
  ),
  invoice_buckets AS (
    SELECT
      "customerId",
      COALESCE(SUM(open_base) FILTER (
        WHERE age_date IS NULL OR age_date >= _as_of_date
      ), 0) AS "current",
      COALESCE(SUM(open_base) FILTER (
        WHERE age_date < _as_of_date
          AND _as_of_date - age_date BETWEEN 1 AND _bucket1
      ), 0) AS "bucket1",
      COALESCE(SUM(open_base) FILTER (
        WHERE _as_of_date - age_date BETWEEN _bucket1 + 1 AND _bucket2
      ), 0) AS "bucket2",
      COALESCE(SUM(open_base) FILTER (
        WHERE _as_of_date - age_date BETWEEN _bucket2 + 1 AND _bucket3
      ), 0) AS "bucket3",
      COALESCE(SUM(open_base) FILTER (
        WHERE _as_of_date - age_date > _bucket3
      ), 0) AS "bucket4"
    FROM open_invoices
    WHERE open_base <> 0
    GROUP BY "customerId"
  ),
  unapplied AS (
    SELECT
      p."customerId",
      -COALESCE(SUM(
        (p."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount")
          FROM "paymentApplication" pa
          WHERE pa."paymentId" = p."id"
        ), 0)) * p."exchangeRate"
      ), 0) AS "unapplied"
    FROM "payment" p
    WHERE p."companyId" = _company_id
      AND p."paymentType" = 'Receipt'
      AND p."status" = 'Posted'
      AND p."postingDate" <= _as_of_date
      AND p."customerId" IS NOT NULL
    GROUP BY p."customerId"
  )
  SELECT
    COALESCE(ib."customerId", u."customerId") AS "customerId",
    pt."name" AS "paymentTerm",
    COALESCE(ib."current", 0) AS "current",
    COALESCE(ib."bucket1", 0) AS "bucket1",
    COALESCE(ib."bucket2", 0) AS "bucket2",
    COALESCE(ib."bucket3", 0) AS "bucket3",
    COALESCE(ib."bucket4", 0) AS "bucket4",
    COALESCE(u."unapplied", 0) AS "unapplied",
    COALESCE(ib."current", 0) + COALESCE(ib."bucket1", 0)
      + COALESCE(ib."bucket2", 0) + COALESCE(ib."bucket3", 0)
      + COALESCE(ib."bucket4", 0) + COALESCE(u."unapplied", 0) AS "total"
  FROM invoice_buckets ib
  FULL OUTER JOIN unapplied u ON u."customerId" = ib."customerId"
  LEFT JOIN "customerPayment" cp
    ON cp."customerId" = COALESCE(ib."customerId", u."customerId")
    AND cp."companyId" = _company_id
  LEFT JOIN "paymentTerm" pt ON pt."id" = cp."paymentTermId"
  WHERE
    COALESCE(ib."current", 0) + COALESCE(ib."bucket1", 0)
      + COALESCE(ib."bucket2", 0) + COALESCE(ib."bucket3", 0)
      + COALESCE(ib."bucket4", 0) + COALESCE(u."unapplied", 0) <> 0
  ORDER BY "total" DESC;
$$;


-- ============================================================
-- AP aging (mirror — supplier + purchaseInvoice + Disbursement)
-- ============================================================

CREATE OR REPLACE FUNCTION get_ap_aging(
  _company_id TEXT,
  _as_of_date DATE,
  _aging_method TEXT DEFAULT 'dueDate',
  _bucket1 INTEGER DEFAULT 30,
  _bucket2 INTEGER DEFAULT 60,
  _bucket3 INTEGER DEFAULT 90
)
RETURNS TABLE (
  "supplierId" TEXT,
  "paymentTerm" TEXT,
  "current" NUMERIC,
  "bucket1" NUMERIC,
  "bucket2" NUMERIC,
  "bucket3" NUMERIC,
  "bucket4" NUMERIC,
  "unapplied" NUMERIC,
  "total" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH open_invoices AS (
    SELECT
      pi."supplierId",
      CASE
        WHEN _aging_method = 'documentDate'
          THEN COALESCE(pi."dateIssued", pi."postingDate")
        ELSE pi."dateDue"
      END AS age_date,
      (pi."totalAmount" - COALESCE((
        SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount")
        FROM "paymentApplication" pa
        JOIN "payment" p ON p."id" = pa."paymentId"
        WHERE pa."purchaseInvoiceId" = pi."id"
          AND p."status" = 'Posted'
          -- See AR note: reconcile on payment.postingDate, not appliedDate.
          AND p."postingDate" <= _as_of_date
      ), 0)) * pi."exchangeRate" AS open_base
    FROM "purchaseInvoices" pi
    WHERE pi."companyId" = _company_id
      AND pi."postingDate" <= _as_of_date
      AND pi."status" NOT IN ('Draft', 'Pending', 'Voided')
  ),
  invoice_buckets AS (
    SELECT
      "supplierId",
      COALESCE(SUM(open_base) FILTER (
        WHERE age_date IS NULL OR age_date >= _as_of_date
      ), 0) AS "current",
      COALESCE(SUM(open_base) FILTER (
        WHERE age_date < _as_of_date
          AND _as_of_date - age_date BETWEEN 1 AND _bucket1
      ), 0) AS "bucket1",
      COALESCE(SUM(open_base) FILTER (
        WHERE _as_of_date - age_date BETWEEN _bucket1 + 1 AND _bucket2
      ), 0) AS "bucket2",
      COALESCE(SUM(open_base) FILTER (
        WHERE _as_of_date - age_date BETWEEN _bucket2 + 1 AND _bucket3
      ), 0) AS "bucket3",
      COALESCE(SUM(open_base) FILTER (
        WHERE _as_of_date - age_date > _bucket3
      ), 0) AS "bucket4"
    FROM open_invoices
    WHERE open_base <> 0
    GROUP BY "supplierId"
  ),
  unapplied AS (
    SELECT
      p."supplierId",
      -COALESCE(SUM(
        (p."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount")
          FROM "paymentApplication" pa
          WHERE pa."paymentId" = p."id"
        ), 0)) * p."exchangeRate"
      ), 0) AS "unapplied"
    FROM "payment" p
    WHERE p."companyId" = _company_id
      AND p."paymentType" = 'Disbursement'
      AND p."status" = 'Posted'
      AND p."postingDate" <= _as_of_date
      AND p."supplierId" IS NOT NULL
    GROUP BY p."supplierId"
  )
  SELECT
    COALESCE(ib."supplierId", u."supplierId") AS "supplierId",
    pt."name" AS "paymentTerm",
    COALESCE(ib."current", 0) AS "current",
    COALESCE(ib."bucket1", 0) AS "bucket1",
    COALESCE(ib."bucket2", 0) AS "bucket2",
    COALESCE(ib."bucket3", 0) AS "bucket3",
    COALESCE(ib."bucket4", 0) AS "bucket4",
    COALESCE(u."unapplied", 0) AS "unapplied",
    COALESCE(ib."current", 0) + COALESCE(ib."bucket1", 0)
      + COALESCE(ib."bucket2", 0) + COALESCE(ib."bucket3", 0)
      + COALESCE(ib."bucket4", 0) + COALESCE(u."unapplied", 0) AS "total"
  FROM invoice_buckets ib
  FULL OUTER JOIN unapplied u ON u."supplierId" = ib."supplierId"
  LEFT JOIN "supplierPayment" sp
    ON sp."supplierId" = COALESCE(ib."supplierId", u."supplierId")
    AND sp."companyId" = _company_id
  LEFT JOIN "paymentTerm" pt ON pt."id" = sp."paymentTermId"
  WHERE
    COALESCE(ib."current", 0) + COALESCE(ib."bucket1", 0)
      + COALESCE(ib."bucket2", 0) + COALESCE(ib."bucket3", 0)
      + COALESCE(ib."bucket4", 0) + COALESCE(u."unapplied", 0) <> 0
  ORDER BY "total" DESC;
$$;
