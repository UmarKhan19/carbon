-- Add OpenCascade integration columns to assemblyProject
-- These columns support the CAD Service parsing workflow

-- Path to the converted GLB model file in storage
ALTER TABLE "assemblyProject" ADD COLUMN "modelPath" TEXT;

-- Progress tracking for CAD parsing (0-100)
ALTER TABLE "assemblyProject" ADD COLUMN "parsingProgress" INTEGER DEFAULT 0;

-- Error message from CAD parsing if it failed
ALTER TABLE "assemblyProject" ADD COLUMN "parsingError" TEXT;

-- Add index for status filtering (used in project lists)
CREATE INDEX IF NOT EXISTS "assemblyProject_parsingProgress_idx" ON "assemblyProject" ("parsingProgress");

-- Add 'parsing' and 'failed' as valid statuses
-- (status column already exists with TEXT type, so no enum to update)
COMMENT ON COLUMN "assemblyProject"."status" IS 'preprocessing | parsing | simulating | editing | published | failed';
COMMENT ON COLUMN "assemblyProject"."modelPath" IS 'Storage path to converted GLB model (e.g., companyId/assembly/projectId/model.glb)';
COMMENT ON COLUMN "assemblyProject"."parsingProgress" IS 'CAD parsing progress percentage (0-100)';
COMMENT ON COLUMN "assemblyProject"."parsingError" IS 'Error message if CAD parsing failed';
