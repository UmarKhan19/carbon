-- Add a denormalized `companyId` to company-owned child/join tables that previously
-- derived it from a parent (no own column). Why:
--   1. The company backup/export catalog only captures tables that have their own
--      `companyId`/`companyGroupId` column, so these were silently skipped — a restore
--      lost customer/supplier contacts & locations, quote/supplier-quote line prices,
--      purchase-invoice price/payment relations, picking tracked-entity links, employee
--      shifts, and document labels.
--   2. It matches the codebase convention (companyId on every tenant table) and lets RLS
--      use a direct column later (left parent-derived here — simplifying RLS is a follow-up).
--
-- companyId is backfilled from each table's parent and kept populated on INSERT by a shared
-- BEFORE-INSERT trigger, so no app insert code has to change. All parent FK columns are
-- NOT NULL with no orphans (verified), so the backfill fills every row.

-- Shared trigger: derive companyId from a parent. TG_ARGV = (parent_table, fk_column).
CREATE OR REPLACE FUNCTION set_company_id_from_parent() RETURNS trigger AS $$
DECLARE
  v_fkval text := to_jsonb(NEW) ->> TG_ARGV[1];
  v_company text;
BEGIN
  IF (to_jsonb(NEW) ->> 'companyId') IS NOT NULL THEN RETURN NEW; END IF;
  IF v_fkval IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT "companyId" FROM %I WHERE "id" = $1', TG_ARGV[0])
    INTO v_company USING v_fkval;
  NEW."companyId" := v_company;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── customerContact ← customer ─────────────────────────────────────────────
ALTER TABLE "customerContact" ADD COLUMN "companyId" TEXT;
UPDATE "customerContact" c SET "companyId" = p."companyId" FROM "customer" p WHERE c."customerId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "customerContact" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('customer', 'customerId');
ALTER TABLE "customerContact" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "customerContact" ADD CONSTRAINT "customerContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "customerContact_companyId_idx" ON "customerContact" ("companyId");

-- ─── customerLocation ← customer ────────────────────────────────────────────
ALTER TABLE "customerLocation" ADD COLUMN "companyId" TEXT;
UPDATE "customerLocation" c SET "companyId" = p."companyId" FROM "customer" p WHERE c."customerId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "customerLocation" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('customer', 'customerId');
ALTER TABLE "customerLocation" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "customerLocation" ADD CONSTRAINT "customerLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "customerLocation_companyId_idx" ON "customerLocation" ("companyId");

-- ─── supplierContact ← supplier ─────────────────────────────────────────────
ALTER TABLE "supplierContact" ADD COLUMN "companyId" TEXT;
UPDATE "supplierContact" c SET "companyId" = p."companyId" FROM "supplier" p WHERE c."supplierId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "supplierContact" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('supplier', 'supplierId');
ALTER TABLE "supplierContact" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "supplierContact" ADD CONSTRAINT "supplierContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "supplierContact_companyId_idx" ON "supplierContact" ("companyId");

-- ─── supplierLocation ← supplier ────────────────────────────────────────────
ALTER TABLE "supplierLocation" ADD COLUMN "companyId" TEXT;
UPDATE "supplierLocation" c SET "companyId" = p."companyId" FROM "supplier" p WHERE c."supplierId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "supplierLocation" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('supplier', 'supplierId');
ALTER TABLE "supplierLocation" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "supplierLocation" ADD CONSTRAINT "supplierLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "supplierLocation_companyId_idx" ON "supplierLocation" ("companyId");

-- ─── quoteLinePrice ← quote ─────────────────────────────────────────────────
ALTER TABLE "quoteLinePrice" ADD COLUMN "companyId" TEXT;
UPDATE "quoteLinePrice" c SET "companyId" = p."companyId" FROM "quote" p WHERE c."quoteId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "quoteLinePrice" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('quote', 'quoteId');
ALTER TABLE "quoteLinePrice" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "quoteLinePrice" ADD CONSTRAINT "quoteLinePrice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "quoteLinePrice_companyId_idx" ON "quoteLinePrice" ("companyId");

-- ─── supplierQuoteLinePrice ← supplierQuote ─────────────────────────────────
ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "companyId" TEXT;
UPDATE "supplierQuoteLinePrice" c SET "companyId" = p."companyId" FROM "supplierQuote" p WHERE c."supplierQuoteId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "supplierQuoteLinePrice" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('supplierQuote', 'supplierQuoteId');
ALTER TABLE "supplierQuoteLinePrice" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "supplierQuoteLinePrice" ADD CONSTRAINT "supplierQuoteLinePrice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "supplierQuoteLinePrice_companyId_idx" ON "supplierQuoteLinePrice" ("companyId");

-- ─── purchaseInvoicePriceChange ← purchaseInvoice ───────────────────────────
ALTER TABLE "purchaseInvoicePriceChange" ADD COLUMN "companyId" TEXT;
UPDATE "purchaseInvoicePriceChange" c SET "companyId" = p."companyId" FROM "purchaseInvoice" p WHERE c."invoiceId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "purchaseInvoicePriceChange" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('purchaseInvoice', 'invoiceId');
ALTER TABLE "purchaseInvoicePriceChange" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "purchaseInvoicePriceChange" ADD CONSTRAINT "purchaseInvoicePriceChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "purchaseInvoicePriceChange_companyId_idx" ON "purchaseInvoicePriceChange" ("companyId");

-- ─── purchaseInvoicePaymentRelation ← purchaseInvoice ───────────────────────
ALTER TABLE "purchaseInvoicePaymentRelation" ADD COLUMN "companyId" TEXT;
UPDATE "purchaseInvoicePaymentRelation" c SET "companyId" = p."companyId" FROM "purchaseInvoice" p WHERE c."invoiceId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "purchaseInvoicePaymentRelation" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('purchaseInvoice', 'invoiceId');
ALTER TABLE "purchaseInvoicePaymentRelation" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "purchaseInvoicePaymentRelation" ADD CONSTRAINT "purchaseInvoicePaymentRelation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "purchaseInvoicePaymentRelation_companyId_idx" ON "purchaseInvoicePaymentRelation" ("companyId");

-- ─── pickingListLineTrackedEntity ← pickingListLine ─────────────────────────
ALTER TABLE "pickingListLineTrackedEntity" ADD COLUMN "companyId" TEXT;
UPDATE "pickingListLineTrackedEntity" c SET "companyId" = p."companyId" FROM "pickingListLine" p WHERE c."pickingListLineId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "pickingListLineTrackedEntity" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('pickingListLine', 'pickingListLineId');
ALTER TABLE "pickingListLineTrackedEntity" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "pickingListLineTrackedEntity" ADD CONSTRAINT "pickingListLineTrackedEntity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "pickingListLineTrackedEntity_companyId_idx" ON "pickingListLineTrackedEntity" ("companyId");

-- ─── employeeShift ← shift (employeeId is a global user, so derive from shift) ─
ALTER TABLE "employeeShift" ADD COLUMN "companyId" TEXT;
UPDATE "employeeShift" c SET "companyId" = p."companyId" FROM "shift" p WHERE c."shiftId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "employeeShift" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('shift', 'shiftId');
ALTER TABLE "employeeShift" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "employeeShift" ADD CONSTRAINT "employeeShift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "employeeShift_companyId_idx" ON "employeeShift" ("companyId");

-- ─── documentLabel ← document ───────────────────────────────────────────────
ALTER TABLE "documentLabel" ADD COLUMN "companyId" TEXT;
UPDATE "documentLabel" c SET "companyId" = p."companyId" FROM "document" p WHERE c."documentId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "documentLabel" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('document', 'documentId');
ALTER TABLE "documentLabel" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "documentLabel" ADD CONSTRAINT "documentLabel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "documentLabel_companyId_idx" ON "documentLabel" ("companyId");
