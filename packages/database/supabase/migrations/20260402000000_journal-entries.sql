-- Journal Entries: add manual journal entry support to existing journal/journalLine tables

CREATE TYPE "journalEntryType" AS ENUM (
  'Accrual',
  'Correction',
  'Reclassification',
  'Depreciation',
  'Other'
);

CREATE TYPE "journalEntryStatus" AS ENUM (
  'Draft',
  'Posted'
);

-- Add manual JE columns to journal
ALTER TABLE "journal" ADD COLUMN "journalEntryId" TEXT;
ALTER TABLE "journal" ADD COLUMN "status" "journalEntryStatus" NOT NULL DEFAULT 'Posted';
ALTER TABLE "journal" ADD COLUMN "entryType" "journalEntryType";
ALTER TABLE "journal" ADD COLUMN "reversalOfId" INTEGER;
ALTER TABLE "journal" ADD COLUMN "postedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "journal" ADD COLUMN "postedBy" TEXT;
ALTER TABLE "journal" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "journal" ADD COLUMN "updatedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "journal" ADD COLUMN "updatedBy" TEXT;

ALTER TABLE "journal" ADD CONSTRAINT "journal_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal" ADD CONSTRAINT "journal_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal" ADD CONSTRAINT "journal_postedBy_fkey"
  FOREIGN KEY ("postedBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal" ADD CONSTRAINT "journal_updatedBy_fkey"
  FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "journal_journalEntryId_companyId_key"
  ON "journal" ("journalEntryId", "companyId")
  WHERE "journalEntryId" IS NOT NULL;

CREATE INDEX "journal_status_idx" ON "journal" ("status", "companyId");

-- Allow UPDATE and DELETE on Draft journals only
CREATE POLICY "UPDATE" ON "public"."journal"
  FOR UPDATE USING (
    "status" = 'Draft'
    AND "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "public"."journal"
  FOR DELETE USING (
    "status" = 'Draft'
    AND "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
  );

-- Add updatedAt/updatedBy to journalLine for draft editing
ALTER TABLE "journalLine" ADD COLUMN "updatedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "journalLine" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "journalLine" ADD CONSTRAINT "journalLine_updatedBy_fkey"
  FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Allow UPDATE and DELETE on journalLines belonging to Draft journals only
CREATE POLICY "UPDATE" ON "public"."journalLine"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
    AND EXISTS (
      SELECT 1 FROM "journal" j
      WHERE j."id" = "journalLine"."journalId" AND j."status" = 'Draft'
    )
  );

CREATE POLICY "DELETE" ON "public"."journalLine"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
    AND EXISTS (
      SELECT 1 FROM "journal" j
      WHERE j."id" = "journalLine"."journalId" AND j."status" = 'Draft'
    )
  );

-- View for manual journal entries list (only entries with a journalEntryId)
CREATE OR REPLACE VIEW "journalEntries" AS
  SELECT
    j.*,
    COALESCE(SUM(CASE WHEN jl."amount" > 0 THEN jl."amount" ELSE 0 END), 0) AS "totalDebits",
    COALESCE(SUM(CASE WHEN jl."amount" < 0 THEN ABS(jl."amount") ELSE 0 END), 0) AS "totalCredits",
    COUNT(jl."id")::integer AS "lineCount"
  FROM "journal" j
  LEFT JOIN "journalLine" jl ON jl."journalId" = j."id"
  WHERE j."journalEntryId" IS NOT NULL
  GROUP BY j."id";
