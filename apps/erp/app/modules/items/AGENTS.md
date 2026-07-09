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

Engineering-change-order (ECO) workflow — a part-first, staged process for changing which parts appear on assemblies' bills of material, with impact visibility and an "apply-at-Done" orchestration that spins new make-method versions. Lives **inside** the Items module (not a standalone module). Permission key is `parts` — loaders/actions use `requirePermissions(request, { view | update | delete | create: "parts" })`. Routes live under `apps/erp/app/routes/x+/items+/change-order+/` (detail + child mutations) and `x+/items+/change-orders+/` (list + Types config); URLs are `/x/items/change-order(s)…`. Navigation is a "Change Orders" group in the Items sidebar (`useItemsSubmodules`).

Service code is split by concern (every file < 1000 lines, G4): `changeOrder.service.ts` (header CRUD + stage transition + Products Affected + BOM changes + Types config + impact), `changeOrder.reads.ts` (item↔CO traceability reads + linked-NCR reverse), `changeOrder.actions.ts` (freeform action-task CRUD), `changeOrder.server.ts` (server-only: `applyChangeOrder`, notifications), `changeOrder.models.ts` (validators + state machine). All non-server files re-exported from the Items barrel — import from `~/modules/items`; the server file imports directly from `~/modules/items/changeOrder.server`.

**Approvals are not in V1.** No approval gate, reviewer/approval-task machinery, or toggle — stages advance freely; a CO reaches Done via `applyChangeOrder`. Only one open CO per part is allowed (`findOtherOpenChangeOrdersForItem` guard) — no parallel/merge/chain.

### Key CO concepts

- **Stage flow** — `changeOrderStatus`: `Draft` → `Start` → `Engineering Complete` → `Implementation` → `Done`. Forward-only, one step (`changeOrderStatusTransitions` / `isAllowedChangeOrderTransition`). `isChangeOrderLocked(status)` is true only at `Done` (closed, read-only). `changeOrderOpenStatuses` = every stage before Done. `Start`/`Implementation`/`Done` broadcast a team notification.
- **BOM change (part-first)** — `changeOrderBomChange` rows are `Add`/`Delete` targeting one part (`itemId`); per-assembly targets on `changeOrderBomChangeAssembly` (assembly + quantity + optional `supersessionMode`). An Add can forward-reference a not-yet-synced part which the service **mints** as a real inactive item (`mintPlaceholderPart`, G3 — no nullable-placeholder threading).
- **Impact panel** — read-only; open (not-yet-received) PO lines for deleted parts.
- **Linked NCR** — a CO may reference a non-conformance (`changeOrder.nonConformanceId`), cross-linked both ways with the Issue detail.

### CO Safety

- MUST advance stages only through `updateChangeOrderStatus` — the single guarded writer (forward-only + compare-and-swap on `fromStatus`).
- MUST check `isChangeOrderLocked(status)` (Done) before editing header/content.
- MUST use `applyChangeOrder` (the Implementation → Done "release") for make-method versioning — never re-implement version lifecycle. It orchestrates the canonical helpers via edge-function calls, so it is **not** one transaction (G2); only the final flip to Done is a Kysely CAS. Known V1 limit: a re-run after partial failure may create extra draft versions.
- `findChangeOrdersForItem` (`changeOrder.reads.ts`) is G6 — the single canonical "change orders referencing this item" query (spans Product Affected, BOM-change part, BOM-change assembly), scoped by `readableId`. Flat queries + JS union (no PostgREST embeds — TS2589 budget). Powers the part/tool detail history + open-CO alert. Do not add a second query for this.
- Never write a global `itemSupersession` for a deleted part that is not fully obsoleted — `isItemFullyObsoleted` (G8) is the single decider.
- Never scatter CO files — the concern-split set is `changeOrder.{service,reads,actions,models,server}.ts`; add functions to the file that owns the concern, keep each < 1000 lines.

### CO data model

| Table | Purpose |
|---|---|
| `changeOrder` | Header: `changeOrderId`, `name`, `status`, `changeOrderTypeId`, `type` (legacy), `priority`, `nonConformanceId`, dates, `assignee`, `reasonForChange`/`description` |
| `changeOrderType` | The "Category" lookup (configured like Issue Types) |
| `changeOrderProductAffected` | Top-level products the CO touches |
| `changeOrderBomChange` | Part-first Add/Delete rows (`changeType`, `itemId`) |
| `changeOrderBomChangeAssembly` | Per-assembly target (`assemblyItemId`, `quantity`, `supersessionMode`) |
| `changeOrderActionTask` | Freeform non-gating tasks (Actions) |

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
