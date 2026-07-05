---
id: 942
kind: feature
title: Inventory Counts (Physical Count / Cycle Count)
risk: medium
issue: 942
acceptance:
  - "Migration creates `inventoryCount` and `inventoryCountLine` tables with correct columns, FK constraints, and RLS policies (inventory_view SELECT; inventory_create/update/delete for mutations)"
  - "POST /inventoryCount creates a count with status Draft, auto-populates lines from itemInventory at the given locationId (or all active items if no location), snapshotting expectedQty"
  - "Inventory Counts list route (x/inventory/inventory-counts) renders table with count date, location, status, line count, counted count, and variance columns; Add Inventory Count button works"
  - "Count detail page (x/inventory/inventory-counts/:id) shows header (date, location, status, notes) and editable lines table where operators can enter countedQty per line; variance auto-updates on save"
  - "Post Count action: validates all lines have countedQty, generates itemLedger entries (Positive Adjmt. or Negative Adjmt.) for each line where variance ≠ 0, sets status to Posted, and makes the count read-only"
  - "Cancel Count action: sets status to Cancelled with no ledger entries written; only allowed on Draft or In Progress counts"
  - "Inventory Counts link appears in the inventory sidebar nav"
  - "Existing inventory (receipts, shipments, stock movements) is unaffected — no regressions in itemLedger or itemInventory triggers"
---

## Grooming Notes

Carbon tracks real-time `quantityOnHand` in `itemInventory` via triggers on `itemLedger`. Over time, physical stock drifts. This feature adds a standard ERP physical/cycle count workflow.

### Database

```sql
CREATE TYPE "inventoryCountStatus" AS ENUM ('Draft', 'In Progress', 'Posted', 'Cancelled');

CREATE TABLE "inventoryCount" (
  "id"           TEXT NOT NULL DEFAULT xid(),
  "countDate"    DATE NOT NULL DEFAULT CURRENT_DATE,
  "status"       "inventoryCountStatus" NOT NULL DEFAULT 'Draft',
  "locationId"   TEXT,
  "notes"        TEXT,
  "companyId"    TEXT NOT NULL,
  "createdBy"    TEXT NOT NULL,
  "updatedAt"    TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT "inventoryCount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventoryCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE SET NULL,
  CONSTRAINT "inventoryCount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE "inventoryCountLine" (
  "id"              TEXT NOT NULL DEFAULT xid(),
  "inventoryCountId" TEXT NOT NULL,
  "itemId"          TEXT NOT NULL,
  "locationId"      TEXT,
  "shelfId"         TEXT,
  "expectedQty"     NUMERIC(12,4) NOT NULL DEFAULT 0,
  "countedQty"      NUMERIC(12,4),
  "variance"        NUMERIC(12,4) GENERATED ALWAYS AS ("countedQty" - "expectedQty") STORED,
  "companyId"       TEXT NOT NULL,
  CONSTRAINT "inventoryCountLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventoryCountLine_countId_fkey" FOREIGN KEY ("inventoryCountId") REFERENCES "inventoryCount"("id") ON DELETE CASCADE,
  CONSTRAINT "inventoryCountLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE
);
```

RLS: `inventory_view` can SELECT; `inventory_create`/`inventory_update`/`inventory_delete` for mutations.

### UI Routes (under `x+/inventory+/`)

| Route | Purpose |
|---|---|
| `inventory-counts.tsx` | List page |
| `inventory-counts.new.tsx` | Create form — date, location, notes; auto-populate lines |
| `inventory-counts.$inventoryCountId.tsx` | Layout |
| `inventory-counts.$inventoryCountId._index.tsx` | Detail — header + editable lines table |
| `inventory-counts.$inventoryCountId.delete.tsx` | Confirm delete (Draft/Cancelled only) |

### Business Logic

**Create count:** Snapshot `itemInventory.quantityOnHand` → `expectedQty` for matching rows. Status transitions Draft → In Progress when any line is saved.

**Post count:**
1. All lines must have `countedQty`
2. For each line where `variance ≠ 0`: insert `itemLedger` row with `entryType` = `'Positive Adjmt.'` (variance > 0) or `'Negative Adjmt.'` (variance < 0)
3. Set status → `'Posted'` (read-only after)

**Cancel count:** Status → Cancelled; no ledger entries.

### Precedent
- Look at how `inventoryReceipt` / `inventoryShipment` work for itemLedger entry patterns
- Look at `purchaseOrder` / `salesOrder` for route layout patterns
- Look at `location` table for locationId references
- Sidebar nav: look at other inventory sidebar items for the nav registration pattern
