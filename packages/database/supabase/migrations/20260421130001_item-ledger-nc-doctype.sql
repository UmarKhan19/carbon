-- Add a 'Non-Conformance' document type to itemLedgerDocumentType so that
-- ledger rows written on NCR closure (Scrap / Return to Supplier) can be
-- traced back to the originating NC.
--
-- Postgres requires ADD VALUE to run in its own migration before the value
-- is referenced by other statements.

ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Non-Conformance';
