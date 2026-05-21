-- New documentSourceType values used by the cascading-default-attachment system.
-- "Company" tags company-wide defaults; "Supplier" tags per-supplier defaults;
-- "Item" tags per-item defaults. Used to scope storage paths + audit context.
ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Company';
ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Supplier';
ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Item';


-- ============================================================================
-- Per-PO ad-hoc attachments (drag-and-drop on the finalize modal)
-- ============================================================================
CREATE TABLE "purchaseOrderAttachment" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "purchaseOrderId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "shareOnSend" BOOLEAN NOT NULL DEFAULT true,
  "isLocked" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "purchaseOrderAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchaseOrderAttachment_unique" UNIQUE ("purchaseOrderId", "documentId"),
  CONSTRAINT "purchaseOrderAttachment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchaseOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "purchaseOrderAttachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE,
  CONSTRAINT "purchaseOrderAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "purchaseOrderAttachment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL
);

CREATE INDEX "purchaseOrderAttachment_purchaseOrderId_idx" ON "purchaseOrderAttachment" ("purchaseOrderId");
CREATE INDEX "purchaseOrderAttachment_companyId_idx" ON "purchaseOrderAttachment" ("companyId");

ALTER TABLE "purchaseOrderAttachment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view purchaseOrderAttachment"
  ON "purchaseOrderAttachment" FOR SELECT USING (
    has_company_permission('purchasing_view', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_create can insert purchaseOrderAttachment"
  ON "purchaseOrderAttachment" FOR INSERT WITH CHECK (
    has_company_permission('purchasing_create', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_update can update purchaseOrderAttachment"
  ON "purchaseOrderAttachment" FOR UPDATE USING (
    has_company_permission('purchasing_update', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_delete can delete purchaseOrderAttachment"
  ON "purchaseOrderAttachment" FOR DELETE USING (
    has_company_permission('purchasing_delete', "companyId") AND
    has_role('employee', "companyId")
  );


-- ============================================================================
-- Company-level default attachments (cascade to every PO)
-- ============================================================================
CREATE TABLE "companyDefaultAttachment" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "companyId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "shareOnSend" BOOLEAN NOT NULL DEFAULT true,
  "isLocked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "companyDefaultAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "companyDefaultAttachment_unique" UNIQUE ("companyId", "documentId"),
  CONSTRAINT "companyDefaultAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "companyDefaultAttachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE,
  CONSTRAINT "companyDefaultAttachment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL
);

CREATE INDEX "companyDefaultAttachment_companyId_idx" ON "companyDefaultAttachment" ("companyId");

ALTER TABLE "companyDefaultAttachment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view companyDefaultAttachment"
  ON "companyDefaultAttachment" FOR SELECT USING (
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with settings_create can insert companyDefaultAttachment"
  ON "companyDefaultAttachment" FOR INSERT WITH CHECK (
    has_company_permission('settings_create', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with settings_update can update companyDefaultAttachment"
  ON "companyDefaultAttachment" FOR UPDATE USING (
    has_company_permission('settings_update', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with settings_delete can delete companyDefaultAttachment"
  ON "companyDefaultAttachment" FOR DELETE USING (
    has_company_permission('settings_delete', "companyId") AND
    has_role('employee', "companyId")
  );


-- ============================================================================
-- Supplier-level default attachments (cascade to POs for that supplier)
-- ============================================================================
CREATE TABLE "supplierDefaultAttachment" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "supplierId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "shareOnSend" BOOLEAN NOT NULL DEFAULT true,
  "isLocked" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "supplierDefaultAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplierDefaultAttachment_unique" UNIQUE ("supplierId", "documentId"),
  CONSTRAINT "supplierDefaultAttachment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE CASCADE,
  CONSTRAINT "supplierDefaultAttachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE,
  CONSTRAINT "supplierDefaultAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "supplierDefaultAttachment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL
);

CREATE INDEX "supplierDefaultAttachment_supplierId_idx" ON "supplierDefaultAttachment" ("supplierId");
CREATE INDEX "supplierDefaultAttachment_companyId_idx" ON "supplierDefaultAttachment" ("companyId");

ALTER TABLE "supplierDefaultAttachment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view supplierDefaultAttachment"
  ON "supplierDefaultAttachment" FOR SELECT USING (
    has_company_permission('purchasing_view', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_create can insert supplierDefaultAttachment"
  ON "supplierDefaultAttachment" FOR INSERT WITH CHECK (
    has_company_permission('purchasing_create', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_update can update supplierDefaultAttachment"
  ON "supplierDefaultAttachment" FOR UPDATE USING (
    has_company_permission('purchasing_update', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_delete can delete supplierDefaultAttachment"
  ON "supplierDefaultAttachment" FOR DELETE USING (
    has_company_permission('purchasing_delete', "companyId") AND
    has_role('employee', "companyId")
  );


-- ============================================================================
-- Item-level default attachments (cascade to POs containing that item)
-- ============================================================================
CREATE TABLE "itemDefaultAttachment" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "itemId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "shareOnSend" BOOLEAN NOT NULL DEFAULT true,
  "isLocked" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "itemDefaultAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "itemDefaultAttachment_unique" UNIQUE ("itemId", "documentId"),
  CONSTRAINT "itemDefaultAttachment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "itemDefaultAttachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE,
  CONSTRAINT "itemDefaultAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "itemDefaultAttachment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL
);

CREATE INDEX "itemDefaultAttachment_itemId_idx" ON "itemDefaultAttachment" ("itemId");
CREATE INDEX "itemDefaultAttachment_companyId_idx" ON "itemDefaultAttachment" ("companyId");

ALTER TABLE "itemDefaultAttachment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view itemDefaultAttachment"
  ON "itemDefaultAttachment" FOR SELECT USING (
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with parts_create can insert itemDefaultAttachment"
  ON "itemDefaultAttachment" FOR INSERT WITH CHECK (
    has_company_permission('parts_create', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with parts_update can update itemDefaultAttachment"
  ON "itemDefaultAttachment" FOR UPDATE USING (
    has_company_permission('parts_update', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete itemDefaultAttachment"
  ON "itemDefaultAttachment" FOR DELETE USING (
    has_company_permission('parts_delete', "companyId") AND
    has_role('employee', "companyId")
  );
