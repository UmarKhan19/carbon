-- Add covering indexes for assignee FKs on tables with confirmed "assigned to me" query patterns.
--
-- Validated call sites (all filter on assignee + companyId):
--   job                  - apps/erp/app/routes/x+/production+/_index.tsx:113
--   maintenanceDispatch  - apps/mes/app/services/maintenance.service.ts:22
--                          apps/erp/app/routes/x+/resources+/_index.tsx:118
--   purchaseOrder        - apps/erp/app/modules/purchasing/purchasing.service.ts:320
--   supplierQuote        - apps/erp/app/modules/purchasing/purchasing.service.ts:325
--   purchaseInvoice      - apps/erp/app/modules/purchasing/purchasing.service.ts:330
--
-- Composite (assignee, companyId) matches the query shape and mirrors the
-- existing jobOperation_assignee_companyId_idx convention from 20250122225222.
-- Other tables with an unindexed assignee FK (customer, supplier, item,
-- procedure, qualityDocument, receipt, shipment, salesOrderShipment,
-- stockTransfer, training, purchasingRfq) have no confirmed filter-by-assignee
-- query path today and are intentionally skipped.

CREATE INDEX IF NOT EXISTS "job_assignee_companyId_idx"
  ON "job" ("assignee", "companyId");

CREATE INDEX IF NOT EXISTS "maintenanceDispatch_assignee_companyId_idx"
  ON "maintenanceDispatch" ("assignee", "companyId");

CREATE INDEX IF NOT EXISTS "purchaseOrder_assignee_companyId_idx"
  ON "purchaseOrder" ("assignee", "companyId");

CREATE INDEX IF NOT EXISTS "supplierQuote_assignee_companyId_idx"
  ON "supplierQuote" ("assignee", "companyId");

CREATE INDEX IF NOT EXISTS "purchaseInvoice_assignee_companyId_idx"
  ON "purchaseInvoice" ("assignee", "companyId");
