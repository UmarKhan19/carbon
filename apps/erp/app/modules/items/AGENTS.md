# Items Module

Master data for all item types (Parts, Materials, Tools, Consumables, Services), bill of materials (make methods), unit of measure management, material taxonomy, item costing, shelf life, configurations, supersessions, pick methods, and item posting groups.

## Key Domain Concepts

- **Item Types** — Parts (manufactured/purchased goods), Materials (raw materials with taxonomy), Tools, Consumables, Services. All share the `item` table; type-specific tables (`part`, `material`, `tool`, `consumable`, `service`) extend it.
- **Make Method** — versioned manufacturing method on an item: BOM (`methodMaterial`) + routing (`methodOperation`). Statuses: Draft/Active/Archived. MUST create a new version instead of editing Active methods.
- **Material Taxonomy** — structured properties via FK relationships: `materialSubstance` (steel, aluminum), `materialForm` (sheet, plate, roundbar), `materialType`, `materialGrade`, `materialFinish`, `materialDimension`. Global rows (`companyId IS NULL`) are system-seeded.
- **Item Tracking Type** — `Inventory` (quantity only), `Serial` (unique per unit), `Batch` (lot-tracked), `Non-Inventory` (not stocked). Drives behavior in inventory, receipts, and picking.
- **Replenishment System** — `Buy`, `Make`, or `Buy and Make`. Drives MRP planning and method availability. `sourcingType` (`Specified`/`Drop Ship`/`Ship from Inventory`) is item-level and cascades to `methodMaterial` rows.
- **Shelf Life** — batch/serial items can have expiry tracking. Modes: Fixed Duration, Calculated, Set on Receipt.
- **Supersession** — item replacement chain for obsolete parts via `itemSupersession`.

## Safety

### Always
- MUST use `upsertMaterial` for material creation — it handles both `item` and `material` table inserts with `readableId` linkage.
- MUST remember: `material.id` = `item.readableId`, NOT `item.id`. Join via `readableId + companyId`.
- MUST use `assertMethodOperationIsDraft` before deleting method operations — Active/Archived methods are protected.
- MUST use `updateItemMethodAndSourcing` when changing `replenishmentSystem`, `defaultMethodType`, or `sourcingType` — it cascades to Draft method materials.

### Ask First
- Deleting items that have inventory, open POs, or active jobs — `item` FK has `ON DELETE RESTRICT` from `trackedEntity`.
- Changing `itemTrackingType` on items that already have tracked entities — use `cascadeItemTrackingType`.
- Modifying Active method versions — create a new version instead.

### Never
- Directly insert `material` rows without corresponding `item` rows.
- Assume `material` has an `itemId` column — it was dropped; linkage is `material.id = item.readableId`.
- Delete global taxonomy rows (`companyId IS NULL`) — they're system-seeded and shared across companies.
- Edit `methodMaterial.sourcingType`/`methodType` per-row — they're derived from the component item. Change sourcing on the item instead.

## Validation Commands

```bash
pnpm --filter @carbon/erp typecheck
pnpm --filter @carbon/erp test
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `item` | Universal item master: readableId, name, type, tracking, replenishment, UoM |
| `part` / `material` / `tool` / `consumable` / `service` | Type-specific extensions |
| `materialForm` / `materialSubstance` / `materialType` / `materialGrade` / `materialFinish` / `materialDimension` | Material taxonomy (global or company-scoped) |
| `makeMethod` | Versioned manufacturing method header (Draft/Active/Archived) |
| `methodMaterial` / `methodOperation` / `methodOperationStep` / `methodOperationParameter` / `methodOperationTool` | BOM lines, routing steps, and work instruction details |
| `itemCost` / `costLedger` | Standard/average costs and cost history |
| `itemReplenishment` / `itemPlanning` | Manufacturing settings (lot size, lead time, scrap %) and planning params |
| `itemPostingGroup` | Maps item categories to GL accounts |
| `unitOfMeasure` | UoM definitions |
| `configurationParameter` / `configurationRule` / `configurationParameterGroup` | Product configurator |
| `supplierPart` / `supplierPartPrice` | Supplier-item pricing with conversion factors and price breaks |
| `pickMethod` | Default storage unit and pick strategy per item/location |
| `itemShelfLife` | Shelf life tracking configuration per item |
| `itemSupersession` | Item replacement chains |

## Key Service Functions

- `getItem` / `getPart` / `getMaterial` / `getConsumable` / `getTool` — item reads by type (RPCs `get_part_details`, `get_material_details`, etc.)
- `upsertMaterial` — creates/updates material with taxonomy FKs and `item`/`material` linkage
- `getMakeMethods` / `getMethodMaterials` / `getMethodOperations` / `getMethodTreeArray` — BOM/routing reads
- `copyItem` / `copyMakeMethod` — duplicates via edge function
- `createRevision` / `activateMethodVersion` — revision and version management
- `updateItemMethodAndSourcing` — cascades replenishment/sourcing changes to Draft method materials
- `getItemCost` / `getItemQuantities` / `getItemDemand` / `getItemSupply` — cost and planning reads
- `getSupplierParts` / `getSupplierPriceBreaksForItems` / `lookupBuyPrice` — vendor pricing
- `upsertPickMethodWithShelfLife` — pick method with shelf life configuration
- `getConfigurationParameters` / `getConfigurationRules` — product configurator

## Key Exports

```typescript
import { getItem, upsertMaterial, getMakeMethods } from "~/modules/items";
import { itemValidator, itemTrackingTypes, itemReplenishmentSystems } from "~/modules/items";
```

## Change Orders (sub-area)

Engineering-change-order (ECO) workflow — a **top-to-bottom**, affected-items-first process: the user picks the assemblies (items) to change, edits a staged copy of each item's BOM/BOP/attributes (the full desired end-state, git-style), and releases the CO — which spins a **new item revision** per affected item and propagates via supersession. Lives **inside** the Items module (not a standalone module). Permission key is `parts` — loaders/actions use `requirePermissions(request, { view | update | delete | create: "parts" })`. Routes live under `apps/erp/app/routes/x+/items+/change-order+/` (detail + `affected`/`supersession`/`action` child mutations) and `x+/items+/change-orders+/` (list + Types config); URLs are `/x/items/change-order(s)…`. Navigation is a "Change Orders" group in the Items sidebar (`useItemsSubmodules`).

Service code is split by concern (every file < 1000 lines, G4): `changeOrder.service.ts` (header CRUD + guarded stage transition + Types config + `mintPlaceholderPart` + `getTopLevelProductsForItems` rollup + impact), `changeOrder.staging.ts` (affected-items + staged material/operation/attribute CRUD, snapshot-on-add, manual supersession CRUD), `changeOrder.diff.ts` (`diffMethod` pure engine + `getChangeOrderDiff` DB wrapper), `changeOrder.reads.ts` (item↔CO traceability reads + linked-NCR reverse), `changeOrder.actions.ts` (freeform action-task CRUD), `changeOrder.server.ts` (server-only: `applyChangeOrder` release orchestration + notifications), `changeOrder.models.ts` (validators + state machine + diff types). All non-server files are re-exported from the Items barrel — import from `~/modules/items`; the server file imports directly from `~/modules/items/changeOrder.server`.

**Approvals are not in V1.** No approval gate, reviewer/approval-task machinery, or toggle — stages advance freely; a CO reaches Done via `applyChangeOrder`. Only one open CO per part is allowed (`findOtherOpenChangeOrdersForItem` guard, enforced when adding an affected item) — no parallel/merge/chain.

### Key CO concepts

- **Stage flow** — `changeOrderStatus`: `Draft` → `Start` → `Engineering Complete` → `Implementation` → `Done`. Forward-only, one step (`changeOrderStatusTransitions` / `isAllowedChangeOrderTransition`). `isChangeOrderLocked(status)` is true only at `Done` (closed, read-only); `canEditChangeOrder` is its inverse. `changeOrderOpenStatuses` = every stage before Done. `Start`/`Implementation`/`Done` broadcast a team notification (`changeOrderBroadcastStages`).
- **Affected items + staged content (top-to-bottom)** — `changeOrderAffectedItem` rows are the assemblies the user selects first. `addChangeOrderAffectedItem` **snapshots-on-add**: it copies the item's live Active make method into CO-owned staging in one transaction — `methodMaterial` → `changeOrderStagedMaterial` (`sourceMaterialId` = live id), `methodOperation` → `changeOrderStagedOperation` (`sourceOperationId` = live id; columns mirror `methodOperation`), plus one `changeOrderStagedItemAttributes` row from the item's editable columns. The user then edits the staged rows to the desired end-state; a staged material with `sourceMaterialId = NULL` is an "added" line, a deleted staged row is a "removed" line. A staged material can forward-reference a not-yet-synced part which the service **mints** as a real inactive item (`mintPlaceholderPart`, G3).
- **Diff (git-style end-state)** — `diffMethod` (pure, unit-tested in `changeOrder.diff.test.ts`) compares the live method against the staged end-state and classifies each material/operation/attribute as added/removed/modified/unchanged; `getChangeOrderDiff` is the DB-facing wrapper per affected item (also returns the manual supersessions). The diff is derived from the snapshot vs. the edited end-state — **not** delta-replay.
- **Release (`applyChangeOrder`)** — the Implementation → Done action. Per affected item it: `createRevision` (new inactive revision + auto Draft make method) → materialize the staged end-state onto that method (full replace) → apply staged attributes → `activateMethodVersion` (Make items) → flip the revision active + stamp `item.changeOrderId` → auto-write the oldRev→newRev `itemSupersession` → stamp `changeOrderAffectedItem.newItemId` (per-item idempotency marker). Then it writes the manual `changeOrderSupersession` declarations and does the final Kysely CAS flip to Done.
- **Supersession propagation (no parent cascade)** — changing a component does **not** re-BOM its parents. The new revision propagates via supersession chains (`itemSupersession`): the auto oldRev→newRev cutover per affected item, plus any manual different-part `changeOrderSupersession` rows. `item.changeOrderId` is the revision→CO back-link powering the "Created by CO-…" chip and part-side change history.
- **Impact panel** — read-only; open (not-yet-received) PO lines for parts being removed from a staged BOM (`getChangeOrderImpact` diffs live vs. staged material itemIds per affected item).
- **Linked NCR** — a CO may reference a non-conformance (`changeOrder.nonConformanceId`), cross-linked both ways with the Issue detail.

### CO Safety

- MUST advance stages only through `updateChangeOrderStatus` — the single guarded writer (forward-only + compare-and-swap on `fromStatus`).
- MUST check `isChangeOrderLocked(status)` (Done) before editing header/content.
- MUST add affected items through `addChangeOrderAffectedItem` — never insert a `changeOrderAffectedItem` row without the snapshot, or the diff/release have no base to compare against.
- MUST use `applyChangeOrder` (the Implementation → Done "release") for the revision lifecycle — never re-implement `createRevision`/`activateMethodVersion`/`itemSupersession` inline. It orchestrates canonical helpers via edge-function calls, so it is **not** one transaction (G2); only the final flip to Done is a Kysely CAS. It is idempotent via the `changeOrderAffectedItem.newItemId` marker (re-run after partial failure skips already-released items).
- `findChangeOrdersForItem` (`changeOrder.reads.ts`) is G6 — the single canonical "change orders referencing this item" query (spans affected items, staged BOM components, manual supersession predecessor/successor, and the `item.changeOrderId` reverse link on released revisions), scoped by `readableId`. Flat queries + JS union (no PostgREST embeds — TS2589 budget). Powers the part/tool detail history + open-CO alert. Do not add a second query for this.
- Never scatter CO files — the concern-split set is `changeOrder.{service,staging,diff,reads,actions,models,server}.ts`; add functions to the file that owns the concern, keep each < 1000 lines.

### CO data model

| Table | Purpose |
|---|---|
| `changeOrder` | Header: `changeOrderId`, `name`, `status`, `changeOrderTypeId`, `type` (legacy), `priority`, `nonConformanceId`, dates, `assignee`, `reasonForChange`/`description` |
| `changeOrderType` | The "Category" lookup (configured like Issue Types) |
| `changeOrderAffectedItem` | The items the CO changes — user-selected first. Per-item revision cutover config (`supersessionMode`, `discontinuationDate`, `successorEffectivityDate`) and the release idempotency marker `newItemId` |
| `changeOrderStagedMaterial` | CO-owned mirror of `methodMaterial` (staged BOM end-state). `sourceMaterialId` = live id copied on snapshot (NULL ⇒ added line); `affectedItemId` FK |
| `changeOrderStagedOperation` | CO-owned mirror of `methodOperation` headers (staged BOP end-state). `sourceOperationId` = live id; columns mirror `methodOperation` (`order`, `operationOrder`, `operationType`, `processId`, `workCenterId`, `operationSupplierProcessId`, `procedureId`, `description`, setup/labor/machine time+unit, `workInstruction`) |
| `changeOrderStagedItemAttributes` | CO-owned staged copy of the affected item's editable attributes (one row per affected item) |
| `changeOrderSupersession` | MANUAL different-part obsolescence declarations (`predecessorItemId` → `successorItemId`) — distinct from the auto oldRev→newRev cutover |
| `changeOrderActionTask` | Freeform non-gating tasks (Actions) |
| `item.changeOrderId` | Revision → CO back-link, stamped at release; powers change history + revision-centric audit |

## Related Modules

- **purchasing** — supplier parts pricing; PO lines reference items; `conversionFactor` on `supplierPart`; CO impact panel reads open PO lines (`openPurchaseOrderLines`) for deleted parts
- **inventory** — quantities tracked per item/location; tracking type drives receipt/picking behavior
- **production** — jobs manufacture items; make methods copied to jobs via `get-method` edge function
- **sales** — quote lines and sales order lines reference items; `itemUnitSalePrice` is base price
- **accounting** — `itemPostingGroup` maps items to GL accounts
- **quality** — `requiresInspection` flag on items; inspection documents reference parts

## Rules References

- `.ai/rules/material-tables.md` — material taxonomy schema, linkage, and the `material.id = item.readableId` gotcha
- `.ai/rules/method-material-sourcing.md` — how methods determine Buy/Make/Pull sourcing and cascade rules
