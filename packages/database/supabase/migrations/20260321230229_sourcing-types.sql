CREATE TYPE "sourcingType" AS ENUM (
  'Specified',
  'Drop Ship',
  'Ship from Inventory'
);

ALTER TABLE "methodMaterial"
  ADD COLUMN "sourcingType" "sourcingType" NOT NULL DEFAULT 'Specified';
