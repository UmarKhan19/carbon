-- Add itemScrapPercentage column to jobMaterial table
-- This stores the scrap percentage at the time the job was created for historical accuracy
ALTER TABLE "jobMaterial"
  ADD COLUMN IF NOT EXISTS "itemScrapPercentage" NUMERIC(5, 2) DEFAULT 0 NOT NULL;

-- Add itemScrapPercentage column to jobMakeMethod table
ALTER TABLE "jobMakeMethod"
  ADD COLUMN IF NOT EXISTS "itemScrapPercentage" NUMERIC(5, 2) DEFAULT 0 NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN "jobMaterial"."itemScrapPercentage" IS 'Scrap percentage from itemReplenishment at time of job creation';
COMMENT ON COLUMN "jobMakeMethod"."itemScrapPercentage" IS 'Scrap percentage from itemReplenishment at time of job creation';
