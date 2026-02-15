-- Add required dimension fields to methodMaterial table
ALTER TABLE "methodMaterial"
ADD COLUMN IF NOT EXISTS "requiredLength" NUMERIC,
ADD COLUMN IF NOT EXISTS "requiredWidth" NUMERIC,
ADD COLUMN IF NOT EXISTS "requiredHeight" NUMERIC;

-- Add comments for the new columns
COMMENT ON COLUMN "methodMaterial"."requiredLength" IS 'Required length dimension for materials that require dimension tracking';
COMMENT ON COLUMN "methodMaterial"."requiredWidth" IS 'Required width dimension for materials that require dimension tracking';
COMMENT ON COLUMN "methodMaterial"."requiredHeight" IS 'Required height dimension for materials that require dimension tracking';
