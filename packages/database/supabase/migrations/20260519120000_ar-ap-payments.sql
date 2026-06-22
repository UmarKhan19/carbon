-- ============================================================
-- AR & AP Payments and Cash Application
--
-- Replaces the unused purchasePayment/purchaseInvoicePaymentRelation
-- stubs with a unified payment + paymentApplication model
-- (type-discriminated for AR vs AP, NetSuite-style applications
-- carrying principal/discount/write-off, multi-currency-aware).
--
-- Also adds four new accountDefault columns (customer/supplier
-- write-off, realized FX gain/loss) and one new chart-of-accounts
-- entry (4130 Vendor Write-Off Income). The remaining defaults
-- map to existing accounts (6050 Bad Debts Expense, 4120 FX Gains,
-- 7060 FX Losses).
-- ============================================================


-- ============================================================
-- Phase 1: Drop the unused AP stubs
-- ============================================================
-- The relation table has no amount/discount/write-off columns and
-- is unused in app code; the purchasePayment table is referenced
-- only by metadata (customFieldTable). DROP TABLE cascades to its
-- policies and any FK-attached customField rows.

DELETE FROM "customFieldTable" WHERE "table" = 'purchasePayment';

DROP TABLE IF EXISTS "purchaseInvoicePaymentRelation";
DROP TABLE IF EXISTS "purchasePayment";


-- ============================================================
-- Phase 2: New chart-of-accounts entry 4130 (Vendor Write-Off Income)
-- ============================================================
-- AR write-off uses existing 6050 Bad Debts Expense.
-- Realized FX gain/loss use existing 4120 / 7060.
-- AP write-off needs a new Other Income account.

DO $$
DECLARE
  cg RECORD;
  parent_id TEXT;
BEGIN
  FOR cg IN SELECT id FROM "companyGroup"
  LOOP
    -- Other Income group header has isGroup=TRUE and number IS NULL.
    SELECT id INTO parent_id
    FROM "account"
    WHERE "companyGroupId" = cg.id AND "isGroup" = TRUE AND name = 'Other Income'
    LIMIT 1;

    INSERT INTO "account" (
      number, name, "isGroup", "accountType", "incomeBalance", class,
      "parentId", "isSystem", "companyGroupId", "createdBy"
    )
    SELECT
      '4130', 'Vendor Write-Off Income', FALSE,
      'Other Income'::"accountType",
      'Income Statement'::"glIncomeBalance",
      'Revenue'::"glAccountClass",
      parent_id, FALSE, cg.id, 'system'
    WHERE NOT EXISTS (
      SELECT 1 FROM "account"
      WHERE "companyGroupId" = cg.id AND number = '4130'
    );
  END LOOP;
END $$;


-- ============================================================
-- Phase 3: Extend accountDefault with the four new mappings
-- ============================================================
-- Add nullable, backfill, then SET NOT NULL to match existing
-- column nullability convention on this table.

ALTER TABLE "accountDefault"
  ADD COLUMN "customerWriteOffAccount" TEXT,
  ADD COLUMN "supplierWriteOffAccount" TEXT,
  ADD COLUMN "realizedExchangeGainAccount" TEXT,
  ADD COLUMN "realizedExchangeLossAccount" TEXT;

-- Backfill: look up the account.id for each company's group by account.number.
UPDATE "accountDefault" ad
SET
  "customerWriteOffAccount" = (
    SELECT a.id FROM "account" a
    INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
    WHERE c.id = ad."companyId" AND a.number = '6050' LIMIT 1
  ),
  "supplierWriteOffAccount" = (
    SELECT a.id FROM "account" a
    INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
    WHERE c.id = ad."companyId" AND a.number = '4130' LIMIT 1
  ),
  "realizedExchangeGainAccount" = (
    SELECT a.id FROM "account" a
    INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
    WHERE c.id = ad."companyId" AND a.number = '4120' LIMIT 1
  ),
  "realizedExchangeLossAccount" = (
    SELECT a.id FROM "account" a
    INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
    WHERE c.id = ad."companyId" AND a.number = '7060' LIMIT 1
  );

ALTER TABLE "accountDefault"
  ALTER COLUMN "customerWriteOffAccount" SET NOT NULL,
  ALTER COLUMN "supplierWriteOffAccount" SET NOT NULL,
  ALTER COLUMN "realizedExchangeGainAccount" SET NOT NULL,
  ALTER COLUMN "realizedExchangeLossAccount" SET NOT NULL;

ALTER TABLE "accountDefault"
  ADD CONSTRAINT "accountDefault_customerWriteOffAccount_fkey"
    FOREIGN KEY ("customerWriteOffAccount") REFERENCES "account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accountDefault_supplierWriteOffAccount_fkey"
    FOREIGN KEY ("supplierWriteOffAccount") REFERENCES "account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accountDefault_realizedExchangeGainAccount_fkey"
    FOREIGN KEY ("realizedExchangeGainAccount") REFERENCES "account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accountDefault_realizedExchangeLossAccount_fkey"
    FOREIGN KEY ("realizedExchangeLossAccount") REFERENCES "account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- Phase 4: Enums
-- ============================================================

CREATE TYPE "paymentType" AS ENUM ('Receipt', 'Disbursement');
CREATE TYPE "paymentStatus" AS ENUM ('Draft', 'Posted', 'Voided');

ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Payment';
-- journal.sourceType uses this enum; post-payment writes 'Payment' journals.
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Payment';


-- ============================================================
-- Phase 5: payment table
-- ============================================================
-- The cash event. Receipt (AR cash-in) or Disbursement (AP cash-out)
-- discriminated by paymentType. customerId xor supplierId enforced
-- by check matching the type.

CREATE TABLE "payment" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "paymentId" TEXT NOT NULL,
  "paymentType" "paymentType" NOT NULL,
  "status" "paymentStatus" NOT NULL DEFAULT 'Draft',
  "customerId" TEXT,
  "supplierId" TEXT,
  "paymentDate" DATE NOT NULL,
  "postingDate" DATE,
  "currencyCode" TEXT NOT NULL,
  "exchangeRate" NUMERIC(19,8) NOT NULL DEFAULT 1,
  "totalAmount" NUMERIC(19,4) NOT NULL,
  "bankAccount" TEXT NOT NULL,
  "reference" TEXT,
  "memo" TEXT,
  "journalId" TEXT,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT,
  "voidedAt" TIMESTAMP WITH TIME ZONE,
  "voidedBy" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "payment_party_check" CHECK (
    ("paymentType" = 'Receipt'      AND "customerId" IS NOT NULL AND "supplierId" IS NULL) OR
    ("paymentType" = 'Disbursement' AND "supplierId" IS NOT NULL AND "customerId" IS NULL)
  ),
  CONSTRAINT "payment_totalAmount_check" CHECK ("totalAmount" > 0),
  CONSTRAINT "payment_exchangeRate_check" CHECK ("exchangeRate" > 0),
  CONSTRAINT "payment_paymentId_companyId_key" UNIQUE ("paymentId", "companyId"),

  CONSTRAINT "payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_bankAccount_fkey" FOREIGN KEY ("bankAccount") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_postedBy_fkey" FOREIGN KEY ("postedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_voidedBy_fkey" FOREIGN KEY ("voidedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "payment_companyId_idx" ON "payment" ("companyId");
CREATE INDEX "payment_customerId_idx" ON "payment" ("customerId") WHERE "customerId" IS NOT NULL;
CREATE INDEX "payment_supplierId_idx" ON "payment" ("supplierId") WHERE "supplierId" IS NOT NULL;
CREATE INDEX "payment_status_idx" ON "payment" ("status");
CREATE INDEX "payment_paymentDate_idx" ON "payment" ("paymentDate");

ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."payment"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."payment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);

-- Mutability ties to status: Draft is freely editable, Posted only
-- transitions to Voided (via post-payment edge function), Voided is
-- terminal. App-side service rejects illegal transitions.
CREATE POLICY "UPDATE" ON "public"."payment"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);

-- DELETE allowed only on Draft (Posted payments must be voided).
CREATE POLICY "DELETE" ON "public"."payment"
FOR DELETE USING (
  "status" = 'Draft' AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);


-- ============================================================
-- Phase 6: paymentApplication table
-- ============================================================
-- The join between a payment and an invoice. Carries principal,
-- discount, and write-off components in invoice currency. fxGainLoss
-- is a stored generated column computed from the rate delta on the
-- applied principal (discount/write-off use invoice rate by convention,
-- since they represent invoice-currency relief, not cash movement).
--
-- salesInvoiceId xor purchaseInvoiceId; matches the parent payment's
-- type via app-level validation (no SQL trigger needed — the post-payment
-- edge function rejects mismatched applications).

CREATE TABLE "paymentApplication" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "paymentId" TEXT NOT NULL,
  "salesInvoiceId" TEXT,
  "purchaseInvoiceId" TEXT,
  "appliedAmount" NUMERIC(19,4) NOT NULL,
  "discountAmount" NUMERIC(19,4) NOT NULL DEFAULT 0,
  "writeOffAmount" NUMERIC(19,4) NOT NULL DEFAULT 0,
  "invoiceExchangeRate" NUMERIC(19,8) NOT NULL,
  "paymentExchangeRate" NUMERIC(19,8) NOT NULL,
  -- Realized FX on this application, in base currency. FX accrues only on the
  -- cash-settled principal (appliedAmount): discount and write-off are
  -- invoice-currency reliefs booked at the invoice rate and carry no FX. Must
  -- match the FX plug booked by post-payment exactly so the subledger
  -- reconciles to the GL foreign-exchange accounts.
  "fxGainLossAmount" NUMERIC(19,4) GENERATED ALWAYS AS (
    "appliedAmount" * ("paymentExchangeRate" - "invoiceExchangeRate")
  ) STORED,
  "appliedDate" DATE NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "paymentApplication_invoice_check" CHECK (
    ("salesInvoiceId" IS NOT NULL AND "purchaseInvoiceId" IS NULL) OR
    ("salesInvoiceId" IS NULL AND "purchaseInvoiceId" IS NOT NULL)
  ),
  CONSTRAINT "paymentApplication_amounts_nonnegative" CHECK (
    "appliedAmount" >= 0 AND "discountAmount" >= 0 AND "writeOffAmount" >= 0
  ),
  CONSTRAINT "paymentApplication_anyComponent_check" CHECK (
    "appliedAmount" + "discountAmount" + "writeOffAmount" > 0
  ),
  CONSTRAINT "paymentApplication_invoiceExchangeRate_check" CHECK ("invoiceExchangeRate" > 0),
  CONSTRAINT "paymentApplication_paymentExchangeRate_check" CHECK ("paymentExchangeRate" > 0),

  CONSTRAINT "paymentApplication_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "paymentApplication_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "salesInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "paymentApplication_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchaseInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "paymentApplication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "paymentApplication_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "paymentApplication_paymentId_idx" ON "paymentApplication" ("paymentId");
CREATE INDEX "paymentApplication_salesInvoiceId_idx" ON "paymentApplication" ("salesInvoiceId") WHERE "salesInvoiceId" IS NOT NULL;
CREATE INDEX "paymentApplication_purchaseInvoiceId_idx" ON "paymentApplication" ("purchaseInvoiceId") WHERE "purchaseInvoiceId" IS NOT NULL;
CREATE INDEX "paymentApplication_appliedDate_idx" ON "paymentApplication" ("appliedDate");
CREATE INDEX "paymentApplication_companyId_idx" ON "paymentApplication" ("companyId");

ALTER TABLE "paymentApplication" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."paymentApplication"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

-- INSERT/UPDATE/DELETE allowed only while parent payment.status='Draft'.
CREATE POLICY "INSERT" ON "public"."paymentApplication"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "payment" p
    WHERE p.id = "paymentId" AND p.status = 'Draft'
  ) AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."paymentApplication"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "payment" p
    WHERE p.id = "paymentId" AND p.status = 'Draft'
  ) AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."paymentApplication"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "payment" p
    WHERE p.id = "paymentId" AND p.status = 'Draft'
  ) AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);


-- ============================================================
-- Phase 7: Custom field registry
-- ============================================================

INSERT INTO "customFieldTable" ("table", "name", "module") VALUES
  ('payment', 'Payment', 'Invoicing'),
  ('paymentApplication', 'Payment Application', 'Invoicing')
ON CONFLICT ("table") DO NOTHING;


-- ============================================================
-- Phase 8: Seed payment sequence for existing companies
-- ============================================================
-- New companies pick this up via seed-company/index.ts; this clause
-- handles companies that already exist.

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'payment', 'Payment', 'PAY-%{yyyy}-%{mm}-', NULL, 0, 6, 1, c.id
FROM "company" c
ON CONFLICT DO NOTHING;
