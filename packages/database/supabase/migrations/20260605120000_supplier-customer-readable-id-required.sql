-- Tighten supplier.readableId and customer.readableId to NOT NULL.
--
-- Follow-up to 20260521120000_supplier-customer-readable-id.sql, which
-- introduced the column as nullable so the deploy could land without
-- disturbing existing rows. By the time this migration runs, the trigger +
-- form + importer paths have had time to populate readableId for any rows
-- users care about. Anything still NULL gets a sequence-generated id here
-- so we can lock the column down to NOT NULL.
--
-- Run only after verifying:
--   1. The auto-fill trigger on supplier/customer is firing for new inserts
--      (check a few recent rows: SELECT "readableId" FROM supplier ORDER
--      BY "createdAt" DESC LIMIT 10 — should all be non-NULL).
--   2. The SequenceOrCustomId form input is wired up in production.
--   3. CSV import is setting readableId on new entities.

-- Defensive: re-seed any missing sequences. The 20260521120000 migration
-- already did this for companies present at that time, but a company
-- created via some bypass path between then and now might be missing the
-- sequence row, which would cause get_next_sequence() below to raise.
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId", "updatedBy")
SELECT 'supplier', 'Supplier', 'SUP', NULL, 0, 6, 1, c.id, 'system'
FROM "company" c
ON CONFLICT ("table", "companyId") DO NOTHING;

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId", "updatedBy")
SELECT 'customer', 'Customer', 'CUS', NULL, 0, 6, 1, c.id, 'system'
FROM "company" c
ON CONFLICT ("table", "companyId") DO NOTHING;

-- Backfill any remaining NULL readableIds using the per-company sequence.
-- Each row's UPDATE triggers one get_next_sequence() call, which atomically
-- increments the sequence's "next" counter and returns the formatted value.
-- The partial unique index on (companyId, readableId) WHERE readableId IS
-- NOT NULL guarantees no collisions with values already present.
UPDATE "supplier"
SET "readableId" = get_next_sequence('supplier', "companyId")
WHERE "readableId" IS NULL;

UPDATE "customer"
SET "readableId" = get_next_sequence('customer', "companyId")
WHERE "readableId" IS NULL;

-- All rows now have a value. Lock the column down.
ALTER TABLE "supplier" ALTER COLUMN "readableId" SET NOT NULL;
ALTER TABLE "customer" ALTER COLUMN "readableId" SET NOT NULL;
