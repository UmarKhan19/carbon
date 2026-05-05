-- Add `inventoryAdjustment` to the `transactionSurface` enum.
-- Original migration (`20260505000000_item-rule-surfaces.sql`) was applied
-- before this surface was introduced; this top-up keeps existing databases
-- in sync without recreating the type.

ALTER TYPE "transactionSurface" ADD VALUE IF NOT EXISTS 'inventoryAdjustment';

-- Refresh the default to include the new value so freshly-inserted rows
-- continue to "apply to all surfaces" by default.
ALTER TABLE "itemRule"
  ALTER COLUMN "surfaces" SET DEFAULT ARRAY[
    'receipt',
    'shipment',
    'stockTransfer',
    'jobOperation',
    'inventoryAdjustment'
  ]::"transactionSurface"[];
