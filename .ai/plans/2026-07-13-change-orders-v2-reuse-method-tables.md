# Change Orders v2 (reuse method tables + parallel + diff/merge) — implementation plan

**Spec / design source:** `../../../plans/change-orders/top-to-bottom/plan-v2.md`
(absolute: `/Users/aashu/work/carbon/plans/change-orders/top-to-bottom/plan-v2.md`)
+ sibling `client-feedback-slack.md`. All open questions Q1–Q9 resolved there.
**v1 plan (superseded approach):** `.ai/plans/2026-07-12-change-orders-top-to-bottom.md`
**Branch:** `feat/change-orders-top-to-bottom` (continue on it — Q8, do NOT preserve v1)

> **The core shift (v2):** a CO's edits for one affected item no longer live in
> five `changeOrderStaged*` mirror tables. They live in a **real Draft `makeMethod`**
> (with real `methodMaterial`/`methodOperation`/child rows) that is **owned by the CO
> and hidden** until release. The existing `BillOfMaterial`/`BillOfProcess`/`PartProperties`
> editors are embedded on the CO page pointed at that draft. Release **dispatches by
> per-affected-item change type** (Version / Revision / New Part). Same-part parallel COs
> are supported via a **2-way diff/merge** at release (this CO vs current live).

---

## Progress
- [ ] Task 1: Rewrite migration `20260712151500_change-orders.sql` in place to the v2 end-state
- [ ] Task 2: Regenerate DB types
- [ ] Task 3: Rewrite `changeOrder.models.ts` for v2 (change type, drop staged validators)
- [ ] Task 4: Delete v1 staging service, forked editors, and staging routes
- [ ] Task 5: Add draft-make-method orchestration + rewrite `addChangeOrderAffectedItem` (service)
- [ ] Task 6: Change-type selector + switch handling (service + route + models)
- [ ] Task 7: Drop the one-open-CO-per-part guard
- [ ] Task 8: Hide CO-owned Draft methods from version list/copy-target sites
- [ ] Task 9: CO detail loader loads each affected item's draft method rows
- [ ] Task 10: Parameterize `BillOfMaterial` / `BillOfProcess` for embedding (prop tweaks)
- [ ] Task 11: Embed the editors + `PartProperties` on the CO page per change-type
- [ ] Task 12: Build the 2-way diff/merge component (authoring view-only + release interactive)
- [ ] Task 13: Rewrite `applyChangeOrder` to dispatch by change type at release
- [ ] Task 14: Barrel, path helpers, and AGENTS.md sync
- [ ] Task 15: Scoped typecheck + unit tests
- [ ] Task 16: Browser verification via `/test`

## Dependencies
- Task 2 needs Task 1 (types regen after migration).
- Task 3 needs Task 2 (types). Tasks 4 can run in parallel with Task 3 (pure deletion).
- Tasks 5, 6, 7 need Task 3 (models). Task 5 is the spine for 6.
- Task 8 is independent of 5–7 (touches items UI/service only) — can run parallel.
- Task 9 needs Task 5 (draft exists). Task 10 is independent (prop refactor) — parallel with 9.
- Task 11 needs Tasks 9 + 10. Task 12 needs Task 3 (diff types) + can develop parallel to 9–11.
- Task 13 needs Tasks 5 + 3. Task 14 needs 3–13 landed. Tasks 15–16 are last.

## Global rules for the executor
- **Never** rebuild the DB. After Task 1 the user runs the local reset; you only *write* the
  migration file and then run `pnpm run generate:types` (Task 2) once the user confirms the
  reset is done. If `generate:types` errors with "relation does not exist", STOP — the user
  has not reset yet; do not proceed to typecheck.
- Permission domain for all CO routes/RLS is **`parts`** (`parts_view/create/update/delete`).
- Every service query scopes by `companyId`. Multi-row writes use Kysely transactions.
- Typecheck is **scoped**: `pnpm exec turbo run typecheck --filter=erp` (the package is named
  `erp`, not `@carbon/erp`) and `--filter=@carbon/database`. Never whole-repo typecheck (OOMs).
- Do not hand-edit generated DB types.

---

## Task 1: Rewrite migration `20260712151500_change-orders.sql` in place to the v2 end-state

**Depends on:** none
**Files:**
- Modify: `packages/database/supabase/migrations/20260712151500_change-orders.sql` — edit in
  place (Q8: no new migration file; feature is local/unshipped).
- Read for context: the current file (tables `changeOrder`, `changeOrderType`,
  `changeOrderAffectedItem`, `changeOrderStaged*` ×5, `changeOrderSupersession`,
  `changeOrderActionTask`, `item.revisionStatus`, `item.changeOrderId`,
  `companySettings.plmReleaseControl`, sequence + realtime).

**Steps:**
1. **Delete** the five staged-table blocks entirely (sections 6b, 6c, 6c-i/ii/iii, 6d):
   `changeOrderStagedMaterial`, `changeOrderStagedOperation`, `changeOrderStagedOperationStep`,
   `changeOrderStagedOperationParameter`, `changeOrderStagedOperationTool`,
   `changeOrderStagedItemAttributes` — including their indexes, `ENABLE ROW LEVEL SECURITY`,
   and all four RLS policies each. Lines ~288–580 in the current file.
2. **Add an enum** for the per-affected-item change type, near the other `CREATE TYPE`
   statements (after `changeOrderTaskStatus`, ~line 49):
   ```sql
   CREATE TYPE "changeOrderChangeType" AS ENUM (
     'Version',
     'Revision',
     'New Part'
   );
   ```
3. **Add `changeOrderId` to `makeMethod`** (CO-owned + hideable draft link). Place this AFTER
   the `changeOrder` table is created (it FKs to `changeOrder`), e.g. right after section 4
   (~line 219, before the affected-item section). Guard idempotently:
   ```sql
   ALTER TABLE "makeMethod" ADD COLUMN IF NOT EXISTS "changeOrderId" TEXT;
   ALTER TABLE "makeMethod" ADD CONSTRAINT "makeMethod_changeOrderId_fkey"
     FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
   CREATE INDEX IF NOT EXISTS "makeMethod_changeOrderId_idx" ON "makeMethod" ("changeOrderId");
   ```
   (Note: `makeMethod` has a single-column PK `id`, no `companyId` in its PK — verified in
   `20250603011801_make-method-version.sql`. Do NOT add a composite constraint.)
4. **Extend `changeOrderAffectedItem`** — inside its `CREATE TABLE` (section 6a), add these
   columns after `sortOrder` and before the cutover config block:
   ```sql
   "changeType" "changeOrderChangeType" NOT NULL DEFAULT 'Version',
   -- The CO-owned Draft make method this affected item edits (created on add).
   "draftMakeMethodId" TEXT,
   -- The Active method version the draft was copied from (merge base for the
   -- 2-way diff at release). Nullable for a fresh NewPart with no source method.
   "baseMakeMethodId" TEXT,
   ```
   Add the FKs to the constraint list (both SET NULL so deleting a method doesn't cascade):
   ```sql
   CONSTRAINT "changeOrderAffectedItem_draftMakeMethodId_fkey" FOREIGN KEY ("draftMakeMethodId") REFERENCES "makeMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE,
   CONSTRAINT "changeOrderAffectedItem_baseMakeMethodId_fkey" FOREIGN KEY ("baseMakeMethodId") REFERENCES "makeMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE,
   ```
   Add indexes after the existing ones:
   ```sql
   CREATE INDEX "changeOrderAffectedItem_draftMakeMethodId_idx" ON "changeOrderAffectedItem" ("draftMakeMethodId");
   ```
   Keep the existing `newItemId`, `supersessionMode`, `discontinuationDate`,
   `successorEffectivityDate`, `changeSummary` columns as-is.
5. Leave `changeOrder`, `changeOrderType`, `changeOrderSupersession`, `changeOrderActionTask`,
   `item.revisionStatus`, `item.changeOrderId`, `companySettings.plmReleaseControl`, the custom
   field registration, sequence seed, and realtime block **unchanged**. (Q4 defers item release
   status — `plmReleaseControl` stays but is not wired to any guard this version; leaving the
   column is harmless.)
6. Do NOT change the file's timestamp or rename it (editing in place — Q8).

**If** any staged-table name is referenced by a NOT-yet-deleted trigger/view elsewhere in this
migration file, STOP and report — there should be none (the staged tables are self-contained).

**Verify:**
```bash
grep -c "changeOrderStaged" packages/database/supabase/migrations/20260712151500_change-orders.sql
# Expected: 0
grep -n "changeOrderChangeType\|draftMakeMethodId\|makeMethod.*changeOrderId\|ADD COLUMN.*changeOrderId" packages/database/supabase/migrations/20260712151500_change-orders.sql
# Expected: the new enum, the makeMethod.changeOrderId ALTER, and the affected-item columns present
```

**Out of scope:** any new migration file; `item.releaseStatus`/enforce-warn ladder (Q4 deferred);
action-template schema (Q7 fast-follow); touching other migrations.

---

## Task 2: Regenerate DB types

**Depends on:** Task 1 (and the user having run the local DB reset — ask/confirm first)
**Files:**
- Modify (generated): `packages/database/src/types.ts` — do not hand-edit; regenerate.

**Steps:**
1. Confirm with the user that they have reset/re-migrated the local DB (Q8 says the user runs
   the reset). If unconfirmed, STOP and ask — `generate:types` reads the live local DB.
2. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -n "changeOrderChangeType\|draftMakeMethodId" packages/database/src/types.ts | head
# Expected: the enum type and the changeOrderAffectedItem.draftMakeMethodId column present
grep -c "changeOrderStagedMaterial" packages/database/src/types.ts
# Expected: 0 (staged tables gone)
```

**Out of scope:** any typecheck yet (do it after code changes, Task 15).

---

## Task 3: Rewrite `changeOrder.models.ts` for v2

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/items/changeOrder.models.ts`
- Copy from (precedent): the file's existing header/status validators (keep them).

**Steps:**
1. **Add** the change-type enum const + validator near the top (after `changeOrderTaskStatus`,
   ~line 47):
   ```ts
   export const changeOrderChangeTypes = ["Version", "Revision", "New Part"] as const;
   export type ChangeOrderChangeType = (typeof changeOrderChangeTypes)[number];
   ```
2. **Extend `changeOrderAffectedItemValidator`** (currently `{ id?, changeOrderId, itemId }`) —
   add `changeType`:
   ```ts
   export const changeOrderAffectedItemValidator = z.object({
     id: zfd.text(z.string().optional()),
     changeOrderId: z.string().min(1, { message: "Change order is required" }),
     itemId: z.string().min(1, { message: "Item is required" }),
     changeType: z.enum(changeOrderChangeTypes).default("Version")
   });
   ```
3. **Add** a dedicated validator for changing the type on an existing affected item (used by
   Task 6 route):
   ```ts
   export const changeOrderAffectedItemChangeTypeValidator = z.object({
     id: z.string().min(1, { message: "Id is required" }),
     changeType: z.enum(changeOrderChangeTypes)
   });
   ```
4. **Delete** all staged validators (mirror tables are gone): `changeOrderStagedMaterialValidator`,
   `changeOrderStagedOperationValidator`, `changeOrderStagedOperationStepValidator`,
   `changeOrderStagedOperationParameterValidator`, `changeOrderStagedOperationToolValidator`,
   `changeOrderStagedItemAttributesValidator` (lines ~158–252 in the current file).
5. **Keep** `changeOrderAffectedItemCutoverValidator`, `changeOrderSupersessionValidator`,
   `changeOrderActionValidator`, `changeOrderActionStatusValidator`, the status machine
   (`changeOrderStatus*`, `isAllowedChangeOrderTransition`, `changeOrderOpenStatuses`,
   `isChangeOrderLocked`, `canEditChangeOrder`), `changeOrderTypeValidator`, and the diff types
   (`MethodDiffStatus`, `MethodDiffEntry`, `ChangeOrderItemDiff`) — the diff engine still uses them.
6. Update the file's top comment block to describe the v2 model (edits live on a real Draft
   make method; no staged mirror tables).

**If** any deleted staged validator is still imported anywhere after Task 4, the typecheck in
Task 15 will catch it — that's expected; fix imports there.

**Verify:**
```bash
grep -c "Staged" apps/erp/app/modules/items/changeOrder.models.ts
# Expected: 0
grep -n "changeOrderChangeTypes\|changeType" apps/erp/app/modules/items/changeOrder.models.ts
# Expected: the enum const + changeType in the affected-item validators
```

**Out of scope:** service/route logic (later tasks).

---

## Task 4: Delete v1 staging service, forked editors, and staging routes

**Depends on:** none (pure deletion; may run parallel with Task 3)
**Files:**
- Delete: `apps/erp/app/modules/items/changeOrder.staging.ts`
- Delete: `apps/erp/app/modules/items/changeOrder.staging.operations.ts`
- Delete (UI forks under `apps/erp/app/modules/items/ui/ChangeOrder/`):
  `ChangeOrderBomEditor.tsx`, `ChangeOrderBopEditor.tsx`, `ChangeOrderBopChildren.tsx`,
  `ChangeOrderBopSteps.tsx`, `ChangeOrderBopParameters.tsx`, `ChangeOrderBopTools.tsx`,
  `ChangeOrderAttributesEditor.tsx`
- Delete (staging routes under `apps/erp/app/routes/x+/items+/change-order+/`):
  `$id.affected.$affectedId.material.tsx`, `$id.affected.$affectedId.material.delete.$materialId.tsx`,
  `$id.affected.$affectedId.material.order.tsx`,
  `$id.affected.$affectedId.operation.tsx`, `$id.affected.$affectedId.operation.delete.$operationId.tsx`,
  `$id.affected.$affectedId.operation.order.tsx`,
  `$id.affected.$affectedId.operation.$operationId.step.tsx`,
  `$id.affected.$affectedId.operation.$operationId.step.delete.$stepId.tsx`,
  `$id.affected.$affectedId.operation.$operationId.parameter.tsx`,
  `$id.affected.$affectedId.operation.$operationId.parameter.delete.$parameterId.tsx`,
  `$id.affected.$affectedId.operation.$operationId.tool.tsx`,
  `$id.affected.$affectedId.operation.$operationId.tool.delete.$toolId.tsx`,
  `$id.affected.$affectedId.attributes.tsx`
- Modify: `apps/erp/app/modules/items/index.ts` — remove the two `export * from "./changeOrder.staging..."`
  lines (barrel currently re-exports staging at ~lines 5 & 7).
- Do NOT delete: `ChangeOrderReview.tsx` or `diff-ui.tsx` yet — Task 12 folds them into the new
  merge component; delete them there.

**Steps:**
1. `git rm` (or delete) each file listed above.
2. Remove the staging barrel exports from `index.ts`.
3. Grep the repo for imports of any deleted symbol and note them (they'll be fixed by later tasks
   / Task 15). Do NOT fix call sites here — later tasks own the replacements.

**Verify:**
```bash
ls apps/erp/app/modules/items/changeOrder.staging*.ts 2>/dev/null | wc -l
# Expected: 0
ls apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderBom* apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderBop* apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderAttributesEditor.tsx 2>/dev/null | wc -l
# Expected: 0
ls apps/erp/app/routes/x+/items+/change-order+/'$id.affected.$affectedId.material'* 2>/dev/null | wc -l
# Expected: 0
```

**Out of scope:** `ChangeOrderReview.tsx`, `diff-ui.tsx`, `changeOrder.diff.ts` (kept — Task 12).

---

## Task 5: Add draft-make-method orchestration + rewrite `addChangeOrderAffectedItem`

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/items/changeOrder.service.ts` — move `addChangeOrderAffectedItem`
  here (it lived in the now-deleted `changeOrder.staging.ts`) and rewrite it.
- Read (precedent for method helpers): `apps/erp/app/modules/items/items.service.ts` —
  `activateMethodVersion` (:71), `copyItem`/`copyMakeMethod` (:87/:113), `createRevision` (:139),
  `upsertMakeMethodVersion` (:3810), `mintPlaceholderPart` (in `changeOrder.service.ts` per v1 —
  grep for it). `getItem`, `getMakeMethods`, `getMakeMethodById`.
- Read (precedent for the old snapshot logic being replaced): the deleted `changeOrder.staging.ts`
  `addChangeOrderAffectedItem` via git (`git show HEAD:apps/erp/app/modules/items/changeOrder.staging.ts`).

**Steps:**
1. Implement a helper `createChangeOrderDraftMethod(client, { changeOrderId, itemId, changeType,
   companyId, userId })` returning `{ data?: { draftMakeMethodId, baseMakeMethodId, newItemId }, error? }`.
   Dispatch on `changeType`:
   - **Version** (default): find the item's current Active make method via `getMakeMethods` (the
     one with `status='Active'`, else the highest version). Call `upsertMakeMethodVersion` to spawn
     a **new Draft version on the same item** copying that Active version. Set the new draft's
     `changeOrderId = changeOrderId` (UPDATE `makeMethod` after creation). Return
     `{ draftMakeMethodId: <new>, baseMakeMethodId: <active id>, newItemId: null }`.
   - **Revision**: load the source item (`getItem`), call `createRevision(serviceRole, { item,
     revision: <next rev>, createdBy: userId, active: false })`. The new inactive item gets its own
     Draft make method via the existing `create_make_method_related_records` trigger + method copy.
     Fetch that new item's Draft make method (`getMakeMethods(newItemId)` → the Draft). Stamp BOTH
     `item.changeOrderId = changeOrderId` on the new item AND `makeMethod.changeOrderId` on its draft.
     Return `{ draftMakeMethodId, baseMakeMethodId: <source active id>, newItemId }`.
   - **New Part**: mint a brand-new part number (new `readableId`) derived from the affected part,
     inactive, with `item.changeOrderId` set — reuse `mintPlaceholderPart` (v1 helper in
     `changeOrder.service.ts`; confirm its signature) to create the item, then `copyMakeMethod`
     from the affected part's Active method onto the new item's Draft method. Stamp
     `makeMethod.changeOrderId`. Return `{ draftMakeMethodId, baseMakeMethodId: <source active id>, newItemId }`.
   - **Escape hatch:** `createRevision` reuses the source `readableId` and `copyItem`/`copyMakeMethod`
     copy to an *existing* target — neither mints a new part number. If `mintPlaceholderPart` does
     not exist or cannot create a fresh `readableId` for the New Part case, STOP and report;
     do not invent a new edge function without confirmation.
2. Rewrite `addChangeOrderAffectedItem(client, db, { changeOrderId, itemId, changeType, companyId,
   userId })`:
   - Insert the `changeOrderAffectedItem` row (`itemId`, `changeType`, `sortOrder = max+1`,
     `companyId`, audit).
   - Call `createChangeOrderDraftMethod(...)`; write the returned `draftMakeMethodId`,
     `baseMakeMethodId`, and (for Revision/New Part) `newItemId` back onto the affected-item row.
   - **Remove** all the v1 snapshot-into-staging logic and the inline one-open-CO-per-part guard
     (lines ~162–188 of the old staging file — Task 7 formally drops the guard; do not re-add it).
   - Return `{ data: { id, draftMakeMethodId }, error }`.
3. Export `addChangeOrderAffectedItem` and `createChangeOrderDraftMethod` from the barrel
   (`index.ts`) via `changeOrder.service`.

**If** the trigger-created Draft method for a new revision is not queryable immediately after
`createRevision` returns (timing), STOP and report — do not poll/sleep; the release path and this
path both assume the method exists synchronously (v1 relied on the same trigger).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -i "changeOrder.service" | head
# Expected: no errors originating in changeOrder.service.ts (import errors from other files are fixed in later tasks)
grep -n "createChangeOrderDraftMethod\|addChangeOrderAffectedItem" apps/erp/app/modules/items/changeOrder.service.ts
# Expected: both defined here
```

**Out of scope:** the change-type *switch* after add (Task 6); release (Task 13); the route
already calls `addChangeOrderAffectedItem` — update its formData to pass `changeType` in Task 6.

---

## Task 6: Change-type selector + switch handling

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/routes/x+/items+/change-order+/$id.affected.tsx` — pass `changeType`
  from the validated form data into `addChangeOrderAffectedItem`.
- Create: `apps/erp/app/routes/x+/items+/change-order+/$id.affected.$affectedId.change-type.tsx`
  — action to switch an existing affected item's change type.
- Modify: `apps/erp/app/modules/items/changeOrder.service.ts` — add
  `updateChangeOrderAffectedItemChangeType(...)`.
- Modify: `apps/erp/app/modules/items/ui/ChangeOrder/AffectedItemCard.tsx` — add the change-type
  `<Select>` (default Version). Precedent for an inline per-row select posting via fetcher:
  the cutover controls already on this card (grep the file for `useFetcher` + `path.to.changeOrder…`).
- Modify: `apps/erp/app/utils/path.ts` — add `changeOrderAffectedChangeType(id, affectedId)`
  → `${x}/items/change-order/${id}/affected/${affectedId}/change-type` (mirror the existing
  `changeOrderAffected` key at ~line 697).

**Steps:**
1. In `$id.affected.tsx`, add `changeType` to the destructure from `validation.data` and pass it
   through to `addChangeOrderAffectedItem`.
2. Implement `updateChangeOrderAffectedItemChangeType(client, db, { id, changeType, companyId,
   userId })`:
   - Load the affected item (need its `itemId`, current `changeType`, `draftMakeMethodId`,
     `newItemId`).
   - If `changeType` unchanged → no-op success.
   - Otherwise: **discard the current draft** (delete the CO-owned Draft make method rows and, for
     the old Revision/New Part case, the CO-owned inactive item) and **recreate** via
     `createChangeOrderDraftMethod` for the new type. This is the clean, unambiguous rule per the
     Q2 capability matrix (Version has BoM/BoP + no attrs; Revision has attrs/files + NO BoM/BoP;
     New Part has both) — switching type changes which editable surface exists, so the draft is
     rebuilt from the affected part's current Active method.
   - Update the affected-item row's `changeType`, `draftMakeMethodId`, `baseMakeMethodId`, `newItemId`.
   - **Escape hatch:** if the user has already edited the draft and silently discarding those edits
     on switch is judged too destructive, STOP and confirm whether a confirm-dialog / block-on-dirty
     is wanted before implementing silent recreate. (Default: recreate; the card copy warns
     "changing type resets edits".)
3. Add the new route action following the standard shape (`assertIsPost` → `requirePermissions({
   update: "parts" })` → `validator(changeOrderAffectedItemChangeTypeValidator).validate` →
   service → flash/`data`). Use `getDatabaseClient()` for the transactional service call.
4. On `AffectedItemCard`, render the change-type `<Select>` (options from `changeOrderChangeTypes`),
   default `Version`, posting to the new route via `useFetcher`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -iE "affected|change-type" | head
# Expected: no errors in the new route / AffectedItemCard / service function
```

**Out of scope:** gating which editors show per type (Task 11 does the conditional embed).

---

## Task 7: Drop the one-open-CO-per-part guard

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/items/changeOrder.reads.ts` — `findOtherOpenChangeOrdersForItem`
  (:137). Since same-part parallel is now supported (Q3), this guard must no longer block.
- Modify: `apps/erp/app/modules/items/ui/ChangeOrder/ItemOpenChangeOrderAlert.tsx` — keep as an
  informational alert (it may still *inform* that other open COs exist), but it must not prevent
  adding the item.

**Steps:**
1. Confirm `findOtherOpenChangeOrdersForItem` has no remaining *blocking* call site (v1's inline
   guard lived in the deleted `changeOrder.staging.ts`; the standalone function was noted as unused).
   Grep the repo. If a blocking call site exists, remove the block (allow the add to proceed).
2. Keep the function itself (it powers the informational alert / history). Do NOT delete it if
   `ItemOpenChangeOrderAlert` or `findChangeOrdersForItem` reads it — just ensure it is advisory.
3. Ensure `addChangeOrderAffectedItem` (Task 5) contains **no** guard that rejects an item already
   on another open CO.

**Verify:**
```bash
grep -rn "findOtherOpenChangeOrdersForItem" apps/erp/app | grep -v "reads.ts"
# Expected: only advisory/UI usages (or none) — no throw/reject that blocks adding an affected item
```

**Out of scope:** conflict *detection*/3-way merge (Q3 deferred — resolution is the 2-way merge at
release, Task 12).

---

## Task 8: Hide CO-owned Draft methods from version-list / copy-target sites

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/MakeMethodTools.tsx` (~:191–207) — the
  `availableVersions` "Copy To" target list currently filters `status === "Draft"`; also exclude
  drafts with a non-null `changeOrderId`.
- Modify: `apps/erp/app/routes/x+/part+/$itemId.tsx` (~:105–112) — the loader calls
  `getMakeMethods()` then picks a version; ensure a CO-owned Draft (`changeOrderId != null`) is
  never auto-selected or offered as a selectable version.
- Read (precedent): `getMakeMethods` in `items.service.ts` (:1155) returns all versions unfiltered.

**Steps:**
1. Decide the filter site. Preferred: filter in the **read** so all consumers are safe — but
   `getMakeMethods` is used by the release path too, so do NOT change its signature/behavior.
   Instead filter at the two **list/switcher UI sites** above: exclude rows where
   `makeMethod.changeOrderId` is not null. (Confirmed: there is no general "all versions" switcher
   component beyond these; MRP/jobs/cost read the `activeMakeMethods` view which already excludes
   non-Active, so CO Drafts are invisible there — no change needed.)
2. In `MakeMethodTools.tsx`, extend the existing `.filter(...)` to `&& !m.changeOrderId`.
3. In `$itemId.tsx`, when choosing the version to display, skip any `changeOrderId != null` draft
   (fall back to Active/first non-CO version).
4. For Revision/New Part CO-owned items: they are created `item.active = false`, so the type list
   views (e.g. `PartsTable` revisions submenu) already hide them — verify no extra work, and if an
   inactive CO item leaks into a picker, note it but do not expand scope beyond method-version lists.

**Verify:**
```bash
grep -n "changeOrderId" apps/erp/app/modules/items/ui/Item/MakeMethodTools.tsx apps/erp/app/routes/x+/part+/\$itemId.tsx
# Expected: the new exclusion checks present at both sites
```

**Out of scope:** MRP/job/cost paths (already safe via `activeMakeMethods`); building a new version
switcher.

---

## Task 9: CO detail loader loads each affected item's draft method rows

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/routes/x+/items+/change-order+/$id.tsx` (and/or `$id._index.tsx` — whichever
  owns the affected-items detail loader; confirm by reading both).
- Read (precedent): `apps/erp/app/routes/x+/part+/$itemId.make.$makeMethodId.tsx` loader
  (:33–137) — it loads `getMakeMethodById`, `getMethodMaterialsByMakeMethod`,
  `getMethodOperationsByMakeMethodId` and shapes the props for `BillOfMaterial`/`BillOfProcess`.

**Steps:**
1. In the CO detail loader, for each `changeOrderAffectedItem`, load its `draftMakeMethodId`'s
   method header + materials + operations (with operation children) using the same three service
   functions the part make-method route uses. Shape them identically to what `BillOfMaterial` /
   `BillOfProcess` expect (see Task 10 prop contracts).
2. Return them keyed by `affectedItemId` so the detail component can pass the right rows to each
   embedded editor.
3. React Router re-runs this loader after any mutation on the current route, so editor edits
   refresh automatically — do not add manual revalidation unless a mutation posts to a *different*
   route; if so, add an `onMutateSuccess`/`useRevalidator` call (only if needed).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -i "change-order+/\$id" | head
# Expected: loader compiles; returned shape matches the editor props used in Task 11
```

**Out of scope:** rendering (Task 11).

---

## Task 10: Parameterize `BillOfMaterial` / `BillOfProcess` for embedding

**Depends on:** none (prop refactor; parallel with Task 9)
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx` (1417 lines)
- Modify: `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx` (3123 lines)
- Read (precedent): both are already fully prop-driven and post mutations to the normal method
  routes by `makeMethodId` (`path.to.newMethodMaterial`, `path.to.methodOperation(id)`, etc.).

**Steps:**
1. `BillOfMaterial.tsx`: the nested `MaterialForm` reads `useParams()` for `itemId` at `:649`
   (used `:739` self-add check, `:818` picker blacklist). Add an optional `parentItemId?: string`
   prop to the component, thread it to `MaterialForm`, and prefer `parentItemId ?? params.itemId`.
   This is the only coupling to the item route (~<20 lines). Do NOT change the mutation route
   targets — posting to `path.to.newMethodMaterial` with the draft's `makeMethodId` correctly
   writes to the CO-owned draft.
2. `BillOfProcess.tsx`: it reads `useParams().materialId` at `:820` for configurator field keys.
   Add an optional `selectedMaterialId?: string` prop and prefer it over `params.materialId`.
3. The `makeMethod.status !== "Draft"` read-only gate (BOM `:181`/`:529`, BOP `:223`) is already
   satisfied — the CO draft's status is `Draft` — so editing is enabled. No change there.
4. Keep both components' public behavior for the normal item route unchanged (props are optional;
   fall back to `useParams`).

**If** either component turns out to have additional hard couplings to the item route beyond the
two `useParams` reads (e.g. a hardcoded loader import or a `useMatches` on the part route), STOP and
report — plan-v2 verified only these two; a third coupling changes the estimate.

**Verify:**
```bash
grep -n "parentItemId\|selectedMaterialId" apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx
# Expected: the new optional props threaded through
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -iE "BillOf(Material|Process)" | head
# Expected: no new errors; existing part route still compiles
```

**Out of scope:** where they're mounted (Task 11).

---

## Task 11: Embed the editors + `PartProperties` on the CO page per change type

**Depends on:** Tasks 9, 10, 6
**Files:**
- Modify: the CO detail UI — `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderContent.tsx`
  and/or `AffectedItems.tsx` / `AffectedItemCard.tsx` (confirm which renders the per-affected-item
  body; read them).
- Read (precedent): `apps/erp/app/routes/x+/part+/$itemId.make.$makeMethodId.tsx` for how
  `BillOfMaterial`/`BillOfProcess` are composed with their props; `PartProperties.tsx` for its
  `data` prop shape (:56–67).

**Steps:**
1. For each affected item, render its editors **gated by `changeType`** per the Q2 matrix:
   - **Version** → `BillOfMaterial` + `BillOfProcess` (pass the draft method + rows from Task 9,
     `parentItemId = affectedItem.itemId`, `makeMethod = <draft>`). No attribute editor, no files,
     no supersession UI.
   - **Revision** → `PartProperties` (attributes/spec) + files; NO `BillOfMaterial`/`BillOfProcess`
     (strict — BoM/BoP change must be a Version). Supersession card shows the auto old-rev→new-rev.
   - **New Part** → `BillOfMaterial` + `BillOfProcess` + `PartProperties` (both surfaces).
     Supersession card shows the auto affected-part→new-part.
2. `PartProperties` is pointed at the draft's **item** (`newItemId` for Revision/New Part). It posts
   to `path.to.bulkUpdateItems` etc. — which write to that item; since the item is CO-owned and
   inactive, edits are isolated until release.
3. Keep everything on the CO page — **no redirects** (Q5).

**If** `PartProperties` requires loader-provided promises (`files`, `makeMethods`) that the CO
loader doesn't yet provide, extend the Task 9 loader to supply them for Revision/New Part affected
items; if that balloons scope, STOP and report.

**Verify:** browser check deferred to Task 16. Static:
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -iE "ChangeOrderContent|AffectedItem|PartProperties" | head
# Expected: no errors; editors mounted with the draft method + change-type gating
```

**Out of scope:** the diff/merge panel (Task 12).

---

## Task 12: Build the 2-way diff/merge component (authoring view-only + release interactive)

**Depends on:** Task 3 (diff types), Task 5 (draft exists)
**Files:**
- Create: `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderDiff.tsx` (the one component, two
  modes).
- Modify/repurpose: `apps/erp/app/modules/items/changeOrder.diff.ts` — repoint `getChangeOrderDiff`
  to diff the **Draft make method (`draftMakeMethodId`) vs the current Active method
  (`baseMakeMethodId` at authoring, current-live at release)** instead of staged-vs-live. The pure
  `diffMethod(before, after)` engine stays; only the DB-facing wrapper's inputs change (two real
  methods now).
- Delete (fold in): `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderReview.tsx` and
  `diff-ui.tsx` — migrate their row-rendering into `ChangeOrderDiff.tsx`, then delete.
- Read (precedent): `ChangeOrderReview.tsx` + `diff-ui.tsx` (row/badge rendering);
  `changeOrder.diff.ts` + `changeOrder.diff.test.ts` (engine + its tests).

**Steps:**
1. **Authoring mode (view-only):** given an affected item, call `getChangeOrderDiff` with
   `before = baseMakeMethodId`'s rows, `after = draftMakeMethodId`'s rows; render before→after
   read-only (reuse the added/removed/modified/unchanged classification + `diff-ui` row rendering).
   Add a note "resolution happens at release."
2. **Release mode (interactive):** `before = current Active method of the target` (re-read live at
   release, not the cached base), `after = draft`. Render a git-conflict-style per-line "keep"
   selector so the user picks what to keep per material/operation. The selection is what takes
   effect at release (Task 13 consumes it). A 2-way merge cannot distinguish "set on purpose" from
   "stale starting value" — that's accepted (Q3): reverting another CO's untouched line is the
   user's authorized decision; surface it, don't block.
3. Update `changeOrder.diff.test.ts` to cover the two-real-methods inputs (the engine signature is
   unchanged; adjust fixtures to real method rows). Keep it green.
4. **Escape hatch:** if wiring the release-mode "keep" selection into `applyChangeOrder` requires a
   persisted resolution payload (not just client state), define a minimal shape (e.g. a JSON of
   kept row ids posted with the release action) and document it here — do NOT add a new table for
   it (Q8 wants no new schema). If a table seems unavoidable, STOP and confirm.

**Verify:**
```bash
pnpm --filter erp test -- changeOrder.diff 2>&1 | tail -20
# Expected: diff engine tests pass with the two-real-methods fixtures
grep -rn "ChangeOrderReview\|diff-ui" apps/erp/app | grep -v "ChangeOrderDiff"
# Expected: 0 (folded in and deleted)
```

**Out of scope:** the release write itself (Task 13); 3-way / provenance (Q3 deferred).

---

## Task 13: Rewrite `applyChangeOrder` to dispatch by change type at release

**Depends on:** Tasks 5, 3, 12
**Files:**
- Modify: `apps/erp/app/modules/items/changeOrder.server.ts` — `applyChangeOrder` (the
  Implementation → Done release). Read the current implementation first (it materialized staged
  end-state onto a new revision in v1 — that whole path is replaced).
- Read (precedent — canonical helpers, do not re-implement): `items.service.ts`
  `activateMethodVersion` (:71), `createRevision` (:139), `upsertItemSupersession` (:3636).

**Steps:**
1. Replace the v1 "materialize staged end-state" logic with a **dispatch by
   `changeOrderAffectedItem.changeType`** per affected item (draft is already a real method — no
   materialization needed):
   - **Version** → `activateMethodVersion(draftMakeMethodId)` (Draft → Active on the same item;
     prior Active → Archived). Clear `makeMethod.changeOrderId` on the draft (it becomes normal
     history). No new item, **no supersession** (Q2).
   - **Revision** → the draft already lives on the `newItemId` (inactive item). `activateMethodVersion`
     its Draft method + reveal the item (`item.active = true`), keep `item.changeOrderId` stamped,
     clear `makeMethod.changeOrderId`, and auto-write `itemSupersession(oldRev → newRev)` via
     `upsertItemSupersession` using the affected item's cutover config (`supersessionMode`, dates).
   - **New Part** → reveal the new part (`item.active = true`), activate its Draft method, clear
     `makeMethod.changeOrderId`, and auto-write `itemSupersession(affectedPart → newPart)`.
2. Then apply the manual `changeOrderSupersession` rows via `upsertItemSupersession` (unchanged from v1).
3. Set `item.releaseStatus`? — **No** (Q4 deferred). Skip.
4. Consume the release-mode merge resolution (Task 12): before activating, if the user chose to keep
   specific live lines over the draft's, apply those choices to the draft method rows (via the
   normal `upsertMethodMaterial`/`deleteMethodMaterial`/operation helpers) so the activated version
   reflects the resolved merge. If no resolution payload is present (single-CO, no conflict), activate
   the draft as-is.
5. Keep the v1 **idempotency + CAS** discipline: per-affected-item `newItemId`/activation is the
   idempotency marker (skip already-released items on re-run); the final flip to `Done` is the Kysely
   CAS on `fromStatus`. Edge-function calls are not one transaction (G2) — preserve that structure.

**If** clearing `makeMethod.changeOrderId` at activation conflicts with `activateMethodVersion`'s
edge-function (`convert`) internals (e.g. it recreates the row), STOP and report — verify the column
survives the convert before relying on the clear.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -i "changeOrder.server" | head
# Expected: no errors
grep -n "changeType\|activateMethodVersion\|upsertItemSupersession" apps/erp/app/modules/items/changeOrder.server.ts
# Expected: dispatch on changeType calling the canonical helpers
```

**Out of scope:** browser proof (Task 16).

---

## Task 14: Barrel, path helpers, and AGENTS.md sync

**Depends on:** Tasks 3–13
**Files:**
- Modify: `apps/erp/app/modules/items/index.ts` — ensure all live CO service/model exports are
  present and no deleted-file exports remain.
- Modify: `apps/erp/app/utils/path.ts` — confirm the new `changeOrderAffectedChangeType` key
  (Task 6) is present; remove any path keys that pointed only at deleted staging routes (Task 4).
- Modify: `apps/erp/app/modules/items/AGENTS.md` — the "Change Orders (sub-area)" section currently
  documents the v1 staged-mirror model. Rewrite it to the v2 model: edits live on a real CO-owned
  Draft make method; per-affected-item `changeType` (Version/Revision/New Part) drives release;
  editors are the embedded real `BillOfMaterial`/`BillOfProcess`/`PartProperties`; same-part parallel
  supported via 2-way diff/merge at release; drop the "one open CO per part" and "staged tables"
  claims; update the CO data-model table (remove `changeOrderStaged*`, add `changeType`/
  `draftMakeMethodId`/`baseMakeMethodId`, `makeMethod.changeOrderId`).
- Modify (if present): `.ai/rules/revision-system.md` — add a one-line note that CO-owned Draft
  methods carry `makeMethod.changeOrderId` and are hidden from version lists until release.

**Steps:**
1. Grep for stale references to deleted staging symbols/routes and fix or remove them.
2. Rewrite the AGENTS.md CO section grounded in the final code (not this plan).

**Verify:**
```bash
grep -rn "changeOrderStaged\|changeOrder.staging" apps/erp/app | wc -l
# Expected: 0
grep -n "draftMakeMethodId\|changeType\|2-way" apps/erp/app/modules/items/AGENTS.md
# Expected: v2 model documented
```

**Out of scope:** none.

---

## Task 15: Scoped typecheck + unit tests

**Depends on:** Tasks 1–14
**Files:** none (verification only)

**Steps:**
1. `pnpm run generate:types` if not already current (only after the user's DB reset).
2. Fix any residual import errors from deleted staging symbols (should be localized).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 errors
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors (if a pre-existing TS2589 in an unrelated file appears, see the
# erp-ts2589-instantiation-budget memory — prefer flat selects / @ts-expect-error, don't
# expand type surface)
pnpm --filter erp test -- changeOrder 2>&1 | tail -20
# Expected: all changeOrder tests pass
```

**Out of scope:** whole-repo typecheck (OOMs — forbidden).

---

## Task 16: Browser verification via `/test`

**Depends on:** Task 15 (green typecheck)
**Files:** none (produces a playbook under `.ai/playbooks/`)

**Steps:** Use the `/test` skill (requires a running dev stack + `/auth`). Verify end-to-end:
1. Create a CO, add an affected part (defaults to **Version**) → the embedded `BillOfMaterial` /
   `BillOfProcess` render pointed at the CO-owned Draft; edit a BOM line and an operation; confirm
   the edit persists on reload and the **item's normal make-method page does NOT show** the draft
   version (hidden until release).
2. Switch the affected item to **Revision** → BoM/BoP editors disappear, `PartProperties`/files
   appear; confirm the switch reset the draft.
3. Switch to **New Part** → both surfaces appear; a new inactive part number exists, hidden from
   parts list.
4. Authoring diff panel shows before→after read-only.
5. Advance to Implementation → release: the interactive 2-way merge lets you pick per line; release
   activates the draft (Version = new active version same item; Revision = new active revision +
   old→new supersession; New Part = new part active + affected→new supersession). Confirm the CO
   reaches Done and the released method/version/part is now visible normally.
6. **Parallel:** open a second CO on the same part (no block — guard dropped); confirm both can add
   the part and hold independent drafts.

**Verify:** each step passes in-browser with no console/loader errors (use `/error` to capture any
failure). Cache the successful playbook.

**Out of scope:** load/perf testing; the NCR-style action templates (Q7 fast-follow, not this version).
