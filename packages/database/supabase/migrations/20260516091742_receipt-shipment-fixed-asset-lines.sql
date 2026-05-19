CREATE TABLE "receiptFixedAssetLine" (
  "id" TEXT NOT NULL DEFAULT id(),
  "receiptId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "received" BOOLEAN NOT NULL DEFAULT true,
  "serialNumber" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  CONSTRAINT "receiptFixedAssetLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "receiptFixedAssetLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "receiptFixedAssetLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchaseOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "receiptFixedAssetLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "receiptFixedAssetLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "receiptFixedAssetLine_receiptId_idx" ON "receiptFixedAssetLine" ("receiptId");

ALTER TABLE "receiptFixedAssetLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "receiptFixedAssetLine" FOR SELECT USING (
  "companyId" = ANY(get_company_ids_for_user(auth.uid()::text)::text[])
);

CREATE POLICY "INSERT" ON "receiptFixedAssetLine" FOR INSERT WITH CHECK (
  "companyId" = ANY(get_company_ids_for_user(auth.uid()::text)::text[])
);

CREATE POLICY "UPDATE" ON "receiptFixedAssetLine" FOR UPDATE USING (
  "companyId" = ANY(get_company_ids_for_user(auth.uid()::text)::text[])
);

CREATE POLICY "DELETE" ON "receiptFixedAssetLine" FOR DELETE USING (
  "companyId" = ANY(get_company_ids_for_user(auth.uid()::text)::text[])
);

CREATE TABLE "shipmentFixedAssetLine" (
  "id" TEXT NOT NULL DEFAULT id(),
  "shipmentId" TEXT NOT NULL,
  "salesOrderLineId" TEXT NOT NULL,
  "shipped" BOOLEAN NOT NULL DEFAULT true,
  "serialNumber" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  CONSTRAINT "shipmentFixedAssetLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipmentFixedAssetLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shipmentFixedAssetLine_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "salesOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shipmentFixedAssetLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shipmentFixedAssetLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "shipmentFixedAssetLine_shipmentId_idx" ON "shipmentFixedAssetLine" ("shipmentId");

ALTER TABLE "shipmentFixedAssetLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "shipmentFixedAssetLine" FOR SELECT USING (
  "companyId" = ANY(get_company_ids_for_user(auth.uid()::text)::text[])
);

CREATE POLICY "INSERT" ON "shipmentFixedAssetLine" FOR INSERT WITH CHECK (
  "companyId" = ANY(get_company_ids_for_user(auth.uid()::text)::text[])
);

CREATE POLICY "UPDATE" ON "shipmentFixedAssetLine" FOR UPDATE USING (
  "companyId" = ANY(get_company_ids_for_user(auth.uid()::text)::text[])
);

CREATE POLICY "DELETE" ON "shipmentFixedAssetLine" FOR DELETE USING (
  "companyId" = ANY(get_company_ids_for_user(auth.uid()::text)::text[])
);
