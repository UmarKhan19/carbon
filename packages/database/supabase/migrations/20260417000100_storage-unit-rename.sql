-- ============================================================================
-- M2: Rename `shelf` -> `storageUnit` and `shelfId` -> `storageUnitId` across
-- every referencing table.
--
-- Strategy for minimum blast radius within this migration:
--   1. Drop every PL/pgSQL function whose LATEST body references `shelf` /
--      `shelfId` / a `*ShelfId` column. Function bodies are stored as text
--      and are NOT auto-rewritten by `ALTER TABLE ... RENAME`, so they must
--      be dropped and recreated (recreation lives in M4). CASCADE drops the
--      attached triggers as well.
--   2. Drop every view whose LATEST definition selects from `shelf` or
--      projects a shelf-named alias. Views ARE auto-updated for the
--      underlying relation reference, but exposed aliases like "shelfName",
--      "fromShelfName", "toShelfName" would remain stale; easier to drop
--      and recreate in M4 with the correct aliases.
--   3. Rename the table itself. RLS policies, indexes, constraints, and
--      default expressions travel with it automatically.
--   4. Cosmetic rename of the storageUnit table's own indexes / FK
--      constraint / unique constraint names so they follow the new name.
--   5. Rename `shelfId` / `defaultShelfId` / `fromShelfId` / `toShelfId` /
--      `shelfIds` columns on all referencing tables, and rename their FK
--      constraint and index names.
--
-- M2 is paired with M4 (`..._storage-unit-recreate-dependents.sql`) which
-- recreates every object dropped here with `storageUnit` / `storageUnitId`
-- identifiers. M2 + M4 must ALWAYS be applied together; running M2 alone
-- leaves inventory/job/quote/kanban/gauge queries broken.
--
-- Only functions / views whose latest body was verified to contain a
-- shelf-related identifier are dropped here. Functions like
-- `get_inventory_quantities`, `get_item_quantities`, `update_stock_transfer_status`,
-- `update_receipt_line_*_tracking`, and `update_shipment_line_*_tracking`
-- were checked and do NOT reference shelf in their latest bodies, so they
-- stay untouched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drop dependent functions (each verified to reference shelf in its
--    latest body). CASCADE drops any attached triggers.
-- ----------------------------------------------------------------------------

-- Job operation / completion
DROP FUNCTION IF EXISTS finish_job_operation() CASCADE;
DROP FUNCTION IF EXISTS sync_finish_job_operation(TEXT, TEXT, JSONB, JSONB) CASCADE;

-- Quantity-on-hand / tracking aggregates that project shelfId
DROP FUNCTION IF EXISTS get_item_quantities_by_tracking_id(TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_job_quantity_on_hand(TEXT, TEXT, TEXT) CASCADE;

-- Method / job / quote tree RPCs that return shelfId columns
DROP FUNCTION IF EXISTS get_method_tree(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_job_method(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_job_methods_by_method_id(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_quote_methods(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_quote_methods_by_method_id(TEXT) CASCADE;

-- Stock-transfer wizard helpers. M4 recreates these as
-- get_item_storage_unit_requirements_by_location[_and_item].
DROP FUNCTION IF EXISTS get_item_shelf_requirements_by_location(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_item_shelf_requirements_by_location_and_item(TEXT, TEXT, TEXT) CASCADE;

-- ----------------------------------------------------------------------------
-- 2. Drop dependent views. CASCADE handles view-on-view chains.
-- ----------------------------------------------------------------------------

-- Production / job / method views
DROP VIEW IF EXISTS "jobs" CASCADE;
DROP VIEW IF EXISTS "jobMaterialWithMakeMethodId" CASCADE;
DROP VIEW IF EXISTS "quoteMaterialWithMakeMethodId" CASCADE;

-- Stock transfer
DROP VIEW IF EXISTS "stockTransferLines" CASCADE;

-- Shipment / receipt
DROP VIEW IF EXISTS "shipmentLines" CASCADE;
DROP VIEW IF EXISTS "receipts" CASCADE;
DROP VIEW IF EXISTS "receiptLines" CASCADE;

-- Sales invoice
DROP VIEW IF EXISTS "salesInvoiceLines" CASCADE;
DROP VIEW IF EXISTS "salesInvoiceLocations" CASCADE;
DROP VIEW IF EXISTS "salesInvoices" CASCADE;

-- Sales / purchase orders
DROP VIEW IF EXISTS "salesOrderLines" CASCADE;
DROP VIEW IF EXISTS "salesOrders" CASCADE;
DROP VIEW IF EXISTS "purchaseOrders" CASCADE;
DROP VIEW IF EXISTS "purchaseOrderLines" CASCADE;
DROP VIEW IF EXISTS "purchaseInvoices" CASCADE;

-- Demand-planning open-line views
DROP VIEW IF EXISTS "openSalesOrderLines" CASCADE;
DROP VIEW IF EXISTS "openJobMaterialLines" CASCADE;
DROP VIEW IF EXISTS "openProductionOrders" CASCADE;
DROP VIEW IF EXISTS "openPurchaseOrderLines" CASCADE;

-- Quality
DROP VIEW IF EXISTS "gauges" CASCADE;
DROP VIEW IF EXISTS "gaugeCalibrationRecords" CASCADE;

-- Kanban
DROP VIEW IF EXISTS "kanbans" CASCADE;

-- Item detail views (consumables / materials / parts / services / tools)
-- These select pickMethod.defaultShelfId for pick-location display.
DROP VIEW IF EXISTS "consumables" CASCADE;
DROP VIEW IF EXISTS "materials" CASCADE;
DROP VIEW IF EXISTS "parts" CASCADE;
DROP VIEW IF EXISTS "services" CASCADE;
DROP VIEW IF EXISTS "tools" CASCADE;

-- ----------------------------------------------------------------------------
-- 3. Rename the table. RLS policies, indexes, FKs, and RLS enablement all
--    travel with it.
-- ----------------------------------------------------------------------------
ALTER TABLE "shelf" RENAME TO "storageUnit";

-- ----------------------------------------------------------------------------
-- 4. Cosmetic: rename the table's own indexes and constraints so names
--    follow the new table name.
-- ----------------------------------------------------------------------------
ALTER INDEX IF EXISTS "shelf_id_locationId_idx"  RENAME TO "storageUnit_id_locationId_idx";
ALTER INDEX IF EXISTS "shelf_warehouseId_idx"    RENAME TO "storageUnit_warehouseId_idx";
ALTER INDEX IF EXISTS "shelf_companyId_idx"      RENAME TO "storageUnit_companyId_idx";

ALTER TABLE "storageUnit" RENAME CONSTRAINT "shelf_locationId_fkey"    TO "storageUnit_locationId_fkey";
ALTER TABLE "storageUnit" RENAME CONSTRAINT "shelf_warehouseId_fkey"   TO "storageUnit_warehouseId_fkey";
ALTER TABLE "storageUnit" RENAME CONSTRAINT "shelf_companyId_fkey"     TO "storageUnit_companyId_fkey";
ALTER TABLE "storageUnit" RENAME CONSTRAINT "shelf_createdBy_fkey"     TO "storageUnit_createdBy_fkey";
ALTER TABLE "storageUnit" RENAME CONSTRAINT "shelf_updatedBy_fkey"     TO "storageUnit_updatedBy_fkey";
ALTER TABLE "storageUnit" RENAME CONSTRAINT "shelf_name_locationId_key" TO "storageUnit_name_locationId_key";

-- ----------------------------------------------------------------------------
-- 5. Rename shelfId / defaultShelfId / fromShelfId / toShelfId / shelfIds
--    columns and their FK constraint & index names on every referencing
--    table.
-- ----------------------------------------------------------------------------

-- pickMethod.defaultShelfId
ALTER TABLE "pickMethod" RENAME COLUMN "defaultShelfId" TO "defaultStorageUnitId";
ALTER TABLE "pickMethod" RENAME CONSTRAINT "pickMethod_shelfId_fkey" TO "pickMethod_defaultStorageUnitId_fkey";
ALTER INDEX  IF EXISTS "pickMethod_shelfId_idx" RENAME TO "pickMethod_defaultStorageUnitId_idx";

-- itemLedger.shelfId
ALTER TABLE "itemLedger" RENAME COLUMN "shelfId" TO "storageUnitId";
ALTER TABLE "itemLedger" RENAME CONSTRAINT "itemLedger_shelfId_fkey" TO "itemLedger_storageUnitId_fkey";

-- receiptLine.shelfId
ALTER TABLE "receiptLine" RENAME COLUMN "shelfId" TO "storageUnitId";
ALTER TABLE "receiptLine" RENAME CONSTRAINT "receiptLine_shelfId_fkey" TO "receiptLine_storageUnitId_fkey";

-- purchaseOrderLine.shelfId
ALTER TABLE "purchaseOrderLine" RENAME COLUMN "shelfId" TO "storageUnitId";
ALTER TABLE "purchaseOrderLine" RENAME CONSTRAINT "purchaseOrderLine_shelfId_fkey" TO "purchaseOrderLine_storageUnitId_fkey";

-- purchaseInvoiceLine.shelfId (historic constraint name has trailing "s")
ALTER TABLE "purchaseInvoiceLine" RENAME COLUMN "shelfId" TO "storageUnitId";
ALTER TABLE "purchaseInvoiceLine" RENAME CONSTRAINT "purchaseInvoiceLines_shelfId_fkey" TO "purchaseInvoiceLine_storageUnitId_fkey";

-- salesOrderLine.shelfId
ALTER TABLE "salesOrderLine" RENAME COLUMN "shelfId" TO "storageUnitId";
ALTER TABLE "salesOrderLine" RENAME CONSTRAINT "salesOrderLine_shelfId_fkey" TO "salesOrderLine_storageUnitId_fkey";

-- salesInvoiceLine.shelfId
ALTER TABLE "salesInvoiceLine" RENAME COLUMN "shelfId" TO "storageUnitId";
ALTER TABLE "salesInvoiceLine" RENAME CONSTRAINT "salesInvoiceLine_shelfId_fkey" TO "salesInvoiceLine_storageUnitId_fkey";

-- shipmentLine.shelfId
ALTER TABLE "shipmentLine" RENAME COLUMN "shelfId" TO "storageUnitId";
ALTER TABLE "shipmentLine" RENAME CONSTRAINT "shipmentLine_shelfId_fkey" TO "shipmentLine_storageUnitId_fkey";

-- gauge.shelfId
ALTER TABLE "gauge" RENAME COLUMN "shelfId" TO "storageUnitId";
ALTER TABLE "gauge" RENAME CONSTRAINT "gauge_shelfId_fkey" TO "gauge_storageUnitId_fkey";
ALTER INDEX IF EXISTS "gauge_shelfId_idx" RENAME TO "gauge_storageUnitId_idx";

-- kanban.shelfId
ALTER TABLE "kanban" RENAME COLUMN "shelfId" TO "storageUnitId";
ALTER TABLE "kanban" RENAME CONSTRAINT "kanban_shelfId_fkey" TO "kanban_storageUnitId_fkey";

-- job.shelfId
ALTER TABLE "job" RENAME COLUMN "shelfId" TO "storageUnitId";
ALTER TABLE "job" RENAME CONSTRAINT "job_shelfId_fkey" TO "job_storageUnitId_fkey";

-- jobMaterial.shelfId + jobMaterial.defaultShelf boolean flag
ALTER TABLE "jobMaterial" RENAME COLUMN "shelfId" TO "storageUnitId";
ALTER TABLE "jobMaterial" RENAME COLUMN "defaultShelf" TO "defaultStorageUnit";
ALTER TABLE "jobMaterial" RENAME CONSTRAINT "jobMaterial_shelfId_fkey" TO "jobMaterial_storageUnitId_fkey";

-- quoteMaterial.shelfId
ALTER TABLE "quoteMaterial" RENAME COLUMN "shelfId" TO "storageUnitId";
ALTER TABLE "quoteMaterial" RENAME CONSTRAINT "quoteMaterial_shelfId_fkey" TO "quoteMaterial_storageUnitId_fkey";

-- methodMaterial.shelfIds (JSONB, no FK)
ALTER TABLE "methodMaterial" RENAME COLUMN "shelfIds" TO "storageUnitIds";

-- stockTransferLine.fromShelfId / toShelfId
ALTER TABLE "stockTransferLine" RENAME COLUMN "fromShelfId" TO "fromStorageUnitId";
ALTER TABLE "stockTransferLine" RENAME COLUMN "toShelfId"   TO "toStorageUnitId";
ALTER TABLE "stockTransferLine" RENAME CONSTRAINT "stockTransferLine_fromShelfId_fkey" TO "stockTransferLine_fromStorageUnitId_fkey";
ALTER TABLE "stockTransferLine" RENAME CONSTRAINT "stockTransferLine_toShelfId_fkey"   TO "stockTransferLine_toStorageUnitId_fkey";

-- warehouseTransferLine.fromShelfId / toShelfId
ALTER TABLE "warehouseTransferLine" RENAME COLUMN "fromShelfId" TO "fromStorageUnitId";
ALTER TABLE "warehouseTransferLine" RENAME COLUMN "toShelfId"   TO "toStorageUnitId";
ALTER TABLE "warehouseTransferLine" RENAME CONSTRAINT "warehouseTransferLine_fromShelfId_fkey" TO "warehouseTransferLine_fromStorageUnitId_fkey";
ALTER TABLE "warehouseTransferLine" RENAME CONSTRAINT "warehouseTransferLine_toShelfId_fkey"   TO "warehouseTransferLine_toStorageUnitId_fkey";
