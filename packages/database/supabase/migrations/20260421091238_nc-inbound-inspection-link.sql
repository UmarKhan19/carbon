-- Non-conformance ↔ inbound inspection link.
-- When a lot is Rejected from the inbound inspection flow, the auto-created
-- NCR is linked back to the originating inspection so the issue explorer can
-- deep-link to the lot and MRB can see the sampling context.

CREATE TABLE "nonConformanceInboundInspection" (
  "id" TEXT NOT NULL DEFAULT id(),
  "nonConformanceId" TEXT NOT NULL,
  "inboundInspectionId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "nonConformanceInboundInspection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceInboundInspection_unique"
    UNIQUE ("nonConformanceId", "inboundInspectionId"),
  CONSTRAINT "nonConformanceInboundInspection_nonConformanceId_fkey"
    FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE,
  CONSTRAINT "nonConformanceInboundInspection_inboundInspectionId_fkey"
    FOREIGN KEY ("inboundInspectionId") REFERENCES "inboundInspection"("id") ON DELETE CASCADE,
  CONSTRAINT "nonConformanceInboundInspection_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "nonConformanceInboundInspection_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "nonConformanceInboundInspection_nonConformanceId_idx"
  ON "nonConformanceInboundInspection"("nonConformanceId");
CREATE INDEX "nonConformanceInboundInspection_inboundInspectionId_idx"
  ON "nonConformanceInboundInspection"("inboundInspectionId");

ALTER TABLE "nonConformanceInboundInspection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "nonConformanceInboundInspection"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_view'))::text[]
  )
);
CREATE POLICY "INSERT" ON "nonConformanceInboundInspection"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_create'))::text[]
  )
);
CREATE POLICY "UPDATE" ON "nonConformanceInboundInspection"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_update'))::text[]
  )
);
CREATE POLICY "DELETE" ON "nonConformanceInboundInspection"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_delete'))::text[]
  )
);
