# MRP Refactoring — Level-by-Level Processing with Inventory Netting

Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Phase 1: Bulk Data Pre-loading
- [x] 1.1 Bulk-load item metadata (replenishmentSystem, leadTime) — replace per-item fetchItemMetadata
- [x] 1.2 Bulk-load inventory (itemLedger SUM by itemId+locationId)
- [x] 1.3 Bulk-load all BOMs (activeMakeMethods view + methodMaterial filtered to active methods)
- [x] 1.4 Build supply maps from already-fetched production/purchase order data

## Phase 2: Level-by-Level Processing with Inventory Netting
- [x] 2.1 Compute Low Level Codes from pre-loaded BOM structure
- [x] 2.2 Collect all independent demands into grossDemand map (no BOM explosion yet)
- [x] 2.3 Implement level-by-level processor: aggregate → net against on-hand → propagate net requirement to children
- [x] 2.4 Track BOM-derived demand separately; write only BOM-derived to demandForecast
- [x] 2.5 Keep demandActual and supplyActual writes unchanged

## Phase 3: Performance
- [x] 3.1 Chunked batch writes (500 rows per batch)
- [x] 3.2 Removed per-item RPC calls (get_method_tree), per-item metadata fetches

## Phase 4: Cleanup
- [x] 4.1 Removed dead code (fetchItemMetadata, fetchBomRequirements, processRequirement, traverseBomTree, BomNode, ItemRequirement types)
- [x] 4.2 Removed unused variables (parentItemByMethodId, productionSupplyByLocationItem, purchaseSupplyByLocationItem)
- [ ] 4.3 Verify planning views still produce correct results (requires deployment)

## Review
(to be filled after verification)
