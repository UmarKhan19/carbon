-- Assembly App - Standalone tables for BuildOS-like work instruction platform
-- This creates the infrastructure for the standalone Assembly app

-- Assembly Projects
CREATE TABLE "assemblyProject" (
  "id" TEXT NOT NULL DEFAULT nanoid(),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'preprocessing', -- preprocessing, simulating, editing, published

  -- Source CAD file
  "modelUploadId" TEXT,
  "originalFileName" TEXT NOT NULL,

  -- Parsed assembly tree (Phase 1 modifications)
  "assemblyTree" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "originalAssemblyTree" JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Simulation results
  "simulationStatus" TEXT, -- pending, running, completed, failed
  "simulationResult" JSONB,
  "simulationError" TEXT,
  "simulatedAt" TIMESTAMP WITH TIME ZONE,

  -- Metadata
  "thumbnailPath" TEXT,
  "videoPath" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,

  CONSTRAINT "assemblyProject_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyProject_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyProject_modelUploadId_fkey" FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "assemblyProject_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "assemblyProject_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "assemblyProject_companyId_idx" ON "assemblyProject" ("companyId");
CREATE INDEX "assemblyProject_status_idx" ON "assemblyProject" ("status");

-- Assembly Steps (Phase 2 data)
CREATE TABLE "assemblyStep" (
  "id" TEXT NOT NULL DEFAULT nanoid(),
  "projectId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,

  -- Step order
  "stepNumber" INTEGER NOT NULL,
  "groupId" TEXT, -- For grouping steps together

  -- Part reference
  "partIds" JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of part IDs in this step
  "partNames" JSONB NOT NULL DEFAULT '[]'::jsonb, -- Display names

  -- Animation data (from simulation)
  "animationPath" JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of transforms for animation
  "duration" INTEGER DEFAULT 1000, -- Animation duration ms

  -- Instruction content (user edited)
  "title" TEXT,
  "instruction" TEXT, -- Markdown content
  "notes" TEXT, -- Additional notes
  "warnings" JSONB DEFAULT '[]'::jsonb, -- Array of warning texts

  -- Annotations
  "annotations" JSONB DEFAULT '[]'::jsonb, -- Drawing annotations on 3D
  "cameraPosition" JSONB, -- Saved camera angle for this step

  -- Tool/spec references
  "toolIds" JSONB DEFAULT '[]'::jsonb, -- References to tool library
  "torqueSpecIds" JSONB DEFAULT '[]'::jsonb, -- References to torque specs

  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "assemblyStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyStep_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "assemblyProject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyStep_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyStep_projectId_stepNumber_key" UNIQUE ("projectId", "stepNumber")
);

CREATE INDEX "assemblyStep_projectId_idx" ON "assemblyStep" ("projectId");
CREATE INDEX "assemblyStep_companyId_idx" ON "assemblyStep" ("companyId");

-- Tool Library
CREATE TABLE "assemblyTool" (
  "id" TEXT NOT NULL DEFAULT nanoid(),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT, -- e.g., "wrench", "screwdriver", "pliers"
  "partNumber" TEXT,
  "imageUrl" TEXT,
  "specifications" JSONB, -- Custom specs (size, material, etc.)
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "assemblyTool_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyTool_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "assemblyTool_companyId_idx" ON "assemblyTool" ("companyId");

-- Torque Specifications Library
CREATE TABLE "assemblyTorqueSpec" (
  "id" TEXT NOT NULL DEFAULT nanoid(),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "torqueValue" DECIMAL NOT NULL,
  "torqueUnit" TEXT NOT NULL DEFAULT 'Nm', -- Nm, ft-lb, in-lb
  "tolerance" DECIMAL, -- +/- tolerance
  "angleSpec" DECIMAL, -- Torque-to-angle if applicable
  "notes" TEXT,
  "fastenerType" TEXT, -- e.g., "M8 bolt", "1/4-20"
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "assemblyTorqueSpec_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyTorqueSpec_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "assemblyTorqueSpec_companyId_idx" ON "assemblyTorqueSpec" ("companyId");

-- Standard Notes Library
CREATE TABLE "assemblyStandardNote" (
  "id" TEXT NOT NULL DEFAULT nanoid(),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "category" TEXT, -- e.g., "safety", "quality", "adhesive", "lubricant"
  "tags" JSONB DEFAULT '[]'::jsonb, -- Array of tag strings for filtering
  "usageCount" INTEGER DEFAULT 0, -- How many times used in steps
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "assemblyStandardNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyStandardNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "assemblyStandardNote_companyId_idx" ON "assemblyStandardNote" ("companyId");

-- Part Association Rules (Learning System for tribal knowledge)
CREATE TABLE "assemblyPartAssociation" (
  "id" TEXT NOT NULL DEFAULT nanoid(),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,

  -- Matching criteria
  "matchPattern" TEXT, -- Regex or exact match
  "matchField" TEXT DEFAULT 'name', -- name, partNumber, material, etc.
  "matchType" TEXT DEFAULT 'contains', -- exact, contains, regex, startsWith

  -- Auto-apply settings (tribal knowledge)
  "toolIds" JSONB DEFAULT '[]'::jsonb, -- Tools to auto-assign
  "torqueSpecIds" JSONB DEFAULT '[]'::jsonb, -- Torque specs to auto-assign
  "defaultInstruction" TEXT, -- Default instruction text
  "defaultNotes" TEXT, -- Additional notes
  "defaultWarnings" JSONB DEFAULT '[]'::jsonb, -- Safety warnings
  "adhesive" TEXT, -- e.g., "Loctite 242", "Anti-seize"
  "lubricant" TEXT, -- e.g., "Grease", "Oil"

  -- Learning metrics
  "usageCount" INTEGER DEFAULT 0, -- How many times applied
  "confirmationCount" INTEGER DEFAULT 0, -- How many times user confirmed suggestion
  "rejectionCount" INTEGER DEFAULT 0, -- How many times user rejected suggestion
  "confidence" DECIMAL DEFAULT 0.5, -- Confidence score (0-1)
  "source" TEXT DEFAULT 'manual', -- manual, learned, imported
  "learnedFromStepId" TEXT, -- If learned, which step taught us

  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "assemblyPartAssociation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyPartAssociation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "assemblyPartAssociation_companyId_idx" ON "assemblyPartAssociation" ("companyId");

-- Association Usage Log (for machine learning)
CREATE TABLE "assemblyAssociationUsage" (
  "id" TEXT NOT NULL DEFAULT nanoid(),
  "associationId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "action" TEXT NOT NULL, -- suggested, confirmed, rejected, modified
  "modifiedTo" JSONB, -- If modified, what was changed
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT,

  CONSTRAINT "assemblyAssociationUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyAssociationUsage_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "assemblyPartAssociation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyAssociationUsage_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "assemblyStep"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyAssociationUsage_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "assemblyAssociationUsage_associationId_idx" ON "assemblyAssociationUsage" ("associationId");
CREATE INDEX "assemblyAssociationUsage_stepId_idx" ON "assemblyAssociationUsage" ("stepId");

-- Shared Links for public viewing
CREATE TABLE "assemblyShareLink" (
  "id" TEXT NOT NULL DEFAULT nanoid(),
  "projectId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP WITH TIME ZONE,
  "password" TEXT, -- Optional password protection (hashed)
  "allowDownload" BOOLEAN DEFAULT false,
  "viewCount" INTEGER DEFAULT 0,
  "lastViewedAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT,

  CONSTRAINT "assemblyShareLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "assemblyProject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyShareLink_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "assemblyShareLink_token_key" UNIQUE ("token")
);

CREATE INDEX "assemblyShareLink_projectId_idx" ON "assemblyShareLink" ("projectId");
CREATE INDEX "assemblyShareLink_token_idx" ON "assemblyShareLink" ("token");

-- Enable Row Level Security
ALTER TABLE "assemblyProject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assemblyStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assemblyTool" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assemblyTorqueSpec" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assemblyStandardNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assemblyPartAssociation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assemblyAssociationUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assemblyShareLink" ENABLE ROW LEVEL SECURITY;

-- RLS Policies using the helper function pattern
CREATE POLICY "SELECT" ON "assemblyProject"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_view'))::text[])
  );

CREATE POLICY "INSERT" ON "assemblyProject"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_create'))::text[])
  );

CREATE POLICY "UPDATE" ON "assemblyProject"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_update'))::text[])
  );

CREATE POLICY "DELETE" ON "assemblyProject"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_delete'))::text[])
  );

-- assemblyStep policies
CREATE POLICY "SELECT" ON "assemblyStep"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_view'))::text[])
  );

CREATE POLICY "INSERT" ON "assemblyStep"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_create'))::text[])
  );

CREATE POLICY "UPDATE" ON "assemblyStep"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_update'))::text[])
  );

CREATE POLICY "DELETE" ON "assemblyStep"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_delete'))::text[])
  );

-- assemblyTool policies
CREATE POLICY "SELECT" ON "assemblyTool"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_view'))::text[])
  );

CREATE POLICY "INSERT" ON "assemblyTool"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_create'))::text[])
  );

CREATE POLICY "UPDATE" ON "assemblyTool"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_update'))::text[])
  );

CREATE POLICY "DELETE" ON "assemblyTool"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_delete'))::text[])
  );

-- assemblyTorqueSpec policies
CREATE POLICY "SELECT" ON "assemblyTorqueSpec"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_view'))::text[])
  );

CREATE POLICY "INSERT" ON "assemblyTorqueSpec"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_create'))::text[])
  );

CREATE POLICY "UPDATE" ON "assemblyTorqueSpec"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_update'))::text[])
  );

CREATE POLICY "DELETE" ON "assemblyTorqueSpec"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_delete'))::text[])
  );

-- assemblyStandardNote policies
CREATE POLICY "SELECT" ON "assemblyStandardNote"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_view'))::text[])
  );

CREATE POLICY "INSERT" ON "assemblyStandardNote"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_create'))::text[])
  );

CREATE POLICY "UPDATE" ON "assemblyStandardNote"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_update'))::text[])
  );

CREATE POLICY "DELETE" ON "assemblyStandardNote"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_delete'))::text[])
  );

-- assemblyPartAssociation policies
CREATE POLICY "SELECT" ON "assemblyPartAssociation"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_view'))::text[])
  );

CREATE POLICY "INSERT" ON "assemblyPartAssociation"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_create'))::text[])
  );

CREATE POLICY "UPDATE" ON "assemblyPartAssociation"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_update'))::text[])
  );

CREATE POLICY "DELETE" ON "assemblyPartAssociation"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_delete'))::text[])
  );

-- assemblyAssociationUsage policies (inherit from association)
CREATE POLICY "SELECT" ON "assemblyAssociationUsage"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "assemblyPartAssociation"
      WHERE "assemblyPartAssociation"."id" = "assemblyAssociationUsage"."associationId"
      AND "assemblyPartAssociation"."companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_view'))::text[])
    )
  );

CREATE POLICY "INSERT" ON "assemblyAssociationUsage"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM "assemblyPartAssociation"
      WHERE "assemblyPartAssociation"."id" = "assemblyAssociationUsage"."associationId"
      AND "assemblyPartAssociation"."companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_create'))::text[])
    )
  );

-- assemblyShareLink policies (inherit from project)
CREATE POLICY "SELECT" ON "assemblyShareLink"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "assemblyProject"
      WHERE "assemblyProject"."id" = "assemblyShareLink"."projectId"
      AND "assemblyProject"."companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_view'))::text[])
    )
  );

CREATE POLICY "INSERT" ON "assemblyShareLink"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM "assemblyProject"
      WHERE "assemblyProject"."id" = "assemblyShareLink"."projectId"
      AND "assemblyProject"."companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_create'))::text[])
    )
  );

CREATE POLICY "UPDATE" ON "assemblyShareLink"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM "assemblyProject"
      WHERE "assemblyProject"."id" = "assemblyShareLink"."projectId"
      AND "assemblyProject"."companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_update'))::text[])
    )
  );

CREATE POLICY "DELETE" ON "assemblyShareLink"
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM "assemblyProject"
      WHERE "assemblyProject"."id" = "assemblyShareLink"."projectId"
      AND "assemblyProject"."companyId" = ANY ((SELECT get_companies_with_employee_permission('assembly_delete'))::text[])
    )
  );

-- Note: Assembly permissions (assembly_view, assembly_create, assembly_update, assembly_delete)
-- are granted via employeeTypePermission table. Add permissions for employee types as needed:
--
-- Example: Grant assembly permissions to Admin and Management employee types
-- INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "view", "create", "update", "delete")
-- SELECT et.id, 'assembly', true, true, true, true
-- FROM "employeeType" et WHERE et.name IN ('Admin', 'Management');
