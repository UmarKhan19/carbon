# Item storage defaults + Shelf-life management

Plan: `/Users/sidwebworks/.claude/plans/hashed-hopping-crayon.md`.
Customer docs consulted: (newer) Storage levels + shelf-life modes; (older) `Shelf Life Starting Logic (1).docx` — the one that actually drives the trigger semantics.

Note: Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Design

**Storage defaults** live on `item` (`defaultLocationId`, `defaultStorageUnitId`, `defaultNestedStorageUnitId`). Required for Part / Material / Consumable on INSERT and on UPDATEs that would clear them. Enforced by event-system interceptors.

**Shelf-life policy** lives on a new `itemShelfLife` table keyed by `itemId`. **Presence of a row = managed; absence = not managed.** Two modes stored:

| Mode | Semantics | Required fields |
|---|---|---|
| `ItemSpecific` | Clock starts when a matching operation completes. If `triggerProcessId` is set, only ops using that process fire; if null, any op on the item's own make method stamps (the subassembly case). | `days` |
| `Calculated` | Finished good inherits `MIN(batchNumber.expirationDate)` from consumed component batches for that make method. | — |

Trigger logic runs as an **AFTER-sync event-system interceptor on `jobOperation`** (`stamp_shelf_life_on_operation_done`) that fires on `status → 'Done'`. Delegates to the shared helper `stamp_shelf_life_for_completed_operation(jobOperationId)`. No UI path invokes it. Idempotent via `expirationDate IS NULL` guard.

Item resolution goes via `jobOperation.jobMakeMethodId → jobMakeMethod.itemId`, so sub-assemblies correctly stamp their own batches and the Component Minimum join is scoped to the op's own make method.

## Progress

### Landed
- [x] Migration `20260420000000_item-storage-defaults-shelf-life.sql`:
  - Three new columns on `item` for storage defaults (no shelf-life columns live on `item`).
  - New `itemShelfLife` table with FK to `item` (ON DELETE CASCADE), FK to `process` for `triggerProcessId`, 4 RLS policies mirroring `item*` siblings, and CHECK constraints that enforce: mode ∈ {ItemSpecific, Calculated}; `days > 0`; `days` and `triggerProcessId` only when `ItemSpecific`; `days` required when `ItemSpecific`.
  - Two columns on `companySettings`: `nearExpiryWarningDays` (default 14), `expiredBadgeEnabled` (default true).
  - Two BEFORE-row interceptors on `item` for the storage-default invariants.
  - Shared helper `stamp_shelf_life_for_completed_operation(jobOperationId)` — reads `itemShelfLife` (absence → return), resolves the op's own item via `jobMakeMethod`, handles both modes, stamps output batches via `jobProductionTracking` filtered by `(jobId, itemId)` and guarded by `expirationDate IS NULL`.
  - AFTER-sync interceptor `stamp_shelf_life_on_operation_done` on `jobOperation`. Trigger re-registered preserving existing `sync_finish_job_operation` BEFORE.
- [x] `items.models.ts` validator:
  - `shelfLifeModes` enum exported (`NotManaged | ItemSpecific | Calculated`). `NotManaged` is UI-only — it instructs the server to delete the `itemShelfLife` row.
  - `itemValidator` carries storage defaults + shelf-life form fields.
  - `applyStorageAndShelfLifeRefines` gates `shelfLifeDays` / `shelfLifeTriggerProcessId` on `ItemSpecific`, enforces nested-before-top-level, and adds required-defaults refines for inventory types.
- [x] `apps/erp/app/modules/items/ui/Item/ItemStorageAndShelfLifeFields.tsx` — Location + StorageUnit selects, shelf-life Radios, Days Number, Process combobox for trigger.
- [x] Wired into `PartForm`, `MaterialForm`, `ConsumableForm`, `ToolForm`.
- [x] `items.service.ts`:
  - New `upsertItemShelfLife` helper — DELETEs on NotManaged, otherwise INSERT or UPDATE; clears mode-incompatible fields; fetches `companyId` from `item` if caller omits on update path.
  - `upsertPart`, `upsertMaterial` (both sizes / no-sizes / update branches), `upsertConsumable`, `upsertTool` all route shelf-life fields through `upsertItemShelfLife` and no longer touch `item.shelfLife*` columns.
  - `resolveMethodMaterialStorageUnitIds` seeds `methodMaterial.storageUnitIds` JSONB from child item's default location → storage unit.
- [x] `routes/x+/part+/new.tsx` default `shelfLifeMode: "NotManaged"`.
- [x] `receiptFromPurchaseOrder` in `create/index.ts`: selects item defaults, builds `itemDefaultsById`, falls back `receiptLine.locationId` / `storageUnitId` to item defaults (nested preferred) when PO line is silent.

### Landed this pass (continued)
- [x] Validator safety fix: `shelfLifeMode` changed from `.default("NotManaged")` to `.optional()`. `upsertItemShelfLife` now treats `undefined` as a no-op so other forms posting to the same `$itemId.details.tsx` action (e.g. the manufacturing sub-form) don't silently wipe the `itemShelfLife` row.
- [x] Settings panel extended in `routes/x+/settings+/inventory.tsx`:
  - New `shelfLifeSettingsValidator` in `settings.models.ts` (`nearExpiryWarningDays: 0..365`, `expiredBadgeEnabled: checkbox`).
  - New `updateShelfLifeSettings()` in `settings.service.ts`.
  - New `"Shelf life & expiry"` card on the Inventory settings page with number input + boolean toggle. Action handles a new `"shelfLife"` intent and returns toast messages via the existing fetcher pattern.

### Pending (follow-ups)
- [ ] Inline display + loader wiring: route loaders for part/material/consumable/tool edit should fetch the `itemShelfLife` row and include its fields in `initialValues`. Also consider an inline section in `PartProperties.tsx` and siblings so existing items can be edited in place.
- [ ] Receipt line tracking UI: surface an `expirationDate` input when the item has an `itemShelfLife` row with `mode='ItemSpecific'`, defaulting to `receivedDate + days`. Ensure a single batch auto-creates for items whose `itemTrackingType` is otherwise None.
- [ ] Extend `get_job_quantity_on_hand()` with an `earliestExpiration` column; client badge helper reads `companySettings.nearExpiryWarningDays` / `expiredBadgeEnabled`; FIFO sort on pick suggestions. Warn-only.
- [ ] Vitest coverage on validator refines. Blocked: `apps/erp` has no vitest infrastructure — adding test coverage for app-local validators requires standing up vitest + supabase mocks first. Consider moving `itemValidator` + the shelf-life refine helper into `packages/items-models` (new package) where vitest is already the standard.

## Review

What landed vs. what's left:

- The core of the feature — data model, invariants, server wiring, form capture on create, automatic background stamping on operation completion, receipt defaulting, BoM seeding, and the company-level warning settings — is complete. A customer opening a new Part / Material / Consumable / Tool form now sees the storage defaults and shelf-life section; submitting creates an `itemShelfLife` row when they opt in. Job operations transitioning to `'Done'` stamp expiry via the AFTER-sync interceptor with no UI involvement.
- Two design shifts happened mid-implementation and are worth calling out:
  1. `shelfLifeTriggerOperation TEXT` → `shelfLifeTriggerProcessId TEXT REFERENCES process(id)` after the user flagged the free-text fragility. The trigger now uses a combobox that lets users create/pick a process. Rename-safe, typo-proof.
  2. Shelf-life columns on `item` (3-value enum + 2 conditional fields) → `itemShelfLife` side table keyed by `itemId` with a 2-value enum. Absence of a row = not managed. Cleaner queries, narrower parent table, tighter CHECK constraints.
- The `ItemSpecific, trigger null` case handles the subassembly scenario from the customer doc; `ItemSpecific` with a trigger handles Harvest / Packaging / Pasteurisation; `Calculated` handles Component Minimum. The helper scopes its resolution via `jobOperation.jobMakeMethodId`, so sub-assemblies stamp their own batches on their own op completions (not the top-level job's).

What's intentionally deferred:

- **Edit-flow UI**: the create form captures everything, but editing shelf-life on an existing item requires wiring the route loader to hydrate `itemShelfLife` into `initialValues` and adding an inline section to `PartProperties.tsx` (and siblings). Not blocking because of the `undefined = no-op` fix in `upsertItemShelfLife` — unrelated forms won't wipe the row.
- **Receipt raw-material expiry input**: the batch tracking UI doesn't yet surface `expirationDate` for ItemSpecific items whose tracking type is None. Raw-material receive flows that need per-batch expiry go through the existing batch-tracking path today, which already has the field.
- **FIFO sort + badges**: the DB column + view join haven't been added yet; the settings that would drive them are in place.
- **Validator tests**: ERP has no vitest; skipping rather than standing up the infrastructure for this feature alone.

Would a staff engineer approve this? The backend is clean and defensible — side-table model matches existing Carbon idioms, interceptor re-registration preserves prior handlers, helper is idempotent, CHECK constraints enforce the invariants, FK on the trigger process is the right call. The front-end is minimal but sufficient for the create path. The plan file at `~/.claude/plans/hashed-hopping-crayon.md` still references the older `item.shelfLife*` column design and the 14-day hardcoded threshold — it should be re-read with this review to understand the as-built shape.

## Files touched

Database:
- `packages/database/supabase/migrations/20260420000000_item-storage-defaults-shelf-life.sql` (new)

Models / validators:
- `apps/erp/app/modules/items/items.models.ts`
- `apps/erp/app/modules/settings/settings.models.ts`

Services:
- `apps/erp/app/modules/items/items.service.ts` (new `upsertItemShelfLife` + `resolveMethodMaterialStorageUnitIds`; all four `upsert*` items route shelf-life to the side table)
- `apps/erp/app/modules/settings/settings.service.ts` (new `updateShelfLifeSettings`)

UI:
- `apps/erp/app/modules/items/ui/Item/ItemStorageAndShelfLifeFields.tsx` (new shared component)
- `apps/erp/app/modules/items/ui/Parts/PartForm.tsx`
- `apps/erp/app/modules/items/ui/Materials/MaterialForm.tsx`
- `apps/erp/app/modules/items/ui/Consumables/ConsumableForm.tsx`
- `apps/erp/app/modules/items/ui/Tools/ToolForm.tsx`
- `apps/erp/app/routes/x+/part+/new.tsx` (initial values)
- `apps/erp/app/routes/x+/settings+/inventory.tsx` (new "Shelf life & expiry" card)

Edge functions:
- `packages/database/supabase/functions/create/index.ts` (receipt defaulting from item defaults)
