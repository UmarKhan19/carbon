-- Tax Code Mapping: maps itemPostingGroup -> tax engine product tax codes
CREATE TABLE "taxCodeMapping" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "itemPostingGroupId" TEXT NOT NULL,
  "integration" TEXT NOT NULL,
  "taxCode" TEXT NOT NULL,
  "description" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "taxCodeMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "taxCodeMapping_unique" UNIQUE ("itemPostingGroupId", "integration", "companyId"),
  CONSTRAINT "taxCodeMapping_itemPostingGroupId_fkey" FOREIGN KEY ("itemPostingGroupId") REFERENCES "itemPostingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "taxCodeMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "taxCodeMapping_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "taxCodeMapping_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "taxCodeMapping_companyId_integration_idx" ON "taxCodeMapping"("companyId", "integration");

ALTER TABLE "taxCodeMapping" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."taxCodeMapping"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."taxCodeMapping"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."taxCodeMapping"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."taxCodeMapping"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
  )
);

-- Tax Calculation Log: audit trail for external tax calculation requests
CREATE TABLE "taxCalculationLog" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "integration" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'success',
  "totalTax" NUMERIC(12,4),
  "requestSummary" JSONB,
  "responseSummary" JSONB,
  "errorMessage" TEXT,
  "durationMs" INTEGER,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT,

  CONSTRAINT "taxCalculationLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "taxCalculationLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "taxCalculationLog_documentId_idx" ON "taxCalculationLog"("documentId");
CREATE INDEX "taxCalculationLog_companyId_createdAt_idx" ON "taxCalculationLog"("companyId", "createdAt" DESC);

ALTER TABLE "taxCalculationLog" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."taxCalculationLog"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
  )
);
