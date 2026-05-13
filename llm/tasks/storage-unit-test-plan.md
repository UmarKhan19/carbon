# Storage Unit Refactor — Test Plan

Branch: `sid/inventory-storage-revamp`
Scope: renames `shelf` → `storageUnit` across DB, edge functions, ERP, MES; adds hierarchy (`parentId`) and `storageType` (M2M via `storageTypeIds TEXT[]`).

## 0. Pre-test setup

- [ ] Reset DB from `main`, apply all 4 migrations in order (000000 → 000300); confirm no errors.
- [ ] Seed company with: 2 locations, 2 warehouses, ≥ 1 item each of part/material/consumable/tool, 1 make item + method, 1 buy item + supplier, 1 kanban (make), 1 kanban (buy), 1 gauge.
- [ ] Verify `supabase/functions/lib/types.ts` and `packages/database/src/types.ts` regenerated (PR includes both).
- [ ] `pnpm i && pnpm typecheck` (per-package; **do not** run repo-wide `tsc --noEmit`).
- [ ] `pnpm build` on `apps/erp` and `apps/mes`.

---

## 1. Database migrations

### 1.1 M1 — `storageType` table
- [ ] Table exists with columns: `id, name, companyId, createdBy, createdAt, updatedBy, updatedAt, customFields`.
- [ ] FK cascade: delete a test company → `storageType` rows removed.
- [ ] RLS: non-admin user without `parts_create` cannot INSERT; `parts_update`/`parts_delete` enforced.
- [ ] Custom fields registered (query `customFieldTables`).

### 1.2 M2 — rename shelf → storageUnit
Verify all 13 referencing tables now use the new column name and **no** `shelfId`/`shelf*` columns remain (except `defaultShelf` renamed to `defaultStorageUnit`, `shelfIds`→`storageUnitIds`):

- [ ] `itemLedger.storageUnitId`
- [ ] `receiptLine.storageUnitId`
- [ ] `shipmentLine.storageUnitId`
- [ ] `purchaseOrderLine.storageUnitId`
- [ ] `purchaseInvoiceLine.storageUnitId`
- [ ] `salesOrderLine.storageUnitId`
- [ ] `salesInvoiceLine.storageUnitId`
- [ ] `gauge.storageUnitId`
- [ ] `kanban.storageUnitId`
- [ ] `job.storageUnitId`
- [ ] `jobMaterial.storageUnitId`, `jobMaterial.defaultStorageUnit`
- [ ] `quoteMaterial.storageUnitId`
- [ ] `methodMaterial.storageUnitIds` (JSONB/array)
- [ ] `pickMethod.defaultStorageUnitId`
- [ ] `stockTransferLine.fromStorageUnitId`, `toStorageUnitId`
- [ ] `warehouseTransferLine.fromStorageUnitId`, `toStorageUnitId`
- [ ] All old indexes/FK constraints renamed (no dangling `_shelfId_fkey`).
- [ ] Sanity: `SELECT column_name FROM information_schema.columns WHERE column_name ILIKE '%shelf%'` returns 0 rows.

### 1.3 M3 — hierarchy + storage types
- [ ] `storageUnit.parentId TEXT NULL` FK → `storageUnit(id)` ON DELETE RESTRICT.
- [ ] `storageUnit.storageTypeIds TEXT[] NOT NULL DEFAULT ARRAY[]`.
- [ ] CHECK `storageUnit_noSelfParent`: INSERT with `parentId = id` rejected.
- [ ] GIN index `storageUnit_storageTypeIds_idx` present; query `WHERE storageTypeIds @> ARRAY['x']` uses it.
- [ ] **Interceptor: same location.** INSERT child with `locationId` differing from parent → EXCEPTION "must match".
- [ ] **Interceptor: block loc change with children.** UPDATE parent `locationId` while it has children → EXCEPTION; UPDATE on a leaf succeeds.
- [ ] **Interceptor: no cycle.** Create A → B → C, then UPDATE A.parentId = C → EXCEPTION "Cycle detected".
- [ ] Depth guard: contrived chain ≥ 1001 → EXCEPTION "exceeds max depth".
- [ ] View `storageUnits_recursive`: roots have `depth=1`, `ancestorPath=[id]`; leaf has full path; `WHERE ancestorPath @> ARRAY[<root>]` returns subtree.
- [ ] `SECURITY_INVOKER` honored (non-privileged session only sees own company's rows).

### 1.4 M4 — dependent views/functions recreated
Pick each name below and confirm (a) it exists, (b) runs without error, (c) returned columns use `storageUnitId` naming:
- [ ] `finish_job_operation()` — trigger after completing last operation posts issue with `storageUnitId`.
- [ ] `sync_finish_job_operation()`.
- [ ] `get_item_quantities_by_tracking_id()`.
- [ ] `get_job_quantity_on_hand()`.
- [ ] `get_method_tree(methodId)`.
- [ ] `get_job_methods_by_method_id()`, `get_job_method(jobId)`.
- [ ] `get_quote_methods()`, `get_quote_methods_by_method_id()`.
- [ ] `get_item_storage_unit_requirements_by_location(companyId, locationId)`.
- [ ] `get_item_storage_unit_requirements_by_location_and_item(companyId, locationId, itemId)`.
- [ ] All 13 recreated views (kanban, receipts, shipments, stock transfers, warehouse transfers, job materials, method materials, pick method, item ledger, sales/purchase lines): `SELECT * LIMIT 0` succeeds; expected `*StorageUnit*` column names present.

### 1.5 Data preservation
With a snapshot of production-like data (if available) or fresh seed:
- [ ] Row counts before/after for every renamed table match.
- [ ] Spot-check 10 random `itemLedger` rows: `storageUnitId` equals the pre-migration `shelfId`.
- [ ] `pickMethod.defaultStorageUnitId` equals pre-migration `defaultShelfId` for all rows.
- [ ] `methodMaterial.storageUnitIds` array matches pre-migration `shelfIds`.

---

## 2. Supabase edge functions

Test by calling each function (directly or via the ERP action that invokes it):
- [ ] `lib/storage-units.ts#getStorageUnitId()` — returns pickMethod default when line has none.
- [ ] `getStorageUnitWithHighestQuantity()` — returns unit with max on-hand when no default set.
- [ ] `updatePickMethodDefaultStorageUnitIfNeeded()` — after inventory consolidates to one unit, pickMethod default updates.
- [ ] `post-receipt`: line with `storageUnitId` → `itemLedger` row uses that unit; quantity += qty; pickMethod default re-evaluated.
- [ ] `post-shipment`: line with `storageUnitId` → `itemLedger` negative entry on that unit; insufficient qty path still errors cleanly.
- [ ] `post-stock-transfer`: line with `fromStorageUnitId ≠ toStorageUnitId` → two `itemLedger` rows (-qty on from, +qty on to).
- [ ] `post-purchase-invoice` / `post-sales-invoice`: `storageUnitId` on line preserved through invoice posting.
- [ ] `issue`: payload carrying `storageUnitId` writes correct ledger row.
- [ ] `get-method`, `convert`, `create`: output trees include `storageUnitId` (not `shelfId`).
- [ ] Error path: posting with an invalid `storageUnitId` → validation error, no partial writes.

---

## 3. API routes

- [ ] `GET /api/inventory/storage-units?locationId=…` — paginated list; old `/api/inventory/shelves` returns 404.
- [ ] `GET /api/inventory/storage-units-with-quantities?locationId=…&itemId=…` — returns qty on hand per unit.
- [ ] `GET /api/inventory/storage-unit-descendants?id=<parent>` — returns self + descendants.
- [ ] `GET /api/inventory/storage-types` — returns list.
- [ ] `GET /api/inventory/tracked-entities-by-storage-unit?id=…` — returns tracked entities (renamed from by-shelf).
- [ ] `GET /api/kanban/:id` — response uses `storageUnitId` (not `shelfId`).
- [ ] MCP tool metadata: each `inventory_*StorageUnit*` and `items_getItemStorageUnitQuantities` callable; old shelf names removed.

---

## 4. ERP UI — inventory module

### 4.1 Storage units list & hierarchy
- [ ] `/x/inventory/storage-units` renders list from `StorageUnitsTable.tsx`; filter by location/warehouse/type works.
- [ ] Tree rendering uses `storageUnits_recursive` data: expand/collapse, indent matches depth.
- [ ] Create root unit (no parent) at location L → appears at depth 1.
- [ ] Create child under root → `parentId` saved; `locationId` inherited/forced.
- [ ] Try creating child with different location via form → blocked (server-side) with clear error.
- [ ] Edit a unit to move it under a new parent in same location → succeeds; tree updates.
- [ ] Edit a unit to change `locationId` while it has children → blocked with clear error.
- [ ] Multi-select storage types → `storageTypeIds` persisted; display chips render type names.
- [ ] Delete `/x/inventory/storage-units/delete/:id`: unit with no refs deletes; unit with children blocked (FK RESTRICT) with user-friendly message.
- [ ] Delete path when referenced by jobs/orders/ledger: confirm copy matches server behavior (cascade service `deleteStorageUnitCascade` if used, else referential block).

### 4.2 Storage types list
- [ ] `/x/inventory/storage-types` list renders.
- [ ] Create, edit, delete storage type. Deleting a type that appears in `storageUnit.storageTypeIds`: verify documented behavior (array reconciled on next write vs. immediate cleanup).

### 4.3 Inventory details
- [ ] `InventoryStorageUnits.tsx` tab on item inventory page: lists qty per unit; navigation from row → unit detail works.
- [ ] `InventoryActivity` log shows `storageUnitId` columns for receipts/shipments/transfers.

### 4.4 Kanbans
- [ ] Create kanban with storageUnitId (`KanbanForm`); QR label PDF (`KanbanLabelPDF`) renders unit name (not "Shelf:").
- [ ] Kanban scan route creates PO/job with correct `storageUnitId`.
- [ ] KanbansTable column displays storage unit name.

### 4.5 Receipts / shipments
- [ ] Create receipt lines with storageUnitId dropdown (default pulls from pickMethod default).
- [ ] Post receipt → inventory updates on selected unit.
- [ ] Create and post shipment lines similarly; insufficient qty path still errors cleanly.

### 4.6 Stock transfers (wizard)
- [ ] Wizard loads with `fromStorageUnitId`/`toStorageUnitId` selectors.
- [ ] `toggleToItemShelfSelection`/`isToItemShelfSelected` behave correctly (still using the old function names internally is acceptable, but params must be `storageUnitId`).
- [ ] Lines with same from+to unit collapse into single line (addTransferLine logic).
- [ ] Wizard confirm → transfer posts; both ledger entries correct.
- [ ] Scan flow `/x/stock-transfer/:id/scan/:lineId` uses storageUnitId.
- [ ] PDF `StockTransferPDF` renders from/to unit names.

### 4.7 Warehouse transfers
- [ ] Line form select → `fromStorageUnitId`/`toStorageUnitId` populated; post works.

### 4.8 Sales / purchase orders & invoices
- [ ] PO line form: storageUnitId select on inventory items; preserved through conversion to receipt/invoice.
- [ ] SO line form: storageUnitId on stock reservations; preserved through shipment/invoice.
- [ ] `PurchaseInvoiceLineForm` / `SalesInvoiceLineForm` display unit.
- [ ] Chat tool `create-purchase-order` returns lines with `storageUnitId`.

### 4.9 Jobs / production
- [ ] Create job: header accepts storageUnitId; `JobHeader` / `JobProperties` render unit name.
- [ ] `JobMaterialsTable`: each material row has storageUnitId select; `defaultStorageUnit` boolean still togglable.
- [ ] `JobBillOfMaterial`: material edits persist storageUnitId.
- [ ] Job session material issue (`$jobId.materials.session.new`) uses storageUnitId.
- [ ] Complete last operation → `finish_job_operation` trigger issues inventory to `job.storageUnitId`.
- [ ] Bulk job creation (`job/bulk.new`): storageUnitId defaulted from pickMethod.
- [ ] MRP planning update (`planning.update`) preserves storageUnitId on generated demand.

### 4.10 Items — pick method & BOM
- [ ] `PickMethodForm`: `defaultStorageUnitId` saves; shelf label nowhere visible.
- [ ] `BillOfMaterial` / `QuoteBillOfMaterial`: material rows track storageUnitIds.
- [ ] Item inventory pages (`part/$itemId.inventory`, `material`, `consumable`, `tool`): unit breakdown renders; qty details drilldown works.

### 4.11 Quality — gauges
- [ ] Gauge form: storageUnitId select; list renders unit name.

---

## 5. MES

- [ ] `AdjustInventory` component: unit selector works end-to-end; ledger entries correct.
- [ ] `JobOperation` UI: material issue uses storageUnitId.
- [ ] `apps/mes/app/services/inventory.service.ts`: list storage units by location.

---

## 6. End-to-end flows (regressions)

Run each flow on a clean seed and verify resulting balances.

### 6.1 Receive → transfer → ship
1. Receive 100 ea of Item X to unit A.
2. Transfer 40 from unit A → unit B.
3. Ship 30 from unit B.
4. Expected: A=60, B=10; item ledger 4 rows; totals balance.

### 6.2 Buy kanban replenishment
1. Scan buy kanban for Item Y (default unit = K).
2. PO line auto-created with `storageUnitId = K`.
3. Receipt to K; kanban quantity reflects receipt.

### 6.3 Make kanban replenishment
1. Scan make kanban for Item Z (default unit = M).
2. Job auto-created with `storageUnitId = M`.
3. Complete final op → `finish_job_operation` issues output to M.

### 6.4 Sales order → job → ship
1. Create SO line for Make-to-Order item, storageUnitId = S.
2. Convert to job; job keeps S.
3. Complete job; inventory on S.
4. Ship from S; invoice; ledger reconciles.

### 6.5 Hierarchy-aware rollup
1. Create tree: Warehouse W → Zone Z (parent) → Bin B1, Bin B2 (children).
2. Receive to B1 and B2.
3. Query `storageUnits_recursive WHERE ancestorPath @> ARRAY[<Z.id>]` → both bins returned; UI rollup on Zone shows summed quantity (if feature implemented — otherwise confirm the view returns correct data for future use).

---

## 7. Locale / copy

- [ ] `/x/inventory/storage-units` and `/x/inventory/storage-types` labels render in `en` (plus at least one other locale that's commonly tested, e.g., `es`, `fr`).
- [ ] No remaining UI strings read "Shelf" in ERP inventory module (aside from possibly audit trail historical labels).

---

## 8. Back-compat / cleanup

- [ ] Grep codebase for `shelfId`, `shelves`, `fromShelf`, `toShelf` — only remaining hits should be: audit trail labels, migration SQL, tests for old state, renamed store method names (acceptable) — document anything intentional.
- [ ] Old routes `/x/inventory/shelves*` return 404 (no stale route file).
- [ ] MCP `tool-metadata.json` no longer advertises any `*Shelf*` tool.

---

## 9. Performance / safety spot checks

- [ ] Query plan for `storageUnits_recursive` with ~1000 nodes: `EXPLAIN ANALYZE` finishes < 200ms.
- [ ] Inserting 100 child units under one parent: trigger overhead acceptable (< 1s total).
- [ ] Cycle check on 1000-node linear chain does not blow past the 1000-depth guard incorrectly for valid trees.
- [ ] RLS: second company's storage units invisible across all listed APIs.

---

## 10. Rollback drill (optional but recommended)

- [ ] From a snapshot taken post-migration, exercise a production-like rollback path (restore snapshot) and confirm app still functions on `main`.
- [ ] Document that migrations are **not** reversible in-place (M4 drops+recreates functions/views; any custom DB objects built on the old names must be re-examined).
