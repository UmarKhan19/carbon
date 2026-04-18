# Shelf → StorageUnit leftover rename sweep

Scope: red + yellow audit items except activity-log strings in `post-stock-transfer/index.ts` (kept for historical consistency) and `companySettings.shelfLabelSize` (kept as physical label concept).

Note: Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Plan

- [x] 1. `apps/erp/app/modules/items/types.ts` — renamed `ItemShelfQuantities` → `ItemStorageUnitQuantities`
- [x] 2. `apps/erp/app/stores/stock-transfer.ts` — renamed store exports (selectedToItemStorageUnitIds, toggleToItemStorageUnitSelection, isToItemStorageUnitSelected, hasTransferLinesToItemStorageUnit, clearSelectedToItemStorageUnits)
- [x] 3. `StockTransferWizard.tsx` — imports + `transferLinesToThisItemStorageUnit`
- [x] 4. `StockTransferLines.tsx` — `toStorageUnitComparison`
- [x] 5. `InventoryStorageUnits.tsx` — `selectedStorageUnitId` / `setSelectedStorageUnitId` + type import + `InventoryStorageUnitsProps`
- [x] 6. `InventoryDetails.tsx` — type import
- [x] 7. `KanbanForm.tsx` — `setStorageUnitId`
- [x] 8. `ShipmentLines.tsx` — `getStorageUnitFromBatchNumber`
- [x] 9. `ReceiptLines.tsx` — `newStorageUnitModal`
- [x] 10. `JobHeader.tsx` — `setDefaultStorageUnitId`
- [x] 11. `JobMaterialsTable.tsx` — `hasStorageUnitQuantityFlag`
- [x] 12. `stock-transfer+/$id.scan.$lineId.tsx` — error strings + `currentStorageUnitId`
- [x] 13. `supabase/functions/issue/index.ts` — `proposedStorageUnitId`, `currentStorageUnitQuantity`, `allStorageUnitQuantities`, `finalStorageUnitId`, `bestStorageUnit`
- [x] 14. `JobOperation.tsx:1119` — `Default Storage Unit`
- [x] 15. `KanbanLabelPDF.tsx:183` — comment updated

## Review

All 13 red/yellow action items landed mechanically. Kept out of scope per user decision:
- Activity-log strings `"From Shelf"` / `"To Shelf"` / `"Shelf"` in `post-stock-transfer/index.ts` (kept for historical audit-trail consistency)
- `companySettings.shelfLabelSize` column (kept as physical label concept)

Follow-ups for the user:
1. Run `lingui:extract` + `lingui:compile` to pick up the `Default Shelf` → `Default Storage Unit` msgid change in MES.
2. After DB migrations fully apply, regenerate Supabase types (`types.ts` / `swagger-docs-schema.ts` / `functions/lib/types.ts`) — stale references to `purchaseInvoiceLine.shelfId` and `warehouseTransferLine_*ShelfId_fkey` will drop out.

Verified with grep: no remaining `shelf`/`Shelf`/`shelves` identifiers in `apps/` or `packages/` outside of:
- `apps/erp/app/routes/api+/data/quality.ts` (legit "shelf-life" material domain)
- `packages/database/supabase/functions/post-stock-transfer/index.ts` (audit-log strings — intentionally kept)
- Historical SQL migrations (immutable)
- Generated `types.ts` / `swagger-docs-schema.ts` (regeneration pending)
- `llm/cache/*` and `llm/recommendations/*` (stale doc cache)
