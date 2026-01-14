-- Add columns to link job operations and steps to assembly metadata

-- Add modelUploadId to jobOperation to link operations to CAD files
ALTER TABLE "jobOperation" ADD COLUMN "modelUploadId" TEXT;
ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_modelUploadId_fkey"
  FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "jobOperation_modelUploadId_idx" ON "jobOperation" ("modelUploadId");

-- Add assemblyNodeId to jobOperationStep to link steps to specific parts in the assembly hierarchy
-- This is a JSON path reference to the node in assemblyMetadata.hierarchy (e.g., "0.children.1.children.0")
ALTER TABLE "jobOperationStep" ADD COLUMN "assemblyNodeId" TEXT;

-- Add assemblyNodeName for display purposes (denormalized for performance)
ALTER TABLE "jobOperationStep" ADD COLUMN "assemblyNodeName" TEXT;

-- Add assemblyNodeQuantity for the quantity of this part in the assembly
ALTER TABLE "jobOperationStep" ADD COLUMN "assemblyNodeQuantity" INTEGER;
