# Picking List System

## Overview

Picking lists are workflow documents that guide operators through pulling materials from warehouse shelves for a production job. They sit between job planning and material consumption — the consumption ledger entry only fires when the PL is confirmed.

**Key architectural principle**: Ledger `documentId` = jobId (not PL id). PL is a workflow artifact, not an accounting one.

## Status Flow

`Draft → Released → In Progress → Confirmed`
Can be `Cancelled` from any non-Confirmed state.
Confirmed PLs can be `Reversed` (rolls back consumption, sets status to Cancelled).

## Database Tables

### `pickingList`
- One active PL per (jobId, locationId) enforced by partial unique index
- `pickingListId`: readable ID (PL-00001), generated via sequence table
- `status`: pickingListStatus enum
- `shortageReason`: required if confirmed with outstanding > 0

### `pickingListLine`
- One row per jobMaterial per shelf (or one per split segment after tracked auto-split)
- `estimatedQuantity`: snapshot from jobMaterial.quantityToIssue at generation time
- `adjustedQuantity`: nullable — set by supervisor edit via `$id.line.$lineId.tsx` route
- `outstandingQuantity`: GENERATED = GREATEST(COALESCE(adjusted, estimated) - picked, 0)
- `overPickQuantity`: GENERATED
- `pickedTrackedEntityId`: set at scan time (tracked items only)
- `storageUnitId`: source shelf (prefers pickMethod.defaultStorageUnitId over jobMaterial.storageUnitId since migration 20260505000001)
- `destinationStorageUnitId`: destination shelf (line-side staging)

### Column Additions to Existing Tables
- `job.pickingStatus` (jobPickingStatus enum, trigger-maintained)
- `job.autoGeneratePickingList` BOOLEAN
- `companySettings.usePickingLists` BOOLEAN
- `companySettings.defaultAutoGeneratePickingList` BOOLEAN
- `methodMaterial.requiresPicking` BOOLEAN
- `jobMaterial.requiresPicking` BOOLEAN
- `workCenter.defaultStorageUnitId` FK → storageUnit

## Edge Function

`packages/database/supabase/functions/pick/index.ts`

Auth: uses `getSupabase(authorizationHeader)` for normal user JWT (ERP calls). Falls back to service role only for API key auth.

Operations:
- `generatePickingList` — create header + call generate_picking_list_lines RPC
- `regeneratePickingList` — wipe lines + re-run RPC
- `pickInventoryLine` — update pickedQuantity (non-tracked). Hard block at 2× estimated/adjusted qty.
- `pickTrackedEntityLine` — validate entity + set pickedTrackedEntityId. Auto-splits line if entity.qty < outstanding.
- `unpickLine` — reset pickedQuantity to 0
- `releasePickingList` — Draft → Released
- `confirmPickingList` — post consumption ledger + lock PL. Requires shortageReason if outstanding > 0.
- `cancelPickingList` — cancel any non-Confirmed PL
- `reversePickingList` — Confirmed PLs only. Posts positive ledger entries (Positive Adjmt. / Job Reversal), rolls back jobMaterial.quantityIssued, restores tracked entities to Available (safe: only if still Consumed), sets PL to Cancelled.

## Over-Pick Guard (P0)
- Hard block in `pickInventoryLine`: picked > 2× (adjustedQty ?? estimatedQty) → error
- No soft warning tier (P1)

## Tracked Auto-Split (P0)
- In `pickTrackedEntityLine`: if entity.quantity < outstanding on line:
  - Closes current line: adjustedQuantity = pickedQuantity (so outstanding = 0)
  - Creates sibling line with estimatedQuantity = remainder, same item/shelf/PL

## RPC

`generate_picking_list_lines(p_picking_list_id, p_job_id, p_company_id, p_user_id)`
- Creates one line per qualifying jobMaterial (Pull from Inventory, quantityToIssue > 0, requiresPicking = true)
- Shelf preference (since migration 20260505000001): pickMethod.defaultStorageUnitId → jobMaterial.storageUnitId
- Destination: workCenter.defaultStorageUnitId → PL.destinationStorageUnitId

## Triggers

- `pickingList INSERT/UPDATE/DELETE` → recompute `job.pickingStatus`
- `pickingListLine INSERT/UPDATE/DELETE` → recompute `job.pickingStatus`

## ERP Service Functions (inventory.service.ts)

- `getPickingLists(client, companyId, filters)`
- `getPickingList(client, id)` — fetches `*, job(jobId,itemId,customerId,salesOrderId,item,customer,salesOrder), location, assigneeUser, createdByUser, destinationStorageUnit`
- `getPickingListLines(client, pickingListId)`
- `deletePickingList(client, id)`
- `upsertPickingList(client, values)`
- `getActiveAllocations(client, companyId, itemIds)` — sum outstanding qty per item across active (Released/In Progress) PLs

## Soft Allocation API

`GET /api/inventory/soft-allocations?itemIds=a,b,c`
Returns `{ data: Array<{ itemId, allocatedQuantity }> }` — total outstanding across all active PLs for those items.

## ERP Routes

List: `apps/erp/app/routes/x+/inventory+/picking-lists.tsx`
Detail: `apps/erp/app/routes/x+/picking-list+/$id.tsx`
Layout: `apps/erp/app/routes/x+/picking-list+/_layout.tsx`
New: `apps/erp/app/routes/x+/inventory+/picking-lists.new.tsx` (uses Combobox for job/location)
Status (Release/Cancel): `$id.status.tsx`
Confirm: `$id.confirm.tsx` (surfaces backend error message in response data)
Reverse: `$id.reverse.tsx`
Regenerate: `$id.regenerate.tsx`
Pick qty: `$id.line.quantity.tsx`
Scan entity: `$id.scan.$lineId.tsx`
Unpick: `$id.unpick.$lineId.tsx`
Line edit (adjustedQty): `$id.line.$lineId.tsx`
Line delete: `$id.line.$lineId.delete.tsx`
Manual line add: `$id.line.new.tsx`
PDF/Print: `$id.pdf.tsx` (print-CSS page, sorted by storageUnit name)
Delete PL: `delete.$id.tsx`

## UI Components (modules/inventory/ui/PickingLists/)

- `PickingListsTable.tsx` — list table with filters
- `PickingListHeader.tsx` — detail header with Release/Confirm/Cancel/Reverse/PDF actions. Confirm opens modal.
- `PickingListLines.tsx` — hero section + 3 stat cards + active line detail card + compact lines table. Active line driven by `?lineId=` URL param. `onPickAllEligible` batch-picks all non-tracked outstanding lines.
- `PickingListProperties.tsx` — right sidebar with donut chart, property rows (status, job, SO, customer, warehouse, tolerance, assignee, dates). Uses `w-full` to fill ResizablePanel.
- `PickingListStatus.tsx` — status badge
- `PickingListConfirmModal.tsx` — confirm dialog with shortage reason. Shows inline backend errors.

## Layout (ResizablePanels)

`apps/erp/app/components/Layout/Panels.tsx` — 3-panel layout: explorer (collapsible, order=1), content (order=2), properties (collapsible, order=3, id="properties-panel"). `ResizablePanelGroup` has `h-full w-full`. Properties is a proper ResizablePanel with its own ResizableHandle (drag to resize). Both explorer and properties use ImperativePanelHandle refs driven by PanelContext state.

## Navigation

Added to `useInventorySubmodules.tsx` under Manage group using `LuClipboardList` icon.

## Paths (path.ts)

- `path.to.pickingLists` → `/x/inventory/picking-lists`
- `path.to.pickingList(id)` → `/x/picking-list/${id}`
- `path.to.newPickingList` → `/x/inventory/picking-lists/new`
- `path.to.pickingListStatus(id)` → `/x/picking-list/${id}/status`
- `path.to.confirmPickingList(id)` / `pickingListConfirm(id)` → `/x/picking-list/${id}/confirm`
- `path.to.regeneratePickingList(id)` → `/x/picking-list/${id}/regenerate`
- `path.to.reversePickingList(id)` → `/x/picking-list/${id}/reverse`
- `path.to.pickingListLineQuantity(id)` → `/x/picking-list/${id}/line/quantity`
- `path.to.pickingListLineNew(id)` → `/x/picking-list/${id}/line/new`
- `path.to.pickingListLine(id, lineId)` → `/x/picking-list/${id}/line/${lineId}`
- `path.to.pickingListLineDelete(id, lineId)` → `/x/picking-list/${id}/line/${lineId}/delete`
- `path.to.pickingListScan(id, lineId)` → `/x/picking-list/${id}/scan/${lineId}`
- `path.to.unpickPickingListLine(id, lineId)` → `/x/picking-list/${id}/unpick/${lineId}`
- `path.to.deletePickingList(id)` → `/x/picking-list/delete/${id}`
- `path.to.pickingListPdf(id)` → `/x/picking-list/${id}/pdf`

## Sequence

Sequence table entry: `table='pickingList', prefix='PL-', size=5`
Generates: PL-00001, PL-00002, etc.

## Migrations

- `20260505000000_picking-lists.sql` — core P0 schema
- `20260505000001_picking-lists-rpc-uplift.sql` — improved RPC with pickMethod shelf preference

## Hinglish Documentation

See `PICKING-LIST-HINGLISH.md` in project root for full flow explanation in Hinglish.

## Future Phases Not Yet Built

- P1: Job Staging (stageJob, generateStockTransfer edge fn operations)
- P1: Auto-generate PL when job is released (autoGeneratePickingList hook)
- P1: Multi-shelf allocation in RPC (split lines by shelf capacity)
- P1: Over-pick warning tier (between 1× and 2×, requires confirm step)
- P1: MES routes (picking-lists.tsx, picking-list.$id.tsx scan-first screen)
- P2: Movements Feed (inventory+/movements.tsx)
- P3: Incident Reporting (productionIncident table + auto PL adjustment)
