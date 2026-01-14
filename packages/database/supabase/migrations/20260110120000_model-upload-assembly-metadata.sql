-- Add assembly metadata columns to modelUpload for CAD parsing

ALTER TABLE "modelUpload"
  ADD COLUMN "assemblyMetadata" JSONB,
  ADD COLUMN "parsingStatus" TEXT DEFAULT 'pending',
  ADD COLUMN "parsedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "parsingError" TEXT;

-- Create index for querying by parsing status
CREATE INDEX "modelUpload_parsingStatus_idx" ON "modelUpload" ("parsingStatus")
  WHERE "parsingStatus" IS NOT NULL;

COMMENT ON COLUMN "modelUpload"."assemblyMetadata" IS 'Parsed CAD assembly structure: hierarchy, parts, quantities, transforms';
COMMENT ON COLUMN "modelUpload"."parsingStatus" IS 'Status of CAD parsing: pending, processing, completed, failed';
COMMENT ON COLUMN "modelUpload"."parsedAt" IS 'Timestamp when parsing completed';
COMMENT ON COLUMN "modelUpload"."parsingError" IS 'Error message if parsing failed';
