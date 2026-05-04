-- Per-rule trigger surface scoping for itemRule.
-- See plan: Per-Rule Trigger Surface Scoping.

CREATE TYPE "transactionSurface" AS ENUM (
  'receipt',
  'shipment',
  'stockTransfer',
  'jobOperation'
);

ALTER TABLE "itemRule"
  ADD COLUMN "surfaces" "transactionSurface"[] NOT NULL
  DEFAULT ARRAY[
    'receipt',
    'shipment',
    'stockTransfer',
    'jobOperation'
  ]::"transactionSurface"[];

ALTER TABLE "itemRule"
  ADD CONSTRAINT "itemRule_surfaces_nonempty"
  CHECK (array_length("surfaces", 1) >= 1);
