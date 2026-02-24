CREATE TYPE "dimensionEntityType" AS ENUM (
  'Custom',
  'Location',
  'ItemPostingGroup',
  'SupplierType',
  'CustomerType',
  'Department',
  'Employee'
);

CREATE TABLE "dimension" (
  "id" TEXT NOT NULL DEFAULT id('dim'),
  "name" TEXT NOT NULL,
  "entityType" "dimensionEntityType" NOT NULL DEFAULT 'Custom',
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "dimension_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dimension_name_companyId_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "dimension_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "dimension_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "dimension_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "dimension_companyId_idx" ON "dimension"("companyId");

ALTER TABLE "dimension" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."dimension"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."dimension"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."dimension"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."dimension"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_delete')
    )::text[]
  )
);


CREATE TABLE "dimensionValue" (
  "id" TEXT NOT NULL DEFAULT id('dv'),
  "dimensionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "dimensionValue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dimensionValue_dimensionId_name_key" UNIQUE ("dimensionId", "name"),
  CONSTRAINT "dimensionValue_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "dimension"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "dimensionValue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "dimensionValue_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "dimensionValue_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "dimensionValue_dimensionId_idx" ON "dimensionValue"("dimensionId");
CREATE INDEX "dimensionValue_companyId_idx" ON "dimensionValue"("companyId");

ALTER TABLE "dimensionValue" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."dimensionValue"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."dimensionValue"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."dimensionValue"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."dimensionValue"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_delete')
    )::text[]
  )
);


CREATE TABLE "journalLineDimension" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "journalLineId" TEXT NOT NULL,
  "dimensionId" TEXT NOT NULL,
  "valueId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "journalLineDimension_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journalLineDimension_journalLineId_dimensionId_key" UNIQUE ("journalLineId", "dimensionId"),
  CONSTRAINT "journalLineDimension_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "journalLine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "journalLineDimension_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "dimension"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "journalLineDimension_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- valueId is intentionally not a FK. For Custom dimensions it references
-- dimensionValue.id; for entity-based dimensions it references the entity
-- table's id (location.id, department.id, etc.). Polymorphic reference
-- enforced at the application layer.

CREATE INDEX "journalLineDimension_journalLineId_idx" ON "journalLineDimension"("journalLineId");
CREATE INDEX "journalLineDimension_dimensionId_idx" ON "journalLineDimension"("dimensionId");
CREATE INDEX "journalLineDimension_companyId_idx" ON "journalLineDimension"("companyId");

ALTER TABLE "journalLineDimension" ENABLE ROW LEVEL SECURITY;

-- Immutable: SELECT, INSERT, and DELETE only, matching journalLine pattern

CREATE POLICY "SELECT" ON "public"."journalLineDimension"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."journalLineDimension"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_create')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."journalLineDimension"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_delete')
    )::text[]
  )
);


CREATE OR REPLACE VIEW "dimensionValues" WITH(SECURITY_INVOKER=true) AS
  SELECT
    d."id" AS "dimensionId",
    d."name" AS "dimensionName",
    d."entityType",
    d."companyId",
    dv."id" AS "valueId",
    dv."name" AS "valueName"
  FROM "dimension" d
  LEFT JOIN "dimensionValue" dv ON dv."dimensionId" = d."id"
  WHERE d."entityType" = 'Custom';
