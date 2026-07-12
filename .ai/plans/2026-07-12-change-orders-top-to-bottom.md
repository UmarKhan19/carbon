# Change Orders — Top-to-Bottom — implementation plan

**Design doc:** /Users/aashu/work/carbon/plans/change-orders/top-to-bottom/plan.md (all 7 decisions resolved)
**Branch:** feat/change-orders-top-to-bottom
**Module:** `apps/erp/app/modules/items/` (Change Orders is a sub-area; permission key = `parts`)

> **Read the design doc first.** It carries the grounded rationale for every decision (Q1 revision-only,
> Q2 supersession propagation, Q3 auto-existence supersession, Q4 revision-centric audit, Q5 git-style
> end-state, Q6 attributes/drawings, Q7 `CO-` prefix). This plan is the mechanical how.

## Deviations from the generic conventions (deliberate, grounded — do not "fix")

1. **Fresh migration at the latest timestamp (updated per user direction 2026-07-12).** The CO feature is
   unshipped, so there is **no backward compat** — the change-orders migration is a single fresh,
   self-contained file defining the FINAL top-to-bottom schema (not a drop-then-recreate diff layered on
   the old one). The original `20260708120000_change-orders.sql` was **renamed** to
   `20260712151500_change-orders.sql` (newest existing was `20260710051147`; none of the 4 later
   migrations reference `changeOrder`, so it's safe at the tail) and rewritten to the clean schema. Because
   the original timestamp was already applied, the **user must do a local DB RESET** (not a plain
   `pnpm db:migrate`, which sees "no new migrations") so all files replay and the renamed fresh migration
   creates the clean schema. Never reset the DB yourself (AGENTS.md).
2. **Single-column `PRIMARY KEY ("id")`.** The existing `changeOrder*` tables use single-column PK + a
   `companyId` column, NOT the composite `("id","companyId")`. New sibling tables match the CO family
   (consistency + avoids the composite-FK PostgREST embed failure in `lessons.md`). If you believe a
   composite PK is required, STOP and ask — do not silently switch.
3. **Named FK constraints** (`CONSTRAINT "x_fkey" FOREIGN KEY ...`) matching the existing CO tables, not
   the inline-audit-FK style of the generic template.

## Progress
- [x] Task 1: Migration — drop bottom-to-top tables, add top-to-bottom tables + `item.changeOrderId`
- [x] Task 2: Regenerate DB types
- [ ] Task 3: Models — replace BOM-change validators with the top-to-bottom validators + diff types
- [ ] Task 4: Service shell — remove BOM-change fns; keep header/status/types/mint/rollup
- [ ] Task 5: Affected-items + staged-material service (snapshot-on-add, staging CRUD)
- [ ] Task 6: Affected-items + staged-material routes
- [ ] Task 7: AffectedItems UI + CO-scoped BOM editor
- [ ] Task 8: Staged-operation service + routes
- [ ] Task 9: CO-scoped BOP editor UI
- [ ] Task 10: Staged item-attributes service + routes + spec-diff UI
- [ ] Task 11: Supersession — per-item cutover config + manual different-part table
- [ ] Task 12: `diffMethod` engine + `getChangeOrderDiff` + ChangeOrderReview UI
- [ ] Task 13: Impact panel re-fed from removed staged materials
- [ ] Task 14: Release orchestration — rewrite `applyChangeOrder` (revision + supersession)
- [ ] Task 15: Status route wiring for release + `getChangeOrderValidations`
- [ ] Task 16: BOP operation-children staging + release reconciliation
- [ ] Task 17: Traceability re-point + revision history + diff UI on part page
- [x] Task 18: Audit config — re-register the new CO children (pulled forward — typecheck gate)
- [ ] Task 19: Cleanup dead bottom-to-top code + AGENTS.md refresh
- [ ] Task 20: Browser verification via /test

## Dependencies
- Task 2 needs Task 1. Tasks 3–4 need Task 2 (generated types).
- Tasks 5→6→7 sequential (service → routes → UI). Same for 8→9 and 10.
- Task 11 needs Task 5 (affected-item row exists).
- Task 12 needs Tasks 5/8/10 (staging tables populated). Task 13 needs Task 5.
- Task 14 needs Tasks 5/8/10/11/12. Task 15 needs Task 14.
- Task 16 needs Task 14. Task 17 needs Task 14. Task 18 needs Task 1. Tasks 19–20 last.
- Independent pairs runnable in parallel by /execute: {8,10} after 7; {13} alongside {8,9}.

---

## Task 1: Migration — fresh top-to-bottom schema at latest timestamp + `item.changeOrderId`

**Depends on:** none
**Files:**
- Renamed + rewritten: `packages/database/supabase/migrations/20260712151500_change-orders.sql`
  (was `20260708120000_change-orders.sql`) — fresh clean schema, no bottom-to-top tables (see Deviation 1)
- Copy from (precedent): the existing table blocks in that same file (`changeOrderProductAffected` ~230, `changeOrderBomChangeAssembly` ~332) for the exact RLS/index/audit style.

**Steps:**
1. **Remove** the entire `changeOrderBomChange` block (~276–325) and the entire
   `changeOrderBomChangeAssembly` block (~327–384), including their `CREATE INDEX`, `ALTER TABLE … ENABLE
   ROW LEVEL SECURITY`, and four `CREATE POLICY` statements. Also remove the `changeOrderProductAffected`
   block (~226–273) — Products Affected is now computed on read (design Q/internal decision).
2. **Remove** the `CREATE TYPE "changeOrderBomChangeType" …` enum (~36–39) — no longer used.
3. **Add** the five new tables below. Place them where the removed blocks were. Each uses single-column
   `PRIMARY KEY ("id")`, a `companyId TEXT NOT NULL` + FK, named FK constraints, indexes on `companyId`
   and every FK, and the identical four RLS policies (`parts_view`/`create`/`update`/`delete`) shown for
   `changeOrderAffectedItem`. Full SQL:

```sql
-- changeOrderAffectedItem — the parts the user selects first (source revision to change)
CREATE TABLE "changeOrderAffectedItem" (
  "id" TEXT NOT NULL DEFAULT id('coai'),
  "changeOrderId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  -- Per-item revision cutover config (Q3): existence of the oldRev→newRev supersession is automatic
  -- at release; the user only tunes mode + dates. Defaults applied at release when dates are NULL.
  "supersessionMode" "supersessionMode" NOT NULL DEFAULT 'Consume First',
  "discontinuationDate" DATE,
  "successorEffectivityDate" DATE,
  -- Idempotency marker: set to the created revision's itemId at release. Non-null ⇒ already applied.
  "newItemId" TEXT,
  "changeSummary" JSONB,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderAffectedItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderAffectedItem_changeOrderId_itemId_key" UNIQUE ("changeOrderId", "itemId"),
  CONSTRAINT "changeOrderAffectedItem_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_newItemId_fkey" FOREIGN KEY ("newItemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);
CREATE INDEX "changeOrderAffectedItem_changeOrderId_idx" ON "changeOrderAffectedItem" ("changeOrderId");
CREATE INDEX "changeOrderAffectedItem_itemId_idx" ON "changeOrderAffectedItem" ("itemId");
CREATE INDEX "changeOrderAffectedItem_companyId_idx" ON "changeOrderAffectedItem" ("companyId");

ALTER TABLE "changeOrderAffectedItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."changeOrderAffectedItem" FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[]));
CREATE POLICY "INSERT" ON "public"."changeOrderAffectedItem" FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."changeOrderAffectedItem" FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."changeOrderAffectedItem" FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[]));

-- changeOrderStagedMaterial — CO-owned mirror of methodMaterial (full desired end-state)
CREATE TABLE "changeOrderStagedMaterial" (
  "id" TEXT NOT NULL DEFAULT id('cosm'),
  "changeOrderId" TEXT NOT NULL,
  "affectedItemId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL DEFAULT 1,
  "unitOfMeasureCode" TEXT,
  "methodType" "methodType" NOT NULL DEFAULT 'Pull from Inventory',
  "sourcingType" "sourcingType" NOT NULL DEFAULT 'Specified',
  "materialMakeMethodId" TEXT,
  "stagedOperationId" TEXT,           -- link to a changeOrderStagedOperation row (resolved at release)
  "order" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "itemType" TEXT NOT NULL DEFAULT 'Material',
  "sourceMaterialId" TEXT,            -- live methodMaterial.id copied from; NULL ⇒ added line
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderStagedMaterial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderStagedMaterial_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedMaterial_affectedItemId_fkey" FOREIGN KEY ("affectedItemId") REFERENCES "changeOrderAffectedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedMaterial_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedMaterial_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedMaterial_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);
CREATE INDEX "changeOrderStagedMaterial_changeOrderId_idx" ON "changeOrderStagedMaterial" ("changeOrderId");
CREATE INDEX "changeOrderStagedMaterial_affectedItemId_idx" ON "changeOrderStagedMaterial" ("affectedItemId");
CREATE INDEX "changeOrderStagedMaterial_itemId_idx" ON "changeOrderStagedMaterial" ("itemId");
CREATE INDEX "changeOrderStagedMaterial_companyId_idx" ON "changeOrderStagedMaterial" ("companyId");
-- + ENABLE RLS + the four parts_* policies exactly as for changeOrderAffectedItem above.

-- changeOrderStagedOperation — CO-owned mirror of methodOperation
CREATE TABLE "changeOrderStagedOperation" (
  "id" TEXT NOT NULL DEFAULT id('coso'),
  "changeOrderId" TEXT NOT NULL,
  "affectedItemId" TEXT NOT NULL,
  "order" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "operationOrder" "methodOperationOrder" NOT NULL DEFAULT 'After Previous',
  "workCellTypeId" TEXT,
  "equipmentTypeId" TEXT,
  "description" TEXT,
  "setupHours" NUMERIC NOT NULL DEFAULT 0,
  "standardFactor" "factor" NOT NULL DEFAULT 'Hours/Piece',
  "productionStandard" NUMERIC NOT NULL DEFAULT 0,
  "sourceOperationId" TEXT,           -- live methodOperation.id copied from; NULL ⇒ added
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderStagedOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderStagedOperation_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedOperation_affectedItemId_fkey" FOREIGN KEY ("affectedItemId") REFERENCES "changeOrderAffectedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedOperation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedOperation_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);
CREATE INDEX "changeOrderStagedOperation_changeOrderId_idx" ON "changeOrderStagedOperation" ("changeOrderId");
CREATE INDEX "changeOrderStagedOperation_affectedItemId_idx" ON "changeOrderStagedOperation" ("affectedItemId");
CREATE INDEX "changeOrderStagedOperation_companyId_idx" ON "changeOrderStagedOperation" ("companyId");
-- + ENABLE RLS + the four parts_* policies.
-- NOTE: verify the enum type names against the newest methods migration before applying — grep
-- `CREATE TYPE "methodOperationOrder"` and `CREATE TYPE "factor"` in packages/database/supabase/migrations/.
-- If either enum name differs, use the real name. If they are NOT NULL without a sensible default on the
-- live table, STOP and report — do not invent a default that the live methodOperation lacks.

-- changeOrderStagedItemAttributes — CO-owned staged copy of an affected item's editable attributes
CREATE TABLE "changeOrderStagedItemAttributes" (
  "id" TEXT NOT NULL DEFAULT id('coia'),
  "changeOrderId" TEXT NOT NULL,
  "affectedItemId" TEXT NOT NULL,
  -- Mirrored editable item columns (finalize exact set in Task 10 against PartProperties):
  "name" TEXT,
  "description" TEXT,
  "unitOfMeasureCode" TEXT,
  "itemTrackingType" TEXT,
  "defaultMethodType" "methodType",
  "replenishmentSystem" TEXT,
  "sourcingType" "sourcingType",
  "requiresInspection" BOOLEAN,
  -- Drawing references (reference-level only; files copied at release):
  "thumbnailPath" TEXT,
  "attributes" JSONB,                 -- overflow bag for extension fields + modelUpload refs
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderStagedItemAttributes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderStagedItemAttributes_affectedItemId_key" UNIQUE ("affectedItemId"),
  CONSTRAINT "changeOrderStagedItemAttributes_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedItemAttributes_affectedItemId_fkey" FOREIGN KEY ("affectedItemId") REFERENCES "changeOrderAffectedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedItemAttributes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedItemAttributes_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderStagedItemAttributes_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);
CREATE INDEX "changeOrderStagedItemAttributes_changeOrderId_idx" ON "changeOrderStagedItemAttributes" ("changeOrderId");
CREATE INDEX "changeOrderStagedItemAttributes_affectedItemId_idx" ON "changeOrderStagedItemAttributes" ("affectedItemId");
CREATE INDEX "changeOrderStagedItemAttributes_companyId_idx" ON "changeOrderStagedItemAttributes" ("companyId");
-- + ENABLE RLS + the four parts_* policies.

-- changeOrderSupersession — MANUAL different-part obsolescence declarations only (NOT revision cutover)
CREATE TABLE "changeOrderSupersession" (
  "id" TEXT NOT NULL DEFAULT id('cosup'),
  "changeOrderId" TEXT NOT NULL,
  "predecessorItemId" TEXT NOT NULL,
  "successorItemId" TEXT,
  "supersessionMode" "supersessionMode" NOT NULL DEFAULT 'Consume First',
  "discontinuationDate" DATE,
  "successorEffectivityDate" DATE,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderSupersession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderSupersession_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_predecessorItemId_fkey" FOREIGN KEY ("predecessorItemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_successorItemId_fkey" FOREIGN KEY ("successorItemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);
CREATE INDEX "changeOrderSupersession_changeOrderId_idx" ON "changeOrderSupersession" ("changeOrderId");
CREATE INDEX "changeOrderSupersession_predecessorItemId_idx" ON "changeOrderSupersession" ("predecessorItemId");
CREATE INDEX "changeOrderSupersession_companyId_idx" ON "changeOrderSupersession" ("companyId");
-- + ENABLE RLS + the four parts_* policies.
```
4. **Add** the `item.changeOrderId` back-link column at the bottom of the migration (near the
   `item.revisionStatus` ALTER ~464):
```sql
ALTER TABLE "item" ADD COLUMN "changeOrderId" TEXT;
ALTER TABLE "item" ADD CONSTRAINT "item_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "item_changeOrderId_idx" ON "item" ("changeOrderId");
```
5. Before finalizing, grep the newest methods migration for the real enum names used by `methodOperation`
   (`methodOperationOrder`, `factor`) and by `methodMaterial` (`methodType`, `sourcingType`) and confirm
   the column set matches. If any referenced type/column name differs from the live schema, STOP and report.

**Verify:**
```bash
# The user applies the migration (reset/re-apply local DB). After they confirm it applied:
grep -c "changeOrderAffectedItem\|changeOrderStagedMaterial\|changeOrderStagedOperation\|changeOrderStagedItemAttributes\|changeOrderSupersession" packages/database/supabase/migrations/20260708120000_change-orders.sql
# Expected: a count ≥ 5 (each new table referenced), and NO remaining "changeOrderBomChange" matches:
grep -c "changeOrderBomChange" packages/database/supabase/migrations/20260708120000_change-orders.sql
# Expected: 0
```

**Out of scope:** any change to `changeOrder`, `changeOrderType`, `changeOrderActionTask`, the sequence
seed, or the `plmReleaseControl`/`revisionStatus` columns — keep them exactly as-is.

---

## Task 2: Regenerate DB types

**Depends on:** Task 1 (migration applied by the user)
**Files:** Modify (generated): `packages/database/src/types.ts` — do not hand-edit; regenerate.

**Steps:**
1. Confirm with the user that they have reset/applied the local DB. If not, STOP and wait — never rebuild
   the DB yourself.
2. Run the type generation.

**Verify:**
```bash
pnpm run generate:types
grep -c "changeOrderAffectedItem\|changeOrderStagedMaterial\|changeOrderStagedOperation\|changeOrderStagedItemAttributes\|changeOrderSupersession" packages/database/src/types.ts
# Expected: > 0 for each new table (they now appear in the generated types)
```

**Out of scope:** editing types by hand.

---

## Task 3: Models — replace BOM-change validators with the top-to-bottom validators + diff types

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/items/changeOrder.models.ts`
- Copy from (precedent): the existing validators in the same file (`changeOrderValidator`,
  `changeOrderStatusValidator`), and `methodMaterialValidator` / `methodOperationValidator` in
  `apps/erp/app/modules/items/items.models.ts` for field shapes.

**Steps:**
1. **Keep** the stage machine (`changeOrderStatus`, `changeOrderStatusTransitions`,
   `isAllowedChangeOrderTransition`, `isChangeOrderLocked`, `changeOrderOpenStatuses`,
   `changeOrderBroadcastStages`), the header/status/type/action validators.
2. **Remove** `changeOrderBomChangeValidator`, `changeOrderBomChangeAssemblyValidator`, and
   `isItemFullyObsoleted` (the old full-obsolescence predicate — no longer used; revision+supersession
   replaces it).
3. **Add** validators (zod + `zfd` from `zod-form-data`; import `supersessionModes` enum from where the
   existing assembly validator got it — grep `supersessionMode` in items models):
   - `changeOrderAffectedItemValidator = z.object({ id: z.string().optional(), changeOrderId: z.string().min(1), itemId: z.string().min(1) })`
   - `changeOrderAffectedItemCutoverValidator = z.object({ id: z.string().min(1), supersessionMode: z.enum(supersessionModes), discontinuationDate: zfd.text(z.string().optional()), successorEffectivityDate: zfd.text(z.string().optional()) })`
   - `changeOrderStagedMaterialValidator` — mirror `methodMaterialValidator` fields (`itemId`, `quantity`,
     `unitOfMeasureCode`, `methodType`, `sourcingType`, `materialMakeMethodId?`, `order?`, `itemType?`) +
     `id?`, `affectedItemId`, `stagedOperationId?`, `sourceMaterialId?`, and forward-ref fields
     (`newItemReadableId?`, `newItemName?`) for minting (G3).
   - `changeOrderStagedOperationValidator` — mirror `methodOperationValidator` (`order`, `operationOrder`,
     `workCellTypeId?`, `equipmentTypeId?`, `description?`, `setupHours`, `standardFactor`,
     `productionStandard`) + `id?`, `affectedItemId`, `sourceOperationId?`.
   - `changeOrderStagedItemAttributesValidator` — the editable item fields (finalized in Task 10) as all-optional.
   - `changeOrderSupersessionValidator = z.object({ id: z.string().optional(), changeOrderId: z.string().min(1), predecessorItemId: z.string().min(1), successorItemId: z.string().optional(), supersessionMode: z.enum(supersessionModes), discontinuationDate: zfd.text(z.string().optional()), successorEffectivityDate: zfd.text(z.string().optional()) })`
4. **Add** the diff result type (used by Task 12): `export type MethodDiffEntry<T> = { status: "added" | "removed" | "modified" | "unchanged"; before: T | null; after: T | null }` and
   `export type ChangeOrderItemDiff = { affectedItemId: string; itemId: string; materials: MethodDiffEntry<...>[]; operations: MethodDiffEntry<...>[]; attributes: MethodDiffEntry<...>[] }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors referencing changeOrderBomChangeValidator / isItemFullyObsoleted (removed).
# If typecheck reports those still imported somewhere, that's Task 4/19 cleanup — note it, continue.
```

**Out of scope:** deleting the service functions (Task 4). Only models here.

---

## Task 4: Service shell — remove BOM-change fns; keep header/status/types/mint/rollup

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/items/changeOrder.service.ts`
- Modify: `apps/erp/app/modules/items/index.ts` (barrel — drop removed exports)

**Steps:**
1. **Remove** the bottom-to-top BOM-change functions: `getChangeOrderBomChanges`, `upsertBomChange`,
   `deleteChangeOrderBomChange`, `upsertChangeOrderBomChangeAssembly`, `deleteChangeOrderBomChangeAssembly`,
   `getChangeOrderProductsAffected`, `syncChangeOrderProductsAffected`, `getAssembliesUsingItem`.
   (Grep the file for each name; remove the function + its barrel export.)
2. **Keep**: `getChangeOrder(s)`, `insertChangeOrder`, `updateChangeOrder`, `updateChangeOrderStatus`,
   `deleteChangeOrder`, all `*ChangeOrderType*`, `mintPlaceholderPart`, `getTopLevelProductsForItems`
   (still used for the computed Products-Affected rollup), `getChangeOrderImpact` (re-fed in Task 13),
   `getChangeOrderNotificationRecipients`.
3. Leave `applyChangeOrder` in `changeOrder.server.ts` for now (rewritten in Task 14) but comment out /
   stub its body's references to removed functions if it fails to compile — mark with
   `// TODO(Task 14): rewrite for revision model`. If stubbing is non-trivial, STOP and do Task 14 next.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: green EXCEPT known references from routes/UI that Tasks 6/7/19 remove. List remaining errors;
# every one must be in a change-order route/UI file scheduled for later removal — if any is elsewhere, STOP.
```

**Out of scope:** adding the new staging functions (Task 5).

---

## Task 5: Affected-items + staged-material service (snapshot-on-add, staging CRUD)

**Depends on:** Task 3, Task 4
**Files:**
- Create: `apps/erp/app/modules/items/changeOrder.staging.ts` (new concern file, keeps others < 1000 lines, G4)
- Modify: `apps/erp/app/modules/items/index.ts` (export the new fns)
- Copy from (precedent): `upsertMethodMaterial` + `getMethodMaterialsByMakeMethod` in
  `apps/erp/app/modules/items/items.service.ts` (~3439/~1321) for material shape + methodType/sourcing
  derivation; `activeMakeMethods` view usage; `mintPlaceholderPart` in `changeOrder.service.ts` for minting.

**Steps:**
1. `getChangeOrderAffectedItems(client, changeOrderId, companyId)` — flat select of
   `changeOrderAffectedItem` joined to an item-label read (id, readableIdWithRevision, name, type, active,
   revisionStatus, replenishmentSystem). Flat query + JS stitch (no composite-FK embeds — lessons.md).
2. `addChangeOrderAffectedItem(client, { changeOrderId, itemId, companyId, userId })` — insert the row,
   then **snapshot-on-add**: read the item's current Active make method (via `activeMakeMethods` +
   `methodMaterial`/`methodOperation`) and insert `changeOrderStagedMaterial` (sourceMaterialId=live id),
   `changeOrderStagedOperation` (sourceOperationId=live id), and one `changeOrderStagedItemAttributes` row
   copying the editable item columns. If the item has no Active method (Buy), insert only the attributes
   row. Guard: reuse `findOtherOpenChangeOrdersForItem` (one open CO per part) — return `{ error }` if
   another open CO references this item's readableId.
3. `removeChangeOrderAffectedItem(client, id)` — delete the affected-item row (staging cascades via FK).
4. `updateChangeOrderAffectedItemCutover(client, { id, supersessionMode, discontinuationDate, successorEffectivityDate, userId })`.
5. Staged-material CRUD: `getChangeOrderStagedMaterials(client, affectedItemId, companyId)`,
   `upsertChangeOrderStagedMaterial(client, input)` (re-derive methodType/sourcingType from the component
   item exactly like `upsertMethodMaterial`; mint via `mintPlaceholderPart` when `newItemReadableId` given),
   `deleteChangeOrderStagedMaterial(client, id)`,
   `reorderChangeOrderStagedMaterials(db: Kysely<KyselyDatabase>, updates)`.
6. Every query scopes by `companyId` (lessons.md multi-tenancy).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: changeOrder.staging.ts compiles; new fns exported from ~/modules/items.
pnpm --filter erp test
# Expected: existing tests still pass (no test added yet; see Task 20 for browser verify).
```

**Out of scope:** operation-child staging (Task 16), routes/UI (Tasks 6/7).

---

## Task 6: Affected-items + staged-material routes

**Depends on:** Task 5
**Files:**
- Create: `apps/erp/app/routes/x+/items+/change-order+/$id.affected.tsx` (POST add affected item)
- Create: `apps/erp/app/routes/x+/items+/change-order+/$id.affected.delete.$affectedId.tsx`
- Create: `apps/erp/app/routes/x+/items+/change-order+/$id.affected.$affectedId.cutover.tsx`
- Create: `apps/erp/app/routes/x+/items+/change-order+/$id.affected.$affectedId.material.tsx` (upsert)
- Create: `apps/erp/app/routes/x+/items+/change-order+/$id.affected.$affectedId.material.delete.$materialId.tsx`
- Create: `apps/erp/app/routes/x+/items+/change-order+/$id.affected.$affectedId.material.order.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add path helpers (`changeOrderAffected`, `changeOrderAffectedDelete`,
  `changeOrderAffectedCutover`, `changeOrderStagedMaterial`, etc.), mirroring the existing
  `changeOrderBomChange*` helpers being removed.
- Copy from (precedent): the existing `x+/items+/change-order+/$id.bom-change.tsx` and
  `$id.bom-change.$rowId.assembly.tsx` for the action shape (validate → service → `{ success }` / flash).

**Steps:**
1. Each action: `await requirePermissions(request, { update: "parts" })` (delete routes use `delete`),
   `validator(...).validate(await request.formData())`, call the Task-5 service, return `{ success, id }`
   or `data({}, await flash(request, error(...)))`. Reorder route uses `getDatabaseClient()` + the Kysely
   reorder fn (precedent: `$id.action.order.tsx`).
2. Delete the old `$id.bom-change*` route files (moved to Task 19 if you prefer, but their path helpers
   must be removed here to keep `path.ts` compiling).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: green; path.ts has no dangling changeOrderBomChange* helpers.
pnpm run lint
# Expected: no errors in the new route files.
```

**Out of scope:** UI wiring (Task 7).

---

## Task 7: AffectedItems UI + CO-scoped BOM editor

**Depends on:** Task 6
**Files:**
- Create: `apps/erp/app/modules/items/ui/ChangeOrder/AffectedItems.tsx`
- Create: `apps/erp/app/modules/items/ui/ChangeOrder/AffectedItemCard.tsx` (expandable per-item container)
- Create: `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderBomEditor.tsx`
- Modify: `apps/erp/app/routes/x+/items+/change-order+/$id.tsx` (loader adds affected-items + staging reads)
- Modify: `apps/erp/app/routes/x+/items+/change-order+/$id.details.tsx` (render `AffectedItems` first)
- Delete: `apps/erp/app/modules/items/ui/ChangeOrder/{BomChanges,BomChangeDeleteRow,BomChangeAddRow,BomChangeAssemblyTable,ProductsAffected}.tsx` (bottom-to-top UI)
- Copy from (precedent): `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx` (BOM editor — the design
  doc's Q allows parameterizing it or forking; **fork** `ChangeOrderBomEditor.tsx` from it and point its
  fetchers at the Task-6 staged-material routes); `Item` picker + `MethodMaterialsTable.tsx` for row
  presentation; the affected-item picker follows the `eco-affected-item-scope` rule (Part + Tool only).

**Steps:**
1. `AffectedItems.tsx` — a first-class card at the TOP of the detail: a Part/Tool picker to add affected
   items (POST to `$id.affected`), and a list of `AffectedItemCard` for each.
2. `AffectedItemCard.tsx` — shows the item label + a remove button + the per-item cutover control
   (supersessionMode select + dates, POST to `$id.affected.$affectedId.cutover`) + an expander revealing
   the `ChangeOrderBomEditor` (and, after Tasks 9/10, the BOP + attributes editors).
3. `ChangeOrderBomEditor.tsx` — the staged BOM list for one affected item, forked from `BillOfMaterial.tsx`;
   add/edit/delete/reorder rows via the Task-6 routes; each row shows an **Added / Modified / Removed** badge
   derived from the Task-12 diff (until Task 12 lands, show no badge — do not block).
4. `$id.tsx` loader: replace the removed `getChangeOrderBomChanges`/`getChangeOrderProductsAffected` reads
   with `getChangeOrderAffectedItems` + per-item `getChangeOrderStagedMaterials`. Keep `getChangeOrderImpact`.
5. `$id.details.tsx`: render `<AffectedItems />` where `<BomChanges />` / `<ProductsAffected />` were.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: green; no imports of the deleted BomChanges*/ProductsAffected components remain.
```
Then browser-verify in Task 20 (full flow). Do not mark done on typecheck alone for this UI task.

**Out of scope:** BOP editor (Task 9), attributes editor (Task 10), diff badges (Task 12).

---

## Task 8: Staged-operation service + routes

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/modules/items/changeOrder.staging.ts` — add operation CRUD
- Create: `apps/erp/app/routes/x+/items+/change-order+/$id.affected.$affectedId.operation.tsx`,
  `$id.affected.$affectedId.operation.delete.$operationId.tsx`, `$id.affected.$affectedId.operation.order.tsx`
- Modify: `apps/erp/app/utils/path.ts` — operation path helpers
- Copy from (precedent): `upsertMethodOperation`/`deleteMethodOperation` (`items.service.ts` ~3969/~345),
  and the material routes from Task 6 for the action shape.

**Steps:**
1. `getChangeOrderStagedOperations(client, affectedItemId, companyId)`,
   `upsertChangeOrderStagedOperation(client, input)`, `deleteChangeOrderStagedOperation(client, id)`,
   `reorderChangeOrderStagedOperations(db, updates)`.
2. Routes mirror Task 6 (`update`/`delete` permissions on `parts`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: green.
```

**Out of scope:** operation children (Task 16), UI (Task 9).

---

## Task 9: CO-scoped BOP editor UI

**Depends on:** Task 8
**Files:**
- Create: `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderBopEditor.tsx`
- Modify: `apps/erp/app/modules/items/ui/ChangeOrder/AffectedItemCard.tsx` (mount the BOP editor in the expander)
- Modify: `apps/erp/app/routes/x+/items+/change-order+/$id.tsx` (loader adds staged operations per affected item)
- Copy from (precedent): `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx` (fork it) +
  `MethodOperationsTable.tsx`.

**Steps:**
1. Fork `BillOfProcess.tsx` into `ChangeOrderBopEditor.tsx` (operation headers only: work cell, equipment,
   sequence/`operationOrder`, setup hours, standard factor, production standard, description). Fetchers →
   Task-8 routes. Operation children (steps/params/tools) render **read-only from the snapshot** with a
   clearly-labeled "edited in a later phase" note (Task 16 makes them editable).
2. Added/Modified/Removed badges from the Task-12 diff (no badge until Task 12).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: green.
```

**Out of scope:** operation children editing (Task 16).

---

## Task 10: Staged item-attributes service + routes + spec-diff UI

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/modules/items/changeOrder.staging.ts` — attributes get/upsert
- Create: `apps/erp/app/routes/x+/items+/change-order+/$id.affected.$affectedId.attributes.tsx`
- Create: `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderAttributesEditor.tsx`
- Modify: `AffectedItemCard.tsx`, `$id.tsx` loader, `apps/erp/app/utils/path.ts`
- Copy from (precedent): `apps/erp/app/modules/items/ui/Parts/PartProperties.tsx` for the exact editable
  field set + controls; `method-material-sourcing.md` for which fields are read-only mirrors.

**Steps:**
1. **Finalize the field set** by reading `PartProperties.tsx`: stage the fields a user can edit there
   (`name`, `description`, `unitOfMeasureCode`, `itemTrackingType`, `defaultMethodType`,
   `replenishmentSystem`, `sourcingType`, `requiresInspection`, plus the extension-table fields shown:
   `itemReplenishment`/`itemCost`/`itemUnitSalePrice`). If a field is not editable in `PartProperties`,
   do NOT stage it. Update `changeOrderStagedItemAttributesValidator` (Task 3) + the migration column set
   (Task 1) if the finalized set differs — if the migration already applied, add the columns via a follow-up
   ALTER in the same migration file and ask the user to re-apply.
2. Service: `getChangeOrderStagedItemAttributes(client, affectedItemId, companyId)`,
   `upsertChangeOrderStagedItemAttributes(client, input)`.
3. UI: `ChangeOrderAttributesEditor.tsx` — a panel modeled on `PartProperties`, showing each field with a
   column-level **spec diff** (old value → staged value). For a Buy part with no method, this panel is the
   whole editor. Drawing reference: show the current thumbnail/`modelUpload` name and allow attach/swap;
   **no CAD content diff** — show which file changed + side-by-side thumbnails only.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: green.
```

**Out of scope:** copying drawing FILES at release (Task 14 step 3).

---

## Task 11: Supersession — per-item cutover config + manual different-part table

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/items/changeOrder.staging.ts` (or a small `changeOrder.service.ts` addition) —
  manual supersession CRUD
- Create: `apps/erp/app/routes/x+/items+/change-order+/$id.supersession.tsx`,
  `$id.supersession.delete.$supersessionId.tsx`
- Create: `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderSupersession.tsx`
- Modify: `$id.tsx` loader, `$id.details.tsx`, `apps/erp/app/utils/path.ts`
- Copy from (precedent): the item picker + a simple list-add card (e.g. `ChangeOrderActions.tsx` layout).

**Steps:**
1. Service: `getChangeOrderSupersessions(client, changeOrderId, companyId)`,
   `upsertChangeOrderSupersession(client, input)`, `deleteChangeOrderSupersession(client, id)`.
2. UI: `ChangeOrderSupersession.tsx` — declare `predecessor → successor` (both `Item` pickers), mode +
   dates. This is ONLY for genuinely-different-part obsolescence; add a one-line helper text distinguishing
   it from the per-affected-item revision cutover (which lives on `AffectedItemCard`, Task 7).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: green.
```

**Out of scope:** writing `itemSupersession` at release (Task 14).

---

## Task 12: `diffMethod` engine + `getChangeOrderDiff` + ChangeOrderReview UI

**Depends on:** Tasks 5, 8, 10
**Files:**
- Create: `apps/erp/app/modules/items/changeOrder.diff.ts` (pure `diffMethod` + `getChangeOrderDiff` read)
- Create: `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderReview.tsx`
- Modify: `AffectedItemCard`/`ChangeOrderBomEditor`/`ChangeOrderBopEditor` — consume the diff for row badges
- Modify: `$id.tsx` loader (add `getChangeOrderDiff`), `$id.details.tsx` (render review panel from Implementation)
- Copy from (precedent): flat-select + JS-stitch style of `findChangeOrdersForItem` (`changeOrder.reads.ts`).

**Steps:**
1. `diffMethod(base, target)` — pure function comparing two method snapshots (materials + operations,
   matched by `sourceMaterialId`/`sourceOperationId`) → `MethodDiffEntry[]` (added/removed/modified/unchanged),
   plus an attributes column-diff. NO DB access in the pure fn (unit-testable).
2. `getChangeOrderDiff(client, changeOrderId, companyId)` — for each affected item, fetch the **current
   source method live** (`activeMakeMethods` + methodMaterial/methodOperation) and the staged rows, run
   `diffMethod`. Return `ChangeOrderItemDiff[]` + the supersession declarations.
3. `ChangeOrderReview.tsx` — the "tips" panel shown from `Implementation` onward: every staged change per
   affected item, grouped, human-readable.
4. Add a unit test `apps/erp/app/modules/items/changeOrder.diff.test.ts` covering added/removed/modified for
   materials and operations (pure `diffMethod`), since this is verifiable logic.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm --filter erp test changeOrder.diff
# Expected: the new diff tests pass (added/removed/modified classified correctly).
```

**Out of scope:** the post-release oldRev↔newRev diff surface on the part page (Task 17, reuses `diffMethod`).

---

## Task 13: Impact panel re-fed from removed staged materials

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/items/changeOrder.service.ts` — re-point `getChangeOrderImpact`
- Modify: `apps/erp/app/modules/items/ui/ChangeOrder/ImpactPanel.tsx` (keep; input shape may change)
- Copy from (precedent): the existing `getChangeOrderImpact` PO-lines query in `changeOrder.service.ts`.

**Steps:**
1. Re-point `getChangeOrderImpact` to derive "removed parts" from the diff (a staged material that is
   *Removed* vs the source) instead of the old Delete-row model, then run the same open-PO-lines query for
   those item ids. Read-only, non-blocking; jobs/SOs stay hidden.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: green; ImpactPanel still renders (empty if no removed parts).
```

**Out of scope:** blocking on impact.

---

## Task 14: Release orchestration — rewrite `applyChangeOrder` (revision + supersession)

**Depends on:** Tasks 5, 8, 10, 11, 12
**Files:**
- Modify: `apps/erp/app/modules/items/changeOrder.server.ts` — rewrite `applyChangeOrder`
- Copy from (precedent): the OLD `applyChangeOrder` in the same file (for CAS + edge-fn-call structure,
  G1/G2) and `createRevision` (`items.service.ts` ~139), `activateMethodVersion` (~71),
  `upsertMethodMaterial`/`deleteMethodMaterial`, `upsertMethodOperation`/`deleteMethodOperation`,
  `assertMethodOperationIsDraft`, `upsertItemSupersession`.

**Steps:** implement `applyChangeOrder(client, db, { changeOrderId, userId, companyId })` — for each
`changeOrderAffectedItem` where `newItemId IS NULL` (idempotent skip):
1. `createRevision(client, { item, revision: <next letter>, active: false, createdBy: userId })` → new item
   row + Draft method (copies source method for non-Buy). Compute `<next letter>` from the source's sibling
   revisions (grep how `revisions.new.tsx` derives the next revision; reuse that logic — if none exists,
   STOP and report, do not invent a scheme).
2. **Materialize** the staged end-state onto the new revision's Draft method (Q5 — not delta-replay):
   operations first (`deleteMethodOperation` for Draft ops absent from staging, `upsertMethodOperation` for
   every staged op; keep a stagedOpId→newOpId map), then materials (delete Draft materials absent from
   staging, `upsertMethodMaterial` for every staged material, resolving `stagedOperationId` via the map).
   **Do NOT** stamp per-line `effectiveFrom` (cutover is at the revision level via supersession).
3. Apply staged attributes onto the new revision's `item` (+ extension) columns; copy source `modelUpload`
   rows + storage files to the new revision (file copy via the service-role storage client) and apply staged
   drawing changes. If storage copy is non-trivial, implement the DB-row copy + STOP-and-report on the file
   bytes rather than silently skipping (lessons.md — no fabricated success).
4. `activateMethodVersion(client, { id: newRevisionDraftMethodId, companyId, userId })` (Make items).
5. Set the new revision `item.active = true` and `item.changeOrderId = changeOrderId`.
6. `upsertItemSupersession` for `(sourceItemId → newItemId)` using the affected item's cutover config
   (default mode `Consume First`, dates default to the CO `effectiveDate`). Then `upsertItemSupersession`
   for each `changeOrderSupersession` manual row.
7. Persist `changeOrderAffectedItem.newItemId = <created revision id>` (idempotency marker).
8. Final CAS: in a small Kysely txn, `UPDATE changeOrder SET status='Done', updatedBy=userId WHERE id=…
   AND companyId=… AND status='Implementation'` (mirror the old CAS). Return `{ data: { id }, error }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: green. Behavior verified end-to-end in Task 20 (a version-bump→revision swap is not unit-testable
# without the edge-fn stack). Add a comment block documenting the G2 atomicity tradeoff at the top of the fn.
```

**Out of scope:** operation children at release (Task 16 extends step 2).

---

## Task 15: Status route wiring for release + `getChangeOrderValidations`

**Depends on:** Task 14
**Files:**
- Modify: `apps/erp/app/routes/x+/items+/change-order+/$id.status.tsx`
- Modify: `apps/erp/app/modules/items/changeOrder.server.ts` — `getChangeOrderValidations`
- Copy from (precedent): the existing `$id.status.tsx` (it already calls `applyChangeOrder` on → Done and
  broadcasts on `changeOrderBroadcastStages`).

**Steps:**
1. Confirm the → Done branch calls the rewritten `applyChangeOrder(getCarbonServiceRole()/client, getDatabaseClient(), …)`.
2. Rewrite `getChangeOrderValidations`: drop disposition/old-BOM checks; add: every Add-type staged material
   must resolve to a real item (forward-ref reconciled); surface a **non-blocking heads-up** (not a block) if
   any affected item's source method changed since snapshot (compare staged `sourceMaterialId`/`sourceOperationId`
   against the current live rows). Return warnings separately from blocking errors.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: green.
```

**Out of scope:** approval gating (not in scope — no approvals in this feature).

---

## Task 16: BOP operation-children staging + release reconciliation

**Depends on:** Task 14
**Files:**
- Modify: `packages/database/supabase/migrations/20260708120000_change-orders.sql` — add
  `changeOrderStagedOperationStep`, `…Parameter`, `…Tool` (mirror `methodOperationAttribute` /
  `methodOperationParameter` / `methodOperationTool` + `sourceId` + `stagedOperationId`; same RLS block).
  User re-applies DB; then `pnpm run generate:types`.
- Modify: `changeOrder.staging.ts` (children CRUD), `changeOrder.diff.ts` (include children),
  `ChangeOrderBopEditor.tsx` (make children editable), `changeOrder.server.ts` (`applyChangeOrder` step 2
  reconciles children on the new revision's operations via the stagedOpId→newOpId map), routes + path helpers.
- Copy from (precedent): operation-child upserts in `items.service.ts` (~4004–4094).

**Steps:**
1. Add tables + types (re-run Task 2's generate:types after the user re-applies).
2. Extend staging CRUD + diff + editor + release reconciliation for steps/params/tools.

**Verify:**
```bash
pnpm run generate:types && pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: green; ChangeOrderBopEditor children no longer read-only.
```

**Out of scope:** none — this closes the Phase-3 read-only limitation.

---

## Task 17: Traceability re-point + revision history + diff UI on part page

**Depends on:** Task 14
**Files:**
- Modify: `apps/erp/app/modules/items/changeOrder.reads.ts` — re-point `findChangeOrdersForItem`
- Modify: the part/tool detail UI to render CO history + a revision comparison + "Created by CO-…" chip
- Copy from (precedent): existing `findChangeOrdersForItem` (flat-query union) + `ItemChangeOrders.tsx` /
  `ItemOpenChangeOrderAlert.tsx`; reuse `diffMethod` (Task 12) for the oldRev↔newRev redline.

**Steps:**
1. Re-point `findChangeOrdersForItem` relations to the new tables: `changeOrderAffectedItem.itemId`,
   `changeOrderStagedMaterial.itemId`, `changeOrderSupersession.predecessorItemId/successorItemId`, and
   `item.changeOrderId` (released revisions), scoped by `readableId`. Keep it the single canonical query (G6).
2. On the part/tool detail page: add a "Change Orders" history section + a revision-comparison view
   (oldRev vs newRev via `diffMethod`) + a "Created by CO-000123" chip from `item.changeOrderId`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: green; a released revision shows its originating CO chip.
```

**Out of scope:** none.

---

## Task 18: Audit config — re-register the new CO children

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/audit.config.ts` (the `changeOrder` entity ~303–312)
- Copy from (precedent): the existing `changeOrder` entity block in that file.

**Steps:**
1. Replace the dropped children (`changeOrderProductAffected`, `changeOrderBomChange`,
   `changeOrderBomChangeAssembly`) with the new ones: `changeOrderAffectedItem`, `changeOrderStagedMaterial`,
   `changeOrderStagedOperation`, `changeOrderStagedItemAttributes`, `changeOrderSupersession`
   (+ `changeOrderActionTask`, kept). Do **NOT** add `makeMethod`/`methodMaterial`/`methodOperation`/
   `itemSupersession` (Q4 — revision-centric audit, method tables intentionally not event-audited).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: green; audit.config references only tables that exist in the migration.
```

**Out of scope:** auditing method/supersession tables.

---

## Task 19: Cleanup dead bottom-to-top code + AGENTS.md refresh

**Depends on:** Tasks 7, 15
**Files:**
- Delete: any remaining `x+/items+/change-order+/$id.bom-change*` route files and their path helpers.
- Modify: `apps/erp/app/modules/items/index.ts` (barrel), `apps/erp/app/modules/items/AGENTS.md`
  (rewrite the "Change Orders (sub-area)" section to the top-to-bottom model — affected-items-first,
  revision release, supersession propagation, staged tables), `.ai/rules/` if a CO rule exists.
- Modify: `apps/erp/app/modules/items/ui/ChangeOrder/index.ts` (drop deleted component exports).

**Steps:**
1. Grep the repo for the removed identifiers and delete every dangling reference:
   `changeOrderBomChange`, `BomChangeAssembly`, `getChangeOrderProductsAffected`,
   `syncChangeOrderProductsAffected`, `getAssembliesUsingItem`, `isItemFullyObsoleted`, `ProductsAffected`.
2. Update `modules/items/AGENTS.md` CO section + CO data-model table to the new tables (keep-sources-in-sync rule).

**Verify:**
```bash
grep -rn "changeOrderBomChange\|getChangeOrderProductsAffected\|isItemFullyObsoleted" apps/erp/app packages | grep -v ".test." | wc -l
# Expected: 0
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: green.
```

**Out of scope:** none.

---

## Task 20: Browser verification via /test

**Depends on:** Tasks 15, 16, 17, 19
**Files:** none (verification only). Requires a running dev stack (`crbn up`) and `/auth`.

**Steps:** Use the `/test` skill to drive the running app:
1. Create a CO (`CO-000xxx`), advance Draft→Start.
2. Add an affected assembly → its current BOM + BOP appear staged; confirm the part's own methods UI shows
   **nothing** (isolation check).
3. Edit the staged BOM (swap a child part), add a staged operation, edit a Buy part's attributes → the
   review panel shows the correct diff.
4. Set a per-item cutover mode; declare a manual different-part supersession.
5. Advance to Implementation (impact panel shows open POs for removed parts) → Done.
6. Confirm: the affected item now has a **new revision** whose Active method equals the staged end-state; the
   prior revision + its stock are intact; `item.changeOrderId` set (chip on the part page); an
   `itemSupersession(oldRev→newRev)` exists; an MRP run / new job for a parent uses the new revision.

**Verify:** `/test` playbook passes end-to-end; capture screenshots of the review diff and the released
revision. If any step fails, STOP and open a fix task — do not mark the plan complete.

---

## Acceptance-criteria coverage (design doc → tasks)

- Q1 revision release → Task 14. Q2 supersession propagation → Task 14 step 6 + Task 20 step 6.
- Q3 auto-existence + explicit mode/dates → Tasks 1 (columns), 5/7 (cutover UI), 14 (auto-write).
- Q4 revision-centric audit → Tasks 17 (revision history/diff/chip) + 18 (re-register, skip method tables).
- Q5 git-style end-state → Tasks 5 (snapshot), 12 (diff), 14 step 2 (materialize).
- Q6 attributes/drawings → Tasks 1/3/10 + 14 step 3. Q7 `CO-` prefix → unchanged (existing sequence, Task 1 leaves it).
- Isolation → Task 7 (staging only) + Task 20 step 2. BOP editing → Tasks 8/9 + 16.
