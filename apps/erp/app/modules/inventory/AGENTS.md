# Inventory Module

Tracks item quantities across locations and storage units. Manages receipts, shipments, stock transfers, warehouse transfers, kanbans, picking lists, serial/batch/lot tracking, and traceability (lineage graphs).

## Key Domain Concepts

- **Storage Units** — hierarchical containers (bins, shelves, racks, zones) within a location. Tree structure via `parentId`. Items are stored at leaf or any level.
- **Tracked Entities** — serial/batch/lot-tracked items get `trackedEntity` records with attributes, status, and quantity. Batch items have `batchProperty` definitions.
- **Receipts** — inbound inventory from POs or production; lines link to `purchaseOrderLine` or jobs. Receipt posting creates item ledger entries and tracked entities.
- **Shipments** — outbound inventory to customers; lines link to sales order lines.
- **Stock Transfers** — move inventory between storage units within the same location.
- **Warehouse Transfers** — move inventory between locations (creates paired receipt/shipment).
- **Item Ledger** — append-only log of every inventory movement (the `itemLedger` table). `getItemLedgerPage` provides paginated history.
- **Kanbans** — pull-based replenishment signals between storage units.

## Safety

### Always
- Use `insertManualInventoryAdjustment` for quantity changes — it creates proper ledger entries and handles tracked entity updates.
- Scope by `companyId` and `locationId` — inventory is location-scoped.
- Use the `get_inventory_quantities` RPC (via `getInventoryItems`) for current quantities — never sum ledger entries manually.

### Ask First
- Deleting storage units (cascade deletes children; `deleteStorageUnitCascade` exists but is destructive).
- Manual inventory adjustments on tracked (serial/batch) items — these create/modify tracked entities.

### Never
- Directly INSERT into `itemLedger` — always go through service functions that maintain consistency.
- Delete receipt lines that have posted tracked entities without cleaning up the entities first.

## Key Data Model

| Table / View | Purpose |
|---|---|
| `itemLedger` | Append-only movement log: item, location, quantity, document ref |
| `storageUnit` | Hierarchical bins/shelves via `parentId`; scoped to location |
| `trackedEntity` | Serial/batch/lot instances with attributes JSONB, status, quantity |
| `receipt` / `receiptLine` | Inbound documents from POs or production |
| `shipment` / `shipmentLine` | Outbound documents to customers |
| `stockTransfer` / `stockTransferLine` | Intra-location moves between storage units |
| `warehouseTransfer` / `warehouseTransferLine` | Inter-location moves |
| `kanban` | Pull-based replenishment signals |
| `batchProperty` | Custom property definitions for batch-tracked items |

## Key Service Functions

- `getInventoryItems` / `getInventoryItemsCount` — calls `get_inventory_quantities` RPC
- `getItemLedgerPage` — paginated ledger history for item at location
- `insertManualInventoryAdjustment` — adjustments with tracked entity handling
- `getStorageUnit(s)`, `getStorageUnitTree`, `getStorageUnitsTreeForLocation`
- `getAvailableTrackedEntities` — calls `get_available_tracked_entities` RPC
- `getReceipts`, `getReceiptLines`, `getReceiptTracking`
- `getShipments`, `getShipmentLines`
- `reconcileReceiptSerialEntities` — matches serials on receipt posting
- `getDefaultStorageUnitOrStorageUnitWithHighestQuantity` — picking defaults

## Related Modules

- **purchasing** — receipts consume PO lines; receipt posting updates `purchaseOrderLine.quantityReceived`
- **production** — job completion posts finished goods to inventory; materials are issued from inventory
- **items** — `itemTrackingType` (Inventory/Serial/Batch/Non-Inventory) determines tracking behavior
- **sales** — shipments fulfill sales order lines
- **quality** — inbound inspections can be triggered on receipt

## Rules References

- `.ai/rules/inventory-system.md` — comprehensive guide to the inventory code, RPCs, and service functions
