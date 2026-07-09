# Change Orders Module

Standalone engineering-change-order (ECO) module: a part-first, staged workflow for changing which parts appear on assemblies' bills of material, with impact visibility and an "apply-at-Done" orchestration that spins new make-method versions. Modeled on the Quality (issue) module; the header evolves the existing `changeOrder` table, and the affected-item/disposition model is replaced by the part-first BOM-change model.

Permission key is `parts` (not `changeOrders`) — loaders/actions use `requirePermissions(request, { view | update | delete | create: "parts" })`. Routes live under `apps/erp/app/routes/x+/change-order+/` (detail + child mutations) and `x+/change-orders+/` (list + Types config).

Service code is split by concern (every file < 1000 lines, G4): `change-orders.service.ts` (header CRUD + stage transition + Products Affected + BOM changes + Types config + impact), `change-orders.reads.ts` (item↔CO traceability reads + linked-NCR reverse), `change-orders.actions.ts` (freeform action-task CRUD), `change-orders.server.ts` (server-only: `applyChangeOrder`, notifications). All re-exported from the module barrel — import from `~/modules/change-orders`.

**Approvals are not in V1.** There is no approval gate, reviewer/approval-task machinery, or `changeOrderRequireApproval` toggle — the whole approval subsystem was removed as dead/unwired scaffolding. Stages advance freely; a CO reaches Done via `applyChangeOrder`.

## Key Domain Concepts

- **Stage flow** — `changeOrderStatus`: `Draft` → `Start` → `Engineering Complete` → `Implementation` → `Done`. Forward-only, one step at a time (`changeOrderStatusTransitions` / `isAllowedChangeOrderTransition`). `isChangeOrderLocked(status)` is true only at `Done` — a Done CO is closed and read-only. `changeOrderOpenStatuses` = every stage before Done. `Start` / `Implementation` / `Done` broadcast a team notification (`changeOrderBroadcastStages`); `Draft` / `Engineering Complete` are silent.
- **Category** — the primary category is `changeOrderTypeId` (a row in the `changeOrderType` lookup, configured like Issue Types). The legacy `changeOrder.type` enum (`Engineering`/`Manufacturing`/`Documentation`) column still exists but is secondary.
- **Products Affected** — the top-level products (`changeOrderProductAffected`) the CO touches. Drives the Implementation effectivity-version list.
- **BOM change (part-first)** — `changeOrderBomChange` rows are `Add` or `Delete`, each targeting one part (`itemId`); per-assembly targets live on `changeOrderBomChangeAssembly` (assembly item + quantity + optional `supersessionMode`). A Delete removes an existing part from assemblies; an Add references an existing part **or** a forward-reference to a not-yet-synced part (`newItemReadableId` + `newItemName`), which the service **mints** as a real inactive item (`mintPlaceholderPart`, G3 — no nullable-placeholder threading). Supersession mode is only meaningful on a Delete row's assemblies.
- **Actions** — freeform, non-gating tasks (`changeOrderActionTask`, reused from the header's task table). Any user, any stage; drag-sortable.
- **Impact panel** — read-only, non-blocking (PRD §3.3). Surfaces open (not-yet-received) purchase-order lines for the parts being deleted, so procurement has visibility before the change goes live.
- **Linked NCR** — a CO may reference a non-conformance (`changeOrder.nonConformanceId`). Cross-linked both ways: the CO Properties sidebar has an editable NCR picker; the Issue detail lists the COs that reference it.

## Safety

### Always
- MUST scope every query by `companyId`.
- MUST advance stages only through `updateChangeOrderStatus` — it is the single guarded writer: forward-only (`isAllowedChangeOrderTransition`) **and** a compare-and-swap on the `fromStatus` (rejects a stale/concurrent transition).
- MUST check `isChangeOrderLocked(status)` (Done) before editing header/content — the inline update action (`update.tsx`) and content editors enforce this.
- MUST use the canonical make-method helpers via `applyChangeOrder` for the release — never re-implement version lifecycle.

### Ask First
- Changing the stage state machine (`changeOrderStatusTransitions`) or which stages broadcast.
- Re-running `applyChangeOrder` after a partial failure (see idempotency note) — it may create extra draft versions.
- Re-introducing approvals — build the missing reviewer/approval-task UI + gate as a real feature, not dormant scaffolding.

### Never
- Never transition a CO backward or skip a stage — the transition map is forward-only, single-step.
- Never write a global `itemSupersession` for a deleted part that is not fully obsoleted — the `isItemFullyObsoleted` predicate (G8) is the single place that decides this.
- Never add a nullable-placeholder branch for Add forward-references — mint a real inactive item (`mintPlaceholderPart`).
- Never scatter service/model files — the concern-split set is `change-orders.{service,reads,actions,models,server}.ts`; keep each < 1000 lines and add new functions to the file that owns the concern rather than growing a monolith.

## The apply-at-Done orchestration (`applyChangeOrder`, `.server.ts`)

`applyChangeOrder` **is** the Implementation → Done transition (the "release" equivalent). It orchestrates Carbon's canonical make-method helpers (`upsertMakeMethodVersion`, `copyMakeMethod`, `getMethodMaterialsByMakeMethod`, `deleteMethodMaterial`, `upsertMethodMaterial`, `activateMethodVersion`, `upsertItemSupersession`) — it does not re-implement version lifecycle.

- Per assembly targeted by the BOM changes: spins a Draft version off the current Active make method, copies its BOM/BOP, applies the row ops (delete matched materials, add new ones at `effectiveFrom`), then activates Draft → Active.
- **Not one transaction** (G2): `copyMakeMethod` / `activateMethodVersion` are edge-function (`functions.invoke`) calls that can't run inside a Kysely transaction. The apply is an idempotent, CAS-guarded orchestration: only the final flip to `Done` is transactional (a Kysely CAS on `status = 'Implementation'`), so a re-run can't double-apply at the CO level.
- **Known V1 limitation:** after a partial failure (some assemblies activated, CO still Implementation) a re-run reprocesses every assembly and may create extra draft versions — there is no per-assembly applied-marker yet. The CO-level CAS still prevents a double transition to Done.
- **Supersession:** a global `itemSupersession` is written only for a deleted part that `isItemFullyObsoleted` (removed from every assembly using it and not re-added elsewhere). Per-assembly modes are the recorded stock instructions; this rollup is the global old→successor link.

## Validation Commands

```bash
cd apps/erp && npx tsgo --noEmit    # scoped typecheck (whole-repo turbo cache masks errors)
pnpm run lint                       # Biome
```

## Key Data Model

| Table | Purpose |
|---|---|
| `changeOrder` | Header: `changeOrderId` (readable), `name`, `status`, `changeOrderTypeId`, `type` (legacy), `priority`, `nonConformanceId`, `openDate`/`dueDate`/`effectiveDate`, `assignee`, `reasonForChange`/`description` (JSON) |
| `changeOrderType` | The "Category" lookup (configured like Issue Types) |
| `changeOrderProductAffected` | Top-level products the CO touches |
| `changeOrderBomChange` | Part-first Add/Delete rows (`changeType`, `itemId`) |
| `changeOrderBomChangeAssembly` | Per-assembly target (`assemblyItemId`, `quantity`, `supersessionMode`, denormalized `changeOrderId` for audit rollup) |
| `changeOrderActionTask` | Freeform non-gating tasks (Actions) |

## Key Service Functions

- `getChangeOrder` / `getChangeOrders` — header reads (`getChangeOrders` is the paginated list).
- `insertChangeOrder` / `updateChangeOrder` / `deleteChangeOrder` — header CRUD (children cascade).
- `updateChangeOrderStatus` — the single guarded stage transition (forward-only + CAS).
- **`findChangeOrdersForItem`** (`change-orders.reads.ts`) — G6, the single canonical "change orders referencing this item" query, parameterized by status. Spans the three ways a CO references an item (Product Affected, BOM-change part, BOM-change assembly target), scoped by `readableId` so it matches the part across all revisions. Flat queries + JS union (no PostgREST embeds — TS2589 budget). Powers the part/tool detail history card and open-CO alert. Returns `ChangeOrderForItem[]`.
- `getItemChangeOrderData` (`change-orders.reads.ts`) — the shared loader helper (CO history + type labels) called by the part/tool detail routes so they don't each re-run the pair of reads.
- `getChangeOrdersForNonConformance` (`change-orders.reads.ts`) — reverse Linked-NCR cross-link (COs referencing a given NCR), rendered on the Issue detail.
- `getChangeOrderProductsAffected` / `upsertChangeOrderProductAffected` / `deleteChangeOrderProductAffected` — Products Affected.
- `getChangeOrderBomChanges` / `upsertBomChange` / `deleteChangeOrderBomChange` — BOM change rows (two shallow selects + JS stitch, not a nested embed — TS2589 budget).
- `mintPlaceholderPart` — G3, mints a real inactive item for an Add forward-reference.
- `getAssembliesUsingItem` — G7, the assemblies that consume a part (the Delete-row assembly picker).
- `upsertChangeOrderBomChangeAssembly` / `deleteChangeOrderBomChangeAssembly` — per-assembly targets (nulls `supersessionMode` on Add rows).
- `getChangeOrderImpact` — open PO lines for deleted parts (read-only impact panel).
- `getChangeOrderActions` / `upsertChangeOrderAction` / `updateChangeOrderActionStatus` / `deleteChangeOrderAction` / `updateChangeOrderActionOrder` (Kysely reorder) — Actions (`change-orders.actions.ts`).
- `getChangeOrderTypes(List)` / `getChangeOrderType` / `upsertChangeOrderType` / `deleteChangeOrderType` — Category config.
- `applyChangeOrder` (`.server.ts`) — the apply-at-Done orchestration (see above).
- `notifyChangeOrderTransition` (`.server.ts`) — best-effort team broadcast on Start/Implementation/Done.

## Key Validators & Helpers (`change-orders.models.ts`)

- `changeOrderValidator`, `changeOrderStatusValidator`, `changeOrderProductAffectedValidator`, `changeOrderBomChangeValidator` (single flat object + `superRefine`, not a `discriminatedUnion` of `ZodEffects` — the union form trips TS2589 through `@carbon/form`'s `validator()` generics), `changeOrderBomChangeAssemblyValidator`, `changeOrderActionValidator`, `changeOrderTypeValidator`.
- `changeOrderStatus`, `changeOrderStatusTransitions`, `isAllowedChangeOrderTransition`, `changeOrderBroadcastStages`, `changeOrderOpenStatuses`, `isChangeOrderLocked`, `canEditChangeOrder`.
- `isItemFullyObsoleted` (G8 supersession predicate), `supersessionModes`, `changeOrderPriority` (reuses quality's `nonConformancePriority`), `ChangeOrderError` (the service error-shape alias).

## Key Exports

```typescript
import {
  findChangeOrdersForItem,
  getChangeOrder,
  getChangeOrderTypesList,
  changeOrderOpenStatuses,
  isChangeOrderLocked
} from "~/modules/change-orders";
import type { ChangeOrderForItem, ChangeOrderStatus } from "~/modules/change-orders";
import { ChangeOrderStatus } from "~/modules/change-orders/ui/ChangeOrder";
```

## Related Modules

- **items** — the whole point: BOM changes rewrite make methods (`makeMethod`/`methodMaterial`) and write `itemSupersession`; `findChangeOrdersForItem` powers the part/tool detail history + open-CO alert. Uses the canonical make-method helpers.
- **quality** — a CO may link a non-conformance (`nonConformanceId`); cross-linked both ways. Priority reuses `nonConformancePriority`.
- **purchasing** — the impact panel reads open PO lines (`openPurchaseOrderLines`) for deleted parts.
- **settings** — `getNextSequence` mints `changeOrderId`.
- **notifications / jobs** — `notifyChangeOrderTransition` triggers the `notify` job on broadcast stages.

## Rules References

- `.ai/rules/audit-log-system.md` — the CO detail wires the per-entity `AuditLogDrawer` (`entityType: "changeOrder"`).
- `.ai/rules/revision-system.md` / `.ai/rules/material-tables.md` — make-method versions and BOM tables the apply rewrites.
