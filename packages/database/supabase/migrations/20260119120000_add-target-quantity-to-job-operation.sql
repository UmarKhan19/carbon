-- Add targetQuantity column to jobOperation table
-- This stores the quantity to produce before accounting for scrap
-- (parent.estimatedQuantity * quantityPerParent for children, or productionQuantity for root)
ALTER TABLE "jobOperation"
  ADD COLUMN IF NOT EXISTS "targetQuantity" NUMERIC DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN "jobOperation"."targetQuantity" IS 'The target quantity to produce before accounting for scrap (parent.estimatedQuantity * quantityPerParent)';
