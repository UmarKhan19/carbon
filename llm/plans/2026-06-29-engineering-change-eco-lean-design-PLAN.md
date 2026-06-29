# Engineering Change (ECO) — Lean Item-Native — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax.

**Goal:** Fold the change-order entity into the Items module as a lean, item-native engineering-change (ECO) flow with selectable peer-review approval, an enforced release lock, a manual controlled drawing, and the Duro layer (categories/CPN/attributes/components-import/plmActivity) deleted.

**Architecture:** The `changeOrder` entity (table, RLS, sequence, custom fields) is unchanged in the DB; only its frontend code moves from `modules/plm/` → `modules/items/` and its nav surfaces under Items. The two uncommitted PLM migrations are revised in place (Duro surface dropped; `item.productManager` + `group.isApprovalGroup` added; `plmReleaseControl` default flipped to `enforce`). Approval becomes behavioral: a selectable `approvalType` (Unanimous/Majority/First-In) drives a server-side threshold evaluator that auto-advances `In Review → Approved`; reviewers are seeded per-resolved-user from a groups+people approver picker; reason modals gate Approve/Reject; a server-side transition guard enforces the status DAG; release marks the new make method `Active` and the prior `Archived`. The controlled 2D drawing reuses the existing `externalIntegrationMapping` (`integration="onshape"`) metadata slot, so part-detail and PO-line surfaces light up with no loader changes. Notifications fire on the real transition commit points (review-requested, approved, rejected, released) to reviewers + product manager. The OnShape integration is PARKED and kept typecheck-green.

**Tech Stack:** React Router 7, Supabase (Postgres+RLS+edge fns), Kysely, zod/zfd, @carbon/react.

## Global Constraints
- The USER applies all DB migrations; never hand-edit `types.ts` (regenerate via `db:types` — append `?sslmode=disable` to the local db-url per project memory). Tasks that consume new columns are **gated** on the migration applying + types regenerating.
- Reuse existing components/patterns; no custom `bg-*`/`text-*` classes. Grep `packages/react/src/` and `apps/erp/app/components/` before writing UI.
- Verification is `pnpm --filter erp typecheck` (+ `pnpm --filter @carbon/ee typecheck` if `@carbon/ee`/OnShape is touched; + `pnpm --filter @carbon/jobs typecheck` / `@carbon/notifications` typecheck when those packages are touched) per task; vitest only for pure functions; end-to-end `/test` for acceptance (needs the user dev stack).
- The OnShape integration is PARKED — keep it typecheck-green; do not delete it. The `plm/` directory survives solely for the parked OnShape files (`onshape-*.server.ts`, `onshape-import.service.ts`).
- **URL/route decision (resolved):** keep the `x+/change-order+` URL prefix (preserves `path.to.changeOrder` + OnShape's `navigate`); only NAV placement moves under Items. The three list routes (`change-orders`/`change-order-types`/`change-order-workflows`), currently under `x+/plm+`, re-path under `x+/items+/change-order+/` (their `plm+/_layout.tsx` is being deleted; they nest under the Items layout). Per-record `x+/change-order+/$id*` routes keep their URLs; only their `~/modules/plm` imports change to `~/modules/items`.
- **`plmActivity` decision (resolved, spec §11 default = DROP):** the `plmActivity` table, its routes/UI, `activity.server.ts`, and every `recordPlmActivity` call site are deleted. Audit lives on the `changeOrder` status columns + the notifications. The `plmActivity` insert inside `releaseChangeOrder` is removed.
- **`approvalRequirements` repurpose (resolved):** the MRB `MultiSelect` is removed from the form; the column (free-text `TEXT[]`, validator loosened to `z.array(z.string())`) now stores the picked approver **group ids**. The notifications area reads approver group ids only via the resolved per-user `changeOrderReviewer` rows — it does NOT key fan-out off `approvalRequirements` (Area E resolves reviewers to userIds and uses `recipient:{type:"users"}`).
- **Notify recipient variant (resolved):** the events.ts variant is `{ type: "group"; groupIds }` / `{ type: "users"; userIds }`. The spec's `type:"groups"` is wrong. We resolve reviewers+PM to userIds and use `type:"users"`.
- **Reviewer decision reason (resolved):** no `reason`/`rejectionReason` column exists. Store the per-reviewer reason in the existing `changeOrderReviewer.notes` JSON as `{ reason, decision }`. No new column.
- **`isApprovalGroup` filter (resolved):** the column is ADDED by Task 1 (so notifications/picker can filter later), but the picker ships WITHOUT the filter in this PR (any group/person selectable). Wiring the filter into the `groups` view + `UserSelect` is an explicit follow-up (Task documented, not implemented).

## Dependencies

Ordered build map (migrations → code-move/Duro-delete → services → routes → UI → notifications/lock → drawing → acceptance):

1. **Migrations (Area A)** — revise the two uncommitted PLM migrations: drop Duro surface, add `item.productManager` + `group.isApprovalGroup`, flip `plmReleaseControl` default. **USER applies + regenerates `types.ts`.** Gates every task that reads `item.productManager` / `group.isApprovalGroup` / the `enforce` default.
2. **Duro deletion (Area A)** — delete category/CPN/attributes/components-import/activity service+model+UI+routes; delete the shared `Category` Form component. Parts-area consumers (`partValidator`, `PartForm`, part routes) stripped in the SAME PR.
3. **Code-move (Area A)** — move `changeOrder` service/server/models/types/UI from `modules/plm/` → `modules/items/` (rename `plm.*` → `changeOrder.*`), re-path the three list routes under `x+/items+/change-order+/`, fix OnShape's one import path, fix all `~/modules/plm` importers. **All subsequent tasks target the MOVED files** (`modules/items/changeOrder.*`, `modules/items/ui/ChangeOrder/*`). Where a task below cites `modules/plm/...`, apply it to the moved `modules/items/...` equivalent if the move has landed.
4. **Services (Areas B/C/D/F)** — `partValidator.productManager` + upsert wiring; `approvalRequirements` loosen + `approvers` field + reviewer-seeding in `insertChangeOrder`; widen `getOpenChangeOrderForItem`; threshold evaluator + transition map (pure); `applyChangeOrderReviewerDecision`; `releaseChangeOrder` guard + makeMethod activate/archive; enforce-lock helpers; drawing route + `getChangeOrderValidations` warning; `getMyChangeOrderTasks`.
5. **Routes (Areas B/C/D/E/F)** — create-ECO action wiring; decision route; status-action transition guard; lock-gate in BOM/BOP mutation routes; notify triggers; drawing route; my-tasks route.
6. **UI (Areas B/C/D/E/F)** — PartForm PM picker; under-ECO banner; approver picker + approval-type in ChangeOrderForm; decision modal + header buttons; reviewer reason display; BOM lock affordance; drawing upload UI; my-tasks list + nav.
7. **Notifications (Area E)** — events + getDescription + triggers.
8. **Edge function (Area C)** — disable placeholder-reviewer + groupId approval-task seeding. **USER redeploys/re-serves the `create` function.**
9. **Acceptance (all)** — end-to-end `/test`.

**Cross-area dependency gates (hard):**
- Tasks reading `item.productManager` / `group.isApprovalGroup` / `enforce` default → gated on Task 1 applied + types regenerated.
- Edge-fn behavior change (Task 31) → gated on USER re-serving the `create` function.
- The Duro producers (Task 4–7) and consumers (Task 8) MUST land in the same PR or typecheck breaks.

---

## Tasks

### Task 1 — Revise the two uncommitted PLM migrations (Duro drop + productManager + isApprovalGroup + enforce default)
**Area A.** **GATE for Tasks 9, 12, 24, 27, 28, 29.**

**Files**
- Modify: `packages/database/supabase/migrations/20260622100000_plm-phase2.sql`
- Modify: `packages/database/supabase/migrations/20260621143000_plm-change-orders.sql`

**Interfaces produced:** schema with NO `category`/`categoryAttribute`/`plmActivity` tables; NO `item.categoryId/cpn/eid`; NO `companySettings.plmCpn*`; NO `categoryType` enum. KEEPS `methodMaterial.referenceDesignators` + `methodMaterial.itemNumber`. ADDS `item.productManager` (nullable FK→`user`, `ON DELETE SET NULL`) + `group.isApprovalGroup BOOLEAN NOT NULL DEFAULT false`. `companySettings.plmReleaseControl` default = `'enforce'` (CHECK list unchanged: `('off','warn','enforce')`).

**Steps**
- [ ] Both migrations are **untracked** (`??` in git status) → revise in place; no drop-migration needed.
- [ ] In `20260622100000_plm-phase2.sql`: delete the `categoryType` enum block (lines ~18–25), the `category` table+RLS+publication block (~27–102), the `categoryAttribute` table+RLS block (~104–175), the `item` ALTER adding `categoryId`/`cpn`/`eid`+FK+indexes (~177–193), the `plmActivity` table+RLS+realtime block (~202–249), and the `companySettings` CPN columns block (`plmCpnSeparator`/`plmCpnSequenceSize`/`plmCpnAllowOverride`, ~251–257).
- [ ] **Keep** the `methodMaterial` ALTER adding `referenceDesignators` + `itemNumber` (~195–200) verbatim.
- [ ] Append after the kept `methodMaterial` block:
  ```sql
  -- item.productManager — owner of the item, notified on change (nullable, additive)
  ALTER TABLE "item" ADD COLUMN "productManager" TEXT;
  ALTER TABLE "item"
    ADD CONSTRAINT "item_productManager_fkey" FOREIGN KEY ("productManager")
    REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  CREATE INDEX "item_productManager_idx" ON "item" ("productManager") WHERE "productManager" IS NOT NULL;

  -- group.isApprovalGroup — lets the ECO approver picker filter to reusable approver groups (filter wired later)
  ALTER TABLE "group" ADD COLUMN "isApprovalGroup" BOOLEAN NOT NULL DEFAULT false;
  ```
  (`group` boolean mirrors the `isIdentityGroup` convention in `20230123004632_groups.sql`.)
- [ ] **Update `get_part_details` RPC** to return `productManager` (so `PartSummary` exposes it for the edit-form prefill in Task 9). Locate the RPC body and add `i."productManager"` to its select. If the RPC lives in an earlier migration, add an `OR REPLACE` of the function at the end of this migration.
- [ ] Rewrite the phase-2 header comment block (lines ~1–16) to describe the new contents (productManager + isApprovalGroup + methodMaterial fields + get_part_details), removing the category/CPN/plmActivity prose.
- [ ] In `20260621143000_plm-change-orders.sql` line 632: change `DEFAULT 'off'` → `DEFAULT 'enforce'` (keep the CHECK list `('off','warn','enforce')`). Leave the `changeOrder*` tables, the `customFieldTable` insert (`module='PLM'`), the `PLM` module enum value, the `plm_*` permissions, and the `ECO` sequence seed UNCHANGED — the entity stays; only its nav/code location moves. The `changeOrder` RLS depends on `get_companies_with_employee_permission('plm_*')`; do NOT remove the `PLM` enum/permissions.

**Verify**
- [ ] Visual SQL review (cannot run; the USER applies). After the USER applies + regenerates `types.ts`: confirm `item.productManager` + `group.isApprovalGroup` present; `category`/`categoryAttribute`/`plmActivity`/`item.categoryId/cpn/eid`/`companySettings.plmCpn*` absent; `companySettings.plmReleaseControl` default `enforce`; `get_part_details` returns `productManager`.

---

### Task 2 — Delete the Duro service/model/type code (category + components-import + activity)
**Area A.**

**Files (Delete)**
- `apps/erp/app/modules/plm/category.service.ts`, `category.models.ts`, `category.types.ts`
- `apps/erp/app/modules/plm/components-import.service.ts`, `components-import.models.ts`
- `apps/erp/app/modules/plm/activity.server.ts`

**Interfaces removed:** `getCategory*`, `upsertCategory*`, `deleteCategory*`, `generateCpn`, `getCpnPreview`, `normalizeRows`, `resolveParents`, `importComponents`, `recordPlmActivity`, `getPlmActivities`, all `category*`/`componentsImport`/`categoryValidator` validators+types.

**Steps**
- [ ] `git rm` the six files.
- [ ] Do NOT touch `plm.service.ts`/`plm.server.ts`/`plm.models.ts`/`types.ts` yet (they carry the changeOrder entity and move in Task 7).

**Verify**
- [ ] Deferred — typecheck after Task 3–6 strip the importers (`pnpm --filter erp typecheck` will fail until barrel + routes + Parts consumers are cleaned).

---

### Task 3 — Delete the Category UI + the shared Category Form component
**Area A.**

**Files (Delete)**
- `apps/erp/app/modules/plm/ui/Category/` (entire dir: `CategoriesTable.tsx`, `CategoryAttributeForm.tsx`, `CategoryAttributes.tsx`, `CategoryForm.tsx`, `CategoryHeader.tsx`, `CategoryProperties.tsx`, `ComponentsImportModal.tsx`)
- `apps/erp/app/components/Form/Category.tsx`

**Files (Modify)**
- `apps/erp/app/components/Form/index.ts`

**Steps**
- [ ] `git rm -r apps/erp/app/modules/plm/ui/Category`.
- [ ] `git rm apps/erp/app/components/Form/Category.tsx`.
- [ ] In `Form/index.ts`: remove the `import Category, { useCategories } from "./Category";` line (~33) and remove `Category` (and any `useCategories` re-export) from the export object (~97).

**Verify**
- [ ] `grep -rn "useCategories|from \"./Category\"|Form/Category" apps/erp/app` → 0 (except the Parts consumer fixed in Task 8). Full typecheck deferred to Task 8.

---

### Task 4 — Delete Duro + activity routes; remove activity-feed nav and status-action coupling
**Area A.**

**Files (Delete)**
- `apps/erp/app/routes/x+/category+/` (entire dir)
- `apps/erp/app/routes/x+/plm+/categories.tsx`, `components-import.tsx`, `activity.tsx`
- `apps/erp/app/routes/api+/plm.categories.ts`

**Files (Modify — co-dependency with the status route, see Task 18)**
- `apps/erp/app/routes/x+/change-order+/$id.status.tsx` (remove `recordPlmActivity` import + call)

**Steps**
- [ ] `git rm -r apps/erp/app/routes/x+/category+`.
- [ ] `git rm apps/erp/app/routes/x+/plm+/categories.tsx apps/erp/app/routes/x+/plm+/components-import.tsx apps/erp/app/routes/x+/plm+/activity.tsx apps/erp/app/routes/api+/plm.categories.ts`.
- [ ] In `$id.status.tsx`: delete `import { recordPlmActivity } from "~/modules/plm/activity.server";` and the `await recordPlmActivity(client, {…})` block (~line 47). (This file moves in Task 7; do the edit wherever it lands.)

**Verify**
- [ ] `grep -rn "recordPlmActivity|getPlmActivities|plm.categories|components-import|x\+/category" apps/erp/app` → 0. Full typecheck in Task 8.

---

### Task 5 — Remove the top-level PLM nav and re-home change-order nav under Items
**Area A.**

**Files (Modify)**
- `apps/erp/app/hooks/useModules.tsx` (~98–104 — the `plm` module block)
- `apps/erp/app/modules/items/ui/useItemsSubmodules.tsx`
- `apps/erp/app/modules/plm/ui/useChangeOrdersSubmodules.tsx`

**Files (Delete)**
- `apps/erp/app/routes/x+/plm+/_layout.tsx`, `apps/erp/app/routes/x+/plm+/_index.tsx`

**Steps**
- [ ] In `useModules.tsx`: delete the `{ key: "plm", … to: path.to.changeOrders … }` object. Remove the now-unused `LuGitPullRequestArrow` import only if unused elsewhere.
- [ ] In `useItemsSubmodules.tsx`: add an `Engineering Change` group:
  ```tsx
  {
    name: t`Engineering Change`,
    routes: [
      { name: t`Change Orders`, to: path.to.changeOrders, icon: <LuGitPullRequestArrow />, table: "changeOrder" }
    ]
  }
  ```
  Import `LuGitPullRequestArrow` from `react-icons/lu`. Add Change-Order Types/Workflows to the existing `Configure` group.
- [ ] Delete `x+/plm+/_layout.tsx` + `_index.tsx`. The three list routes move into `x+/items+/change-order+/` in Task 6.
- [ ] Delete the `Categories` entry from `useChangeOrdersSubmodules.tsx`; delete the hook entirely once its routes are absorbed into `useItemsSubmodules`.

**Verify**
- [ ] `grep -rn "useChangeOrdersSubmodules|path.to.plm\b|x\+/plm\+" apps/erp/app` → only intended remaining refs. Full typecheck in Task 8.

---

### Task 6 — Update `path.ts` + re-path the three change-order list routes under Items
**Area A.**

**Files (Modify)**
- `apps/erp/app/utils/path.ts`
- Move: `apps/erp/app/routes/x+/plm+/change-orders.tsx`, `change-order-types.tsx`, `change-order-workflows.tsx` → `apps/erp/app/routes/x+/items+/change-order+/` (or sibling `items+` flat routes per the `items+` convention).

**Steps**
- [ ] In `path.ts`, **remove** Duro entries: `api.categories`, `deleteCategory`, `deleteCategoryAttribute`, `categories`, `componentsImport`, `category`, `categoryDetails`, `updateCategory`, `categoryAttribute`, `newCategory`, `newCategoryAttribute`, `plmActivity`, and the `plm` top-level if unreachable.
- [ ] **Keep** all `changeOrder*` helpers (`changeOrder`, `newChangeOrder`, `changeOrderDetails`, `changeOrderStatus`, `changeOrderTaskStatus`, `releaseChangeOrder`, `changeOrderReview`, etc.) and `changeOrders`/`changeOrderTypes`/`changeOrderWorkflows`.
- [ ] Re-path the three list-route strings (`changeOrders`/`changeOrderTypes`/`changeOrderWorkflows`) from `${x}/plm/...` → `${x}/items/change-order/...` to match their new file location, and update the corresponding `to:` values in `useItemsSubmodules.tsx` (Task 5).
- [ ] `git mv` the three list-route files into `x+/items+/change-order+/`. Per-record `x+/change-order+/$id*` routes keep their URLs (only imports change, Task 7).

**Verify**
- [ ] `grep -rn "path.to.categor|path.to.componentsImport|path.to.plmActivity" apps/erp/app` → 0. Full typecheck in Task 8.

---

### Task 7 — Move the changeOrder entity (service/server/models/types + ChangeOrder UI) into the items module
**Area A.** **All later tasks reference the MOVED locations.**

**Files (Move + rename)**
- `apps/erp/app/modules/plm/plm.service.ts` → `apps/erp/app/modules/items/changeOrder.service.ts`
- `apps/erp/app/modules/plm/plm.server.ts` → `apps/erp/app/modules/items/changeOrder.server.ts`
- `apps/erp/app/modules/plm/plm.models.ts` → `apps/erp/app/modules/items/changeOrder.models.ts`
- `apps/erp/app/modules/plm/types.ts` → `apps/erp/app/modules/items/changeOrder.types.ts`
- `apps/erp/app/modules/plm/ui/ChangeOrder/` → `apps/erp/app/modules/items/ui/ChangeOrder/` (all files)
- Delete: `apps/erp/app/modules/plm/index.ts`
- **Keep in place (PARKED OnShape):** `onshape-*.server.ts`, `onshape-import.service.ts`

**Files (Modify)**
- `apps/erp/app/modules/items/index.ts` — add `export * from "./changeOrder.models"; export * from "./changeOrder.service"; export type * from "./changeOrder.types";` (do NOT re-export `changeOrder.server` — server-only).
- `apps/erp/app/modules/plm/onshape-import.service.ts` — change `from "./plm.service"` → `from "../items/changeOrder.service"`.
- All `x+/change-order+/*` route files + the three moved list routes — `~/modules/plm` → `~/modules/items`; `~/modules/plm/plm.server` → `~/modules/items/changeOrder.server`; `~/modules/plm/ui/ChangeOrder/*` → `~/modules/items/ui/ChangeOrder/*`.
- Moved UI internal imports — `../../plm.models` → `../../changeOrder.models`; `../../types` → `../../changeOrder.types`.

**Interfaces preserved:** every `getChangeOrder*`, `insertChangeOrder`, `updateChangeOrderStatus`, `createPendingRevision`, `getOpenChangeOrderForItem`, `getNextRevision`, `releaseChangeOrder`, `getChangeOrderValidations`, `isChangeOrderLocked`, all validators, all `ChangeOrder*` types. Signatures unchanged — only file locations + import specifiers.

**Steps**
- [ ] `git mv` the four `plm.*` files to `items/changeOrder.*`; `git mv` `plm/types.ts` → `items/changeOrder.types.ts`; `git mv apps/erp/app/modules/plm/ui/ChangeOrder apps/erp/app/modules/items/ui/ChangeOrder`.
- [ ] In `changeOrder.service.ts`: `import { createRevision, getItem } from "../items/items.service"` → `from "./items.service"`; model imports `from "./plm.models"` → `from "./changeOrder.models"`.
- [ ] In `changeOrder.types.ts`: imports `from "./plm.service"` → `from "./changeOrder.service"`.
- [ ] In `onshape-import.service.ts`: line ~8 `from "../items/items.service"` unchanged; the `from "./plm.service"` import → `from "../items/changeOrder.service"`.
- [ ] Update `modules/items/index.ts` re-exports.
- [ ] Sweep all importers: `grep -rn "~/modules/plm" apps/erp/app` — every hit that is NOT an OnShape `*.server`/`onshape-import.service` direct-path is a change-order ref → rewrite to `~/modules/items`.
- [ ] Delete `modules/plm/index.ts` (the OnShape route imports `importReleasedRevision` via direct path `~/modules/plm/onshape-import.service`, not the barrel — safe).
- [ ] Leave `plm/` existing for the parked OnShape files only.

**Verify**
- [ ] `grep -rn "~/modules/plm" apps/erp/app` → only the two OnShape direct-path imports remain.
- [ ] Deferred full typecheck to Task 8 (Parts consumers still reference deleted symbols).

---

### Task 8 — Strip Duro symbols from Parts consumers + add `productManager` to `partValidator` (same PR as Tasks 2–7)
**Areas A + B.** **GATE: this closes the typecheck after the deletions/move.** Reads `item.productManager` → benefits from Task 1 applied, but the validator/form/persist edits typecheck regardless (column existence only matters at runtime/types-regen).

**Files (Modify)**
- `apps/erp/app/modules/items/items.models.ts`
- `apps/erp/app/modules/items/ui/Parts/PartForm.tsx`
- `apps/erp/app/routes/x+/part+/new.tsx`
- `apps/erp/app/routes/x+/part+/$itemId.details.tsx`

**Interfaces produced:** `partValidator` accepts `productManager?: string`; no longer references `categoryId`/`eid`. `PartForm` posts `productManager`. Part routes no longer import `generateCpn` or write `categoryId`/`cpn`/`eid`.

**Steps**
- [ ] `items.models.ts`: in the `z.object` merged into `partValidator` (~637–648), **remove** `categoryId` + `eid` + the PLM-phase-2 comment, and **add** `productManager: zfd.text(z.string().optional()),`.
- [ ] `PartForm.tsx`: in the `~/components/Form` import (~33), remove `Category`, add `Employee`. Replace the `<Category name="categoryId">` block + the `<Input name="eid">` block (~285–294) with a single picker (one grid cell, layout reflows):
  ```tsx
  <Employee name="productManager" label={t`Product Manager`} isOptional isClearable />
  ```
- [ ] `new.tsx` action: delete the PLM-phase-2 `try {…} catch {}` block that calls `generateCpn` and updates `categoryId/cpn/eid` (~64–86), and remove `import { generateCpn } from "~/modules/plm";`. `productManager` flows through `validation.data` → `upsertPart`.
- [ ] `$itemId.details.tsx` action: delete the PLM-phase-2 `try {…} catch {}` block (~235–262) and remove `import { generateCpn } from "~/modules/plm";`.

**Verify**
- [ ] `pnpm --filter erp typecheck` — **must be GREEN** (this proves Duro deletion + the code-move + OnShape parked code all compile). If types not yet regenerated for `productManager`, the validator field still typechecks (zod-only); runtime persistence is verified post-migration in Task 32.

---

### Task 9 — Persist `productManager` on the part upsert (clean, no post-update hack)
**Area B.** Reads `item.productManager` → **GATE on Task 1** for runtime persistence; typechecks now.

**Files (Modify)**
- `apps/erp/app/modules/items/items.service.ts` (`upsertPart`)

**Interfaces:** `item.productManager` written on create + update directly inside `upsertPart`.

**Steps**
- [ ] Insert branch (~2877–2895): add `productManager: part.productManager ?? null,` to the `.from("item").insert({...})` object.
- [ ] Update branch (`itemUpdate` object, ~2963–2972): add `productManager: part.productManager ?? null,`. It flows through `sanitize(itemUpdate)` — **confirmed** `sanitize` (`packages/utils/src/supabase.ts`) converts `undefined`→`null` but KEEPS explicit `null`, so passing `?? null` persists a clear correctly inside `sanitize`. No outside-sanitize hack needed.
- [ ] Edit-form prefill: `get_part_details` returns `productManager` (Task 1), so `PartSummary` exposes it and the edit `PartForm`'s `initialValues` (spread of the summary) prefills automatically. If `initialValues` is hand-built rather than a raw spread, add `productManager: partSummary.productManager ?? undefined`.

**Verify**
- [ ] `pnpm --filter erp typecheck`. Runtime persistence verified in Task 32 after the migration applies.

---

### Task 10 — "Create Change Order" action on PartHeader (seed item as affected item)
**Area B.**

**Files (Modify)**
- `apps/erp/app/modules/items/ui/Parts/PartHeader.tsx`

**Interfaces consumed:** `path.to.newChangeOrder` (stable handle); the create route already maps `?itemId` → seeded affected item (`change-order+/new.tsx` reads `itemId` from params and seeds `items: itemId ? [itemId] : []`).

**Steps**
- [ ] Add a `DropdownMenuItem` to the existing kebab menu (after `{auditLogTrigger}`, before the `DropdownMenuSeparator`), gated on `permissions.can("create", "plm")`:
  ```tsx
  <DropdownMenuItem disabled={!permissions.can("create", "plm")}
    onClick={() => navigate(`${path.to.newChangeOrder}?itemId=${itemId}`)}>
    <DropdownMenuIcon icon={<LuGitPullRequestArrow />} />
    <Trans>Create Change Order</Trans>
  </DropdownMenuItem>
  ```
- [ ] Import `useNavigate` from `react-router`; add `const navigate = useNavigate();`. Import `LuGitPullRequestArrow` from `react-icons/lu` (grep existing `react-icons/lu` usage to confirm availability; fall back to `LuFileStack`).
- [ ] Permission scope `"plm"` matches the create route's `requirePermissions(request, { create: "plm" })` (entity unchanged → permission unchanged).

**Verify**
- [ ] `pnpm --filter erp typecheck`. Manual: kebab → "Create Change Order" → create form opens with the part pre-listed as an affected item.

---

### Task 11 — Widen `getOpenChangeOrderForItem` to return `{ id, changeOrderId, status }`
**Area B.** (Single load-bearing service change; additive — existing callers only read `.data?.changeOrderId`.)

**Files (Modify)**
- `apps/erp/app/modules/items/changeOrder.service.ts` (`getOpenChangeOrderForItem`, ~541–576 of the old `plm.service.ts`)

**Interfaces produced:** return `{ data: { id: string; changeOrderId: string; status: string } | null; error }`.

**Steps**
- [ ] Change the select to also pull the row `id`: `.select("changeOrderId, changeOrder:changeOrderId(id, changeOrderId, status)")`.
- [ ] Update the return type and the conflict-mapping to return `{ id: co.id, changeOrderId: co.changeOrderId, status: co.status }`. Keep the `excludeChangeOrderId` filter + the `OPEN_CHANGE_ORDER_STATUSES` check unchanged.
- [ ] `grep -rn "getOpenChangeOrderForItem" apps/erp/app` first — confirm no caller destructures the old exact shape (they read `.data?.changeOrderId`; widening is additive).

**Verify**
- [ ] `pnpm --filter erp typecheck`.

---

### Task 12 — Under-ECO warning banner above PartHeader
**Area B.** Consumes Task 11. Banner is read-only (no permission gate beyond the loader's `view: "parts"`).

**Files (Modify)**
- `apps/erp/app/routes/x+/part+/$itemId.tsx` (loader + render)

**Steps**
- [ ] Loader (~69–74 `Promise.all`): add `getOpenChangeOrderForItem(client, { itemId, companyId })` to the parallel fetch; import it from `~/modules/items`. Add `openChangeOrder: openCo.data ?? null` to the returned object. **No second `getChangeOrder` call** — Task 11 returns status in one query (fewer round-trips; only way to get the linkable row `id`).
- [ ] Render above `<PartHeader />` in `PartRoute`:
  ```tsx
  {openChangeOrder && (
    <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
      <LuTriangleAlert className="h-4 w-4" />
      <AlertTitle>
        <Trans>This item is under change order{" "}
          <Link to={path.to.changeOrder(openChangeOrder.id)} className="underline font-medium">
            {openChangeOrder.changeOrderId}
          </Link>{" "}({openChangeOrder.status})</Trans>
      </AlertTitle>
    </Alert>
  )}
  <PartHeader />
  ```
- [ ] Import `Alert`/`AlertTitle` from `@carbon/react` — **grep an existing `Alert` usage in `apps/erp/app` first** and mirror its exact exported names/variant (do not invent `variant="warning"` if the codebase uses a different name). Import `Link` from `react-router`; `LuTriangleAlert` from `react-icons/lu`.
- [ ] If the thin banner clips the height-constrained layout (`h-[calc(100dvh-49px)]` / inner `h-[calc(100dvh-99px)]`), wrap header+banner so only the non-banner area is height-constrained. Verify visually in `/test`.

**Verify**
- [ ] `pnpm --filter erp typecheck`. Manual (`/test`): a part with an open Draft/In-Review/Approved CO shows the banner + link; a part with none shows nothing.

---

### Task 13 — Loosen `approvalRequirements` to free-form group ids
**Area C.**

**Files (Modify)**
- `apps/erp/app/modules/items/changeOrder.models.ts`

**Interfaces produced:** `changeOrderValidator.approvalRequirements: string[] | undefined`.

**Steps**
- [ ] In `changeOrderValidator`, change `approvalRequirements: z.array(z.enum(changeOrderApprovalRequirement)).optional()` → `z.array(z.string()).optional()` (now carries approver **group ids**).
- [ ] **Keep** the `changeOrderApprovalRequirement = ["MRB"] as const` export (still referenced by `changeOrderWorkflowValidator` + the service input type).
- [ ] Leave `changeOrderApprovalType` (`["Unanimous","Majority","First-In"]`) untouched.

**Verify**
- [ ] `pnpm --filter erp typecheck` (expect downstream errors only where `approvalRequirements` was assumed enum — fixed in Tasks 14–17).

---

### Task 14 — Add `approvers` field to the validator + `insertChangeOrder` input
**Area C.**

**Files (Modify)**
- `apps/erp/app/modules/items/changeOrder.models.ts`
- `apps/erp/app/modules/items/changeOrder.service.ts` (`insertChangeOrder` input type + destructure)

**Interfaces produced:** `changeOrderValidator.approvers: string[] | undefined` (prefixed `group_<id>` | `user_<id>`); `insertChangeOrder` input gains `approvers?: string[]`; `approvalRequirements?: string[]`.

**Steps**
- [ ] In `changeOrderValidator` add `approvers: z.array(z.string()).optional(),` (after `assignee`).
- [ ] In `insertChangeOrder` input type: change `approvalRequirements?: (typeof changeOrderApprovalRequirement)[number][]` → `approvalRequirements?: string[]`, add `approvers?: string[];`.
- [ ] In `const { items, ...data } = input;` add `approvers`: `const { items, approvers, ...data } = input;` (so it is NOT forwarded into the `changeOrder` insert object).

**Verify**
- [ ] `pnpm --filter erp typecheck`.

---

### Task 15 — Resolve approvers → user ids; seed one reviewer per user; persist group ids to `approvalRequirements`
**Area C.** Server-side; verified e2e in Task 32.

**Files (Modify)**
- `apps/erp/app/modules/items/changeOrder.service.ts` (`insertChangeOrder`)

**Interfaces consumed:** `client.rpc("users_for_groups", { groups })` → string[]; `client.from("user").select("id, fullName")`.

**Steps**
- [ ] Before the `client.from("changeOrder").insert({...})` call, derive group ids:
  ```ts
  const approverGroupIds = (approvers ?? []).filter(a => a.startsWith("group_")).map(a => a.slice(6));
  ```
  In the insert object, set `approvalRequirements: approverGroupIds` (the CO records its approver groups; we always use the picked group ids — confirmed no separate fan-out key needed since notifications resolve via reviewer rows).
- [ ] After the `changeOrderItem` insert and BEFORE the `create` edge invoke, resolve approvers → users and seed reviewers:
  ```ts
  if (approvers && approvers.length > 0) {
    const groupIds = approvers.filter(a => a.startsWith("group_")).map(a => a.slice(6));
    const userIdsFromPicker = approvers.filter(a => a.startsWith("user_")).map(a => a.slice(5));
    let groupUserIds: string[] = [];
    if (groupIds.length > 0) {
      const resolved = await client.rpc("users_for_groups", { groups: groupIds });
      if (!resolved.error && Array.isArray(resolved.data)) groupUserIds = resolved.data as string[];
    }
    const reviewerUserIds = [...new Set([...userIdsFromPicker, ...groupUserIds])].filter(Boolean);
    if (reviewerUserIds.length > 0) {
      const names = await client.from("user").select("id, fullName").in("id", reviewerUserIds);
      const nameById = new Map((names.data ?? []).map(u => [u.id, u.fullName]));
      const reviewerRows = reviewerUserIds.map((uid, index) => ({
        changeOrderId: coId, title: nameById.get(uid) ?? "Reviewer",
        assignee: uid, status: "Pending" as const, sortOrder: index + 1,
        companyId: input.companyId, createdBy: input.createdBy
      }));
      const reviewerInsert = await client.from("changeOrderReviewer").insert(reviewerRows);
      if (reviewerInsert.error) console.error(reviewerInsert.error);
    }
  }
  ```
  (`coId = result.data.id`. `changeOrderReviewer.id` defaults via `id('cor')` — do not set it. `title` is NOT NULL → use the user's full name. `assignee` FK + index confirmed in the migration.)

**Verify**
- [ ] `pnpm --filter erp typecheck`. E2e in Task 32.

---

### Task 16 — Replace the MRB control with an approver picker (groups + people) in ChangeOrderForm
**Area C.**

**Files (Modify)**
- `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderForm.tsx`

**Interfaces consumed:** `Users` from `~/components/Form` (with `verbose`) emits hidden inputs `approvers[i] = group_<id> | user_<id>` — **confirmed reusable**; `UserSelect` natively returns a MIX of groups+individuals when `usersOnly` is not set; server split is `id.startsWith("group_")`/`"user_"` (matches Task 15).

**Steps**
- [ ] Add `Users` to the `~/components/Form` import.
- [ ] **Remove** the `MultiSelect name="approvalRequirements"` (MRB) block entirely. Remove `changeOrderApprovalRequirement` from the local `../../changeOrder.models` import if no longer used. Keep the `requiredActionIds` MultiSelect and the `items` MultiSelect (affected-item picker, pre-seeded from `initialValues.items`).
- [ ] Render the approver picker next to the existing `approvalType` `Select`:
  ```tsx
  <Users name="approvers" label={t`Approvers`} type="employee" verbose />
  ```
- [ ] Keep the existing `approvalType` `Select` (Unanimous/Majority/First-In; default `Unanimous` via `initialValues.approvalType`).

**Verify**
- [ ] `pnpm --filter erp typecheck`. Manual: the create form shows an "Approvers" picker listing both groups and individuals.

---

### Task 17 — Wire `approvers` through the create route action + initialValues
**Area C.**

**Files (Modify)**
- `apps/erp/app/routes/x+/change-order+/new.tsx`

**Steps**
- [ ] In the `action`, add `approvers: d.approvers,` to the `insertChangeOrder(serviceRole, {...})` argument object (alongside `assignee`, `items`). Drop `approvalRequirements: d.approvalRequirements` from the call (the service now derives `approvalRequirements` from `approvers` — Task 15).
- [ ] In `ChangeOrderNewRoute`'s `initialValues`, add `approvers: [] as string[],` and remove the orphan `approvalRequirements: []` default.

**Verify**
- [ ] `pnpm --filter erp typecheck`.

---

### Task 18 — Threshold evaluator + status-transition map (pure functions) + tests
**Area D.** **GATE for Tasks 19, 20.**

**Files (Modify/Create)**
- Modify: `apps/erp/app/modules/items/changeOrder.models.ts`
- Create: `apps/erp/app/modules/items/changeOrder.models.test.ts`

**Interfaces produced:** `changeOrderStatusTransitions`, `isAllowedChangeOrderTransition(from, to)`, `evaluateApprovalThreshold({ approvalType, reviewers })`.

**Steps**
- [ ] Add after the `isChangeOrderLocked` block:
  ```ts
  export const changeOrderStatusTransitions = {
    Draft: ["In Review", "Cancelled"],
    "In Review": ["Approved", "Draft", "Cancelled"], // Draft = reject path
    Approved: ["Released", "Draft", "Cancelled"],
    Released: [], Cancelled: []
  } as const satisfies Record<(typeof changeOrderStatus)[number], readonly (typeof changeOrderStatus)[number][]>;
  ```
- [ ] `isAllowedChangeOrderTransition(from, to)`: `false` if `from` is null/undefined/not a key or `from === to`; else `changeOrderStatusTransitions[from].includes(to)`.
- [ ] `evaluateApprovalThreshold({ approvalType, reviewers })`: a positive = `status === "Completed"`. `total = reviewers.length`; `completed = count Completed`. `total === 0` → `false`. Unanimous: `completed === total`. Majority: `completed * 2 > total`. First-In: `completed >= 1`.
- [ ] Create the test (vitest): transitions (`Draft→In Review` true, `Draft→Approved` false, `In Review→Draft` true, `Approved→Released` true, `Released→*` false, `undefined` false); thresholds (Unanimous 2/3 false, 3/3 true; Majority 1/2 false, 2/3 true, 2/2 true; First-In 1/5 true, 0/2 false; zero reviewers false for every type).

**Verify**
- [ ] `pnpm --filter erp typecheck` + `pnpm --filter erp test changeOrder.models`.

---

### Task 19 — `applyChangeOrderReviewerDecision` server fn (records reviewer + auto-advances)
**Area D.** Consumes Task 18.

**Files (Modify)**
- `apps/erp/app/modules/items/changeOrder.service.ts`

**Interfaces produced:**
```ts
export async function applyChangeOrderReviewerDecision(
  client, args: { changeOrderId: string; decision: "approve" | "reject"; reason: string; userId: string; companyId: string }
): Promise<{ data: { status: (typeof changeOrderStatus)[number]; autoAdvanced: boolean } | null; error: { message: string } | null }>;
```

**Steps**
- [ ] Import `evaluateApprovalThreshold` + `isAllowedChangeOrderTransition` (value imports) from `./changeOrder.models`.
- [ ] Load CO via `getChangeOrder`. Guard: exists, `status === "In Review"` else `{ data:null, error:{message:"Change order is not in review"} }`.
- [ ] Load reviewers via `getChangeOrderReviewers`. Find the current user's row: `reviewers.data?.find(r => r.assignee === userId)`. If none → `{ data:null, error:{message:"You are not a reviewer on this change order"} }`.
- [ ] **Reject:** reset every reviewer `update({ status:"Pending", completedDate:null, updatedBy:userId }).eq("changeOrderId",...).eq("companyId",...)`; write the rejecting reviewer's `notes:{ reason, decision:"reject" }` on `myRow.id`; `updateChangeOrderStatus(client, { id, status:"Draft", updatedBy:userId })`; return `{ data:{ status:"Draft", autoAdvanced:false }, error:null }`.
- [ ] **Approve:** record `update({ status:"Completed", completedDate: today, notes:{ reason, decision:"approve" }, updatedBy:userId }).eq("id", myRow.id)` (`today = new Date().toISOString().split("T")[0]`). Patch `myRow.status="Completed"` in-memory; `const met = evaluateApprovalThreshold({ approvalType: co.approvalType, reviewers: patched })`. If `met` → `updateChangeOrderStatus(client, { id, status:"Approved", updatedBy:userId })`; return `{ data:{ status:"Approved", autoAdvanced:true }, error:null }`. Else `{ data:{ status:"In Review", autoAdvanced:false }, error:null }`.
- [ ] Check `.error` on each write.

**Verify**
- [ ] `pnpm --filter erp typecheck`. E2e in Task 32.

---

### Task 20 — Decision route + validator + path helper
**Area D.** Consumes Task 19.

**Files (Create/Modify)**
- Create: `apps/erp/app/routes/x+/change-order+/$id.decision.tsx`
- Modify: `apps/erp/app/utils/path.ts` (add `changeOrderDecision`)
- Modify: `apps/erp/app/modules/items/changeOrder.models.ts` (add `changeOrderDecisionValidator`)

**Steps**
- [ ] In `changeOrder.models.ts`, add `changeOrderDecisionValidator = z.object({ decision: z.enum(["approve","reject"]), reason: z.string().min(1, { message: "Reason is required" }) })` (auto-exported via the items barrel).
- [ ] In `path.ts`, add `changeOrderDecision: (id: string) => generatePath(`${x}/change-order/${id}/decision`)` after `changeOrderReview`.
- [ ] Create the route (mirror `task.$id.status.tsx`): `assertIsPost`; `requirePermissions(request, { update: "plm" })`; guard `id`; `validator(changeOrderDecisionValidator).validate(formData)` → `validationError` on error; call `applyChangeOrderReviewerDecision`; on `result.error` → `redirect(requestReferrer(request) ?? path.to.changeOrderDetails(id), flash(error(...)))`. Success flash: approve+autoAdvanced → "Change order approved"; approve no-advance → "Recorded your approval"; reject → "Change order sent back to draft". (No `recordPlmActivity` — table dropped.)

**Verify**
- [ ] `pnpm --filter erp typecheck`.

---

### Task 21 — `ChangeOrderDecisionModal` (reason modal, shared by Approve & Reject)
**Area D.** Consumes Task 20.

**Files (Create)**
- `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderDecisionModal.tsx`

**Interfaces produced:** `ChangeOrderDecisionModal({ changeOrderId, decision: "approve"|"reject", onClose })`.

**Steps**
- [ ] Mirror `SyncReleasedFromOnshapeModal.tsx`: `<Modal open onOpenChange={o => { if(!o) onClose() }}>` → `ModalContent onInteractOutside={e=>e.preventDefault()}` → `ModalHeader/Title/Description`.
- [ ] Title/description branch on `decision` (approve: "Approve change order" / "Record your approval. Add a reason for the audit trail."; reject: "Reject change order" / "This sends the change order back to Draft and resets all reviewer decisions.").
- [ ] Body: controlled `Textarea` (use `@carbon/react` `Textarea` if exported, else styled `<textarea>`). `const [reason, setReason] = useState("")`.
- [ ] Footer: Cancel (`variant="secondary"` → `onClose`) + primary (reject: `variant="destructive"` "Reject"; approve: default "Approve"). `isDisabled={reason.trim().length === 0 || fetcher.state !== "idle"}`, `isLoading={fetcher.state !== "idle"}`.
- [ ] Submit via `useFetcher`: `fetcher.submit({ decision, reason }, { method:"post", action: path.to.changeOrderDecision(changeOrderId) })`. Close on `idle` after a submit (gate on a `hasSubmitted` ref so it doesn't close on mount).
- [ ] Wrap copy in `<Trans>`/`t`.

**Verify**
- [ ] `pnpm --filter erp typecheck`. Visual in Task 32.

---

### Task 22 — Wire Approve/Reject buttons in ChangeOrderHeader
**Area D.** Consumes Task 21.

**Files (Modify)**
- `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderHeader.tsx`

**Steps**
- [ ] **Replace** the existing "Approve" `statusFetcher.Form` block (which POSTs `status="Approved"` directly) with two buttons opening the decision modal. Add `const approveModal = useDisclosure(); const rejectModal = useDisclosure();`.
- [ ] "Approve" `<Button leftIcon={<LuCircleCheck/>} variant={status === "In Review" ? "primary" : "secondary"} onClick={approveModal.onOpen}>` and "Reject" `<Button leftIcon={<LuCircleX/>} variant="secondary" onClick={rejectModal.onOpen}>` (`LuCircleX` from `react-icons/lu`).
- [ ] Disable both when `status !== "In Review" || !permissions.can("update", "plm")`. **Do NOT** gate client-side on reviewer membership (avoids adding `reviewers` to the `$id.tsx` loader) — the server (Task 19) returns "You are not a reviewer" as a flash for non-reviewers.
- [ ] Render the modals near the existing `ConfirmDelete`:
  ```tsx
  {approveModal.isOpen && <ChangeOrderDecisionModal changeOrderId={id} decision="approve" onClose={approveModal.onClose} />}
  {rejectModal.isOpen && <ChangeOrderDecisionModal changeOrderId={id} decision="reject" onClose={rejectModal.onClose} />}
  ```
- [ ] Keep "Submit for Review" and "Release" unchanged.

**Verify**
- [ ] `pnpm --filter erp typecheck`. Manual: a CO in `In Review` → Approve opens the modal.

---

### Task 23 — Server-side transition guard in the status action
**Area D.** Consumes Task 18.

**Files (Modify)**
- `apps/erp/app/routes/x+/change-order+/$id.status.tsx`

**Steps**
- [ ] After parsing `status`, before calling `updateChangeOrderStatus`: load `const current = await getChangeOrder(client, id)` (import from `~/modules/items`). If `current.error || !current.data` → redirect with flash "Change order not found".
- [ ] `if (!isAllowedChangeOrderTransition(current.data.status, status)) { throw redirect(requestReferrer(request) ?? path.to.changeOrderDetails(id), await flash(request, error(null, \`Cannot move change order from ${current.data.status} to ${status}\`))); }` (import `isAllowedChangeOrderTransition` from `~/modules/items`).
- [ ] Keep the existing enum-membership check (guards malformed input). Note: with Task 22, the only legitimate POSTs here are `In Review` (submit) and `Cancelled`; `Approved` now flows through `$id.decision.tsx`. Release flows through `$id.release.tsx` (guarded in Task 24).

**Verify**
- [ ] `pnpm --filter erp typecheck`. Manual: a crafted POST `status=Released` on a `Draft` CO flashes the guard error; legal `Draft→In Review` still works.

---

### Task 24 — `releaseChangeOrder`: transition guard + mark new makeMethod Active / prior Archived
**Area D.** Reads no new column; uses existing `makeMethod.status`.

**Files (Modify)**
- `apps/erp/app/modules/items/changeOrder.server.ts` (`releaseChangeOrder`)

**Steps**
- [ ] After loading `changeOrder` inside the txn, guard: `if (changeOrder.status !== "Approved") throw new Error(\`Cannot release a change order in status ${changeOrder.status}\`);` (rolls back via the existing catch).
- [ ] Inside the per-item loop, after the two `item` `revisionStatus` updates, for each `coItem` with a `pendingItemId`:
  - Activate the new revision's make method(s): `trx.updateTable("makeMethod").set({ status:"Active", updatedBy:userId }).where("itemId","=",coItem.pendingItemId).where("companyId","=",companyId).where("status","=","Draft").execute();`
  - Archive the prior revision's make method(s): `trx.updateTable("makeMethod").set({ status:"Archived", updatedBy:userId }).where("itemId","=",coItem.itemId).where("companyId","=",companyId).where("status","=","Active").execute();`
  - Scope to `Draft`/`Active` so already-archived rows are untouched. Add a code comment noting the single-version invariant from `createPendingRevision`.
- [ ] **Remove** the `plmActivity` insert (table dropped). Leave `effectiveDate` logic.

**Verify**
- [ ] `pnpm --filter erp typecheck`. Manual (Task 32): after release, the pending item's `makeMethod.status='Active'`, the prior `='Archived'`, `activeMakeMethods` returns the new row.

---

### Task 25 — Surface reviewer decision reason in ChangeOrderTaskItem (optional polish)
**Area D.** Consumes Task 19's `notes` shape. Nice-to-have; skip if time-boxed (reason still persists + shows via flash).

**Files (Modify)**
- `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderTaskItem.tsx`

**Steps**
- [ ] In the expandable detail body, when `type === "review"` && `disclosure.isOpen` && `notes?.reason`, render one muted line "Reason: {notes.reason}". Cast `const notes = (task as ChangeOrderReviewer).notes as { reason?: string } | null`. No new badges/icons.

**Verify**
- [ ] `pnpm --filter erp typecheck`.

---

### Task 26 — Add four `ChangeOrder*` notification events to `@carbon/notifications`
**Area E.**

**Files (Modify)**
- `packages/notifications/src/index.ts`

**Interfaces produced:** `NotificationEvent.ChangeOrderSubmittedForReview/ChangeOrderApproved/ChangeOrderRejected/ChangeOrderReleased`.

**Steps**
- [ ] Add the four enum members (after `ApprovalRequested`).
- [ ] In `getNotificationTopic`, add a case group returning `NotificationTopic.Approval` (reuse the Approval topic — no `notification.topic` migration).
- [ ] In `getNotificationEmailHeading`, add: "Change order needs your review" / "Change order approved" / "Change order rejected" / "Change order released".
- [ ] In `getNotificationEmailCtaLabel`, add: "Review change order" (submitted) / "View change order" (the other three). (No `getNotificationTopicPhrase` change — already handles `Approval`.)

**Verify**
- [ ] `pnpm --filter @carbon/notifications typecheck` (or rely on `pnpm --filter erp typecheck` in Task 28 picking up the new members if no package typecheck script).

---

### Task 27 — Add `getDescription` cases for the new events in the notify Inngest function
**Area E.** `changeOrder.changeOrderId` (readable) + `name` columns **confirmed** present.

**Files (Modify)**
- `packages/jobs/src/inngest/functions/notifications/notify.ts`

**Steps**
- [ ] In `getDescription`'s `switch (type)`, add four cases before `default`. Each loads the CO and returns a sentence using the readable id:
  ```ts
  case NotificationEvent.ChangeOrderSubmittedForReview: {
    const co = await client.from("changeOrder").select("changeOrderId").eq("id", documentId).single();
    if (co.error) { console.error("Failed to get changeOrder", co.error); throw co.error; }
    return `Change order ${co.data.changeOrderId} needs your review`;
  }
  // ...Approved → "was approved"; Rejected → "was rejected"; Released → "was released"
  ```
- [ ] (Recommended) Add the four events to `defaultDestinations` with `[Email, Slack]` (InApp is always added) so they behave like `Approval*`.
- [ ] Do NOT touch `buildNotificationLink`'s `documentType` path — `changeOrder` is **confirmed NOT in** the `approvalDocumentType` enum, so the deep-link falls back to a generic link. **Follow-up (non-blocking):** to deep-link a CO, `apps/erp/app/routes/api+/link.ts` must learn the `change-order-*` events. In-app/email delivery is unaffected.

**Verify**
- [ ] `pnpm --filter @carbon/jobs typecheck`.

---

### Task 28 — Trigger notify on the real transition commits (review-requested, approved, rejected, released)
**Area E.** Reads `item.productManager` → **GATE on Task 1**. Reviewer ids via `changeOrderReviewer.assignee` (confirmed).

**Files (Modify)**
- `apps/erp/app/routes/x+/change-order+/$id.status.tsx` (the `In Review` submit commit; also `Cancelled` if desired)
- `apps/erp/app/modules/items/changeOrder.service.ts` (`applyChangeOrderReviewerDecision` — the `Approved` auto-advance commit + the `Draft` reject commit, Task 19)
- `apps/erp/app/modules/items/changeOrder.server.ts` (`releaseChangeOrder` — the `Released` commit, Task 24)

**Steps**
- [ ] Helper (place in `changeOrder.service.ts` or inline): resolve recipients for a CO — reviewer userIds (`changeOrderReviewer.select("assignee").eq("changeOrderId", id)`) ∪ product-manager ids (`changeOrderItem.select("item(productManager)").eq("changeOrderId", id)`), deduped, filtered non-null.
- [ ] After the **`In Review`** commit in `$id.status.tsx`: best-effort (try/catch so notify failure never fails the commit) `trigger("notify", { companyId, documentId: id, event: NotificationEvent.ChangeOrderSubmittedForReview, recipient: { type:"users", userIds }, from: userId })`.
- [ ] After the **`Approved`** auto-advance commit in `applyChangeOrderReviewerDecision` (Task 19, when `met`): fire `ChangeOrderApproved` to the same recipient set.
- [ ] After the **`Draft`** reject commit in `applyChangeOrderReviewerDecision`: fire `ChangeOrderRejected`.
- [ ] After the **`Released`** commit in `releaseChangeOrder` (Task 24): fire `ChangeOrderReleased`.
- [ ] Use `recipient: { type: "users", userIds }` (NOT `"groups"`/`"group"` — we resolve to individuals). Add imports `import { trigger } from "@carbon/jobs";` + `import { NotificationEvent } from "@carbon/notifications";`.

**Verify**
- [ ] `pnpm --filter erp typecheck`. Manual (after DB applied): submit → reviewers + PM get "needs your review"; approve (threshold met) → "was approved"; reject → "was rejected"; release → "was released". Cross-check `notification` rows in `/test`.

---

### Task 29 — Enforce-lock helpers + lock-gate in BOM/BOP mutation routes
**Area E.** Reads `companySettings.plmReleaseControl` (now defaults `enforce`) + `item.revisionStatus`. **GATE on Task 1** for the `enforce` default at runtime; typechecks now.

**Files (Create/Modify)**
- Create: `apps/erp/app/modules/items/revisionLock.server.ts`
- Modify: `apps/erp/app/modules/items/index.ts` (re-export the helpers + `LOCKED_REVISION_MESSAGE`)
- Modify: `apps/erp/app/routes/x+/items+/methods+/material.new.tsx`, `material.$id.tsx`, `operation.new.tsx`, `operation.step.$id.tsx`

**Interfaces produced:**
```ts
export async function getRevisionLock(client, args:{ itemId; companyId }): Promise<{ mode:"enforce"|"warn"|"off"; locked:boolean; revisionStatus:string }>;
export async function getItemIdForMakeMethod(client, makeMethodId:string): Promise<string | null>;
export async function getItemIdForOperation(client, operationId:string): Promise<string | null>;
export const LOCKED_REVISION_MESSAGE = "This revision is released (Production). Open a change order to modify its BOM/BOP.";
```

**Steps**
- [ ] `getItemIdForMakeMethod`: `client.from("makeMethod").select("itemId").eq("id", makeMethodId).single()` → `data?.itemId ?? null`.
- [ ] `getItemIdForOperation`: `client.from("methodOperation").select("makeMethod(itemId)").eq("id", operationId).single()` → `data?.makeMethod?.itemId ?? null`.
- [ ] `getRevisionLock`: `Promise.all([client.from("item").select("revisionStatus").eq("id", itemId).single(), getCompanySettings(client, companyId)])`; `mode = (settings.data?.plmReleaseControl ?? "off")`; `revisionStatus = item.data?.revisionStatus ?? ""`; `locked = revisionStatus === "Production"`.
- [ ] **`material.new.tsx` / `material.$id.tsx`** (after the `validation.error` guard): resolve `itemId = validation.data.itemId ?? await getItemIdForMakeMethod(client, validation.data.makeMethodId)`; if `itemId`, `const lock = await getRevisionLock(...)`; if `lock.locked && lock.mode === "enforce"` → `return validationError({ fieldErrors: { id: LOCKED_REVISION_MESSAGE }, formId: undefined, subaction: undefined } as any)`; if `lock.locked && lock.mode === "warn"` → proceed but wrap the success return in `data({...}, await flash(request, error(null, LOCKED_REVISION_MESSAGE)))`; `off` → unchanged.
- [ ] **`operation.new.tsx`** (after `validation.error`): resolve via `getItemIdForMakeMethod(client, validation.data.makeMethodId)`; same enforce/warn/off branch.
- [ ] **`operation.step.$id.tsx`** (around the existing `assertMethodOperationIsDraft` call): resolve via `getItemIdForOperation(client, validation.data.operationId)`; for `enforce` return `{ success:false, message: LOCKED_REVISION_MESSAGE }` (this route returns plain objects, not `validationError`); for `warn` append flash to the success `data(...)`.

**Verify**
- [ ] `pnpm --filter erp typecheck`. Manual: company `enforce` + item `revisionStatus='Production'` → BOM/BOP mutation blocked with the message; `warn` → saves + warning toast; `off` → unchanged.

---

### Task 30 — BOM/BOP lock affordance in `BillOfMaterial.tsx`
**Area E.** Reuses the under-ECO loader value where threaded; static fallback otherwise.

**Files (Modify)**
- `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx`
- `apps/erp/app/routes/x+/part+/$itemId.make.$makeMethodId.tsx`, `apps/erp/app/routes/x+/tool+/$itemId.make.$makeMethodId.tsx` (pass the new props)

**Steps**
- [ ] Add `revisionStatus?: string;` + `releaseControl?: "enforce"|"warn"|"off";` to `BillOfMaterialProps`; destructure them.
- [ ] `const isReleaseLocked = revisionStatus === "Production" && releaseControl === "enforce";` fold into `isReadOnly`:
  ```ts
  const isReadOnly = permissions.can("update","parts") === false || makeMethod.status !== "Draft" || isReleaseLocked;
  ```
  (Existing `<LuLock />` + all `isDisabled={isReadOnly}` controls reflect it automatically.)
- [ ] Add ONE small banner above the editor only when `isReleaseLocked` — reuse the same `Alert`/`Banner` component used by the under-ECO banner (Task 12). Text: "This revision is released. Open a change order to change its BOM." Link to the item's open CO if that value is already threaded; otherwise static message (link as a follow-up).
- [ ] In the two `*.make.*` loaders, add `revisionStatus` (narrow `item` select on `makeMethod.data.itemId`) + `releaseControl` (`getCompanySettings`) to the return and pass to `<BillOfMaterial>`.

**Verify**
- [ ] `pnpm --filter erp typecheck`. Manual: a Production-revision part's make method → controls disabled + lock icon + banner when `enforce`; interactive under `warn`/`off`.

---

### Task 31 — Disable edge-fn placeholder-reviewer + groupId approval-task seeding
**Area C.** **GATE: USER must re-serve the `create` edge function for this to take effect.**

**Files (Modify)**
- `packages/database/supabase/functions/create/index.ts` (`changeOrderTasks` case, ~473–510)

**Steps**
- [ ] Remove (or gate off) the `if (hasApprovalRequirements && !hasExistingReviewers) { reviewerInserts.push(...) }` block that inserts the `title:"Engineering"`/`title:"Quality"` placeholder reviewers — reviewers are now seeded per-user in `insertChangeOrder` (Task 15). The `if (reviewerInserts.length > 0)` txn block becomes a safe no-op.
- [ ] Remove the `approvalTaskInserts.push(...)` loop that seeds one approval task per `approvalRequirements` entry — `approvalRequirements` now holds group ids, not "MRB"; reviewers carry the sign-offs. Leave only `actionTaskInserts` (from `requiredActionIds`).
- [ ] This is Deno (not in erp tsc) — no `types.ts` regen. The USER redeploys/re-serves the `create` function locally.

**Verify**
- [ ] Eye / `deno check` if available. Confirm no remaining code seeds `changeOrderReviewer` with placeholder titles.

---

### Task 32 — Acceptance: end-to-end `/test` (full lifecycle) + cache playbook
**All areas.** Requires the USER dev stack (migrations applied, `types.ts` regenerated, `create` edge fn re-served).

**Files:** none (drives the app via `/login` then `/test`).

**Steps**
- [ ] **DB readiness:** confirm `item.productManager` + `group.isApprovalGroup` present; `category`/`plmActivity`/`item.categoryId/cpn/eid`/`companySettings.plmCpn*` absent; `plmReleaseControl` default `enforce`; `get_part_details` returns `productManager`; the `create` edge fn re-served.
- [ ] **Product manager:** create/edit a part, set Product Manager → save → reopen → persisted; clear it → persists as null.
- [ ] **Create ECO from item:** part kebab → "Create Change Order" → create form opens with the part as an affected item.
- [ ] **Approver picker + type:** pick `approvalType` (e.g. Majority), pick a **group + an individual** in Approvers, submit → CO created; Reviewers card lists one reviewer **per resolved user** (group members expanded + the individual, deduped), each `Pending`, `assignee` set, `title` = full name; no "Engineering"/"Quality" placeholders; `changeOrder.approvalRequirements` holds the picked group id(s).
- [ ] **Notifications:** submit for review → reviewers + PM get "needs your review" (check the bell + `notification` rows).
- [ ] **Reason modals + auto-advance:** Approve requires a non-empty reason; reviewer row → `Completed`. Unanimous (2 reviewers): 1 approval stays `In Review`, 2nd → auto `Approved`. Majority (3): 2 → `Approved`. First-In (2): 1 → `Approved`. Reject (any) → CO back to `Draft`, all reviewers `Pending`, reason surfaced. Non-reviewer Approve → flash "You are not a reviewer".
- [ ] **Transition guard:** Release button disabled until `Approved`; a crafted POST `status=Released` on a `Draft` CO flashes the guard error.
- [ ] **Release → revision Production + make method Active:** release the `Approved` CO → pending item `revisionStatus='Production'`, prior `='Obsolete'`; new revision `makeMethod.status='Active'`, prior `='Archived'`; `activeMakeMethods` returns the new row; "was released" notification fires. Banner on the part disappears once the CO leaves the open set.
- [ ] **Controlled drawing visible to purchasing:** attach a PDF controlled drawing on the part revision → shows on part-detail Files AND on a PO line for that item.
- [ ] **Locked-edit enforced:** on the Production-revision item, BOM/BOP mutations are blocked (`enforce`) with "Open a change order…"; the BOM editor shows the lock affordance.
- [ ] **My change-order tasks:** as a reviewer, Items → "My Change Orders" lists the pending sign-off, linking to the CO; completing it removes it on reload.
- [ ] **Missing-drawing warning:** a CO whose pending revision lacks a drawing shows the ValidationBanner **warning** at release AND release still succeeds; adding the drawing clears the warning.
- [ ] Cache the successful playbook to `llm/test-playbooks/`.

**Verify**
- [ ] All scenarios pass with no console errors. Final `pnpm --filter erp typecheck` + `pnpm --filter @carbon/ee typecheck` + `pnpm --filter @carbon/jobs typecheck` green.

---

### Task 33 — Drawing SSOT: manual controlled-drawing upload (route + UI)
**Area F.** No migration (reuses `externalIntegrationMapping`, `integration="onshape"`).

**Files (Create/Modify)**
- Create: `apps/erp/app/routes/api+/item.drawing.ts`
- Modify: `apps/erp/app/utils/path.ts` (add `api.itemDrawing`)
- Modify: `apps/erp/app/modules/items/ui/Item/ItemDocuments.tsx`

**Interfaces:** route accepts multipart `{ itemId, drawingPath, drawingRevisionLabel?, intent:"upload"|"remove" }`; merges `{ drawingPath, drawingRevisionLabel }` into the item's `externalIntegrationMapping` metadata. Part-detail loader + PO-line surface read the SAME metadata → **no loader changes**.

**Steps**
- [ ] `item.drawing.ts` action: `requirePermissions(request, { update: "parts" })`; read `itemId`/`intent`/`drawingPath`/`drawingRevisionLabel`; throw if `itemId` missing. Fetch the existing mapping (`entityType="item", entityId=itemId, integration="onshape", companyId`, `.order(createdAt desc).limit(1).maybeSingle()`).
  - `remove`: merge `metadata = { ...existing.metadata, drawingPath:null, drawingRevisionLabel:null }`, update the row (don't delete — OnShape geometry may coexist); best-effort `storage.from("private").remove([oldDrawingPath])`.
  - `upload`: require `drawingPath`; `metadata = { ...(existing?.metadata ?? {}), drawingPath, drawingRevisionLabel: drawingRevisionLabel || null }`; update if a row exists else insert; best-effort remove a superseded prior `drawingPath` on the same item.
- [ ] `path.ts`: add `itemDrawing: \`${api}/item/drawing\`` next to `modelUpload`.
- [ ] `ItemDocuments.tsx`: add a PDF upload control in the Files card (reuse the `File` dropzone pattern, `accept=".pdf"`, `multiple={false}`), gated on `can("update","parts")`. Client uploads to `private` at `${companyId}/models/${nanoid()}.pdf` (`upsert:true, contentType:"application/pdf"`), then `fetcher.submit({ intent:"upload", itemId, drawingPath }, { method:"post", action: path.to.api.itemDrawing })`, then `revalidate()`. Add a Remove item to the existing `controlledDrawing` row's `DropdownMenu` (gated on `canDelete`) → `fetcher.submit({ intent:"remove", itemId }, …)`. Keep the existing `Hyperlink` preview unchanged.
- [ ] **Decision (resolved):** reuse `integration="onshape"` so both read surfaces light up with no loader edits (OnShape can fill the same slot — spec §7). If a distinct `integration="manual"` is later preferred, the two read loaders widen to `.in("integration", ["onshape","manual"])` (purchasing + part-detail areas).

**Verify**
- [ ] `pnpm --filter erp typecheck`. Manual: upload a PDF → "Controlled Drawing" row appears with a working preview link; Remove clears it; the PO line for that item shows the drawing link.

---

### Task 34 — Warn (not error) on missing controlled drawing at release
**Area F.**

**Files (Modify)**
- `apps/erp/app/modules/items/changeOrder.server.ts` (`getChangeOrderValidations`)

**Steps**
- [ ] Reuse the existing `pendingItemIds` list (affected-items query already selects `pendingItem:item!…(id, readableIdWithRevision, revisionStatus)`). If empty, short-circuit (skip `.in([])`).
- [ ] Query `client.from("externalIntegrationMapping").select("entityId, metadata").eq("entityType","item").eq("integration","onshape").eq("companyId",companyId).in("entityId", pendingItemIds)`; build `hasDrawing = Set` of `entityId`s whose `(metadata as {drawingPath?:string|null}).drawingPath` is truthy.
- [ ] For each affected item with a `pendingItem?.id` NOT in `hasDrawing`, `warnings.push(\`${pending.readableIdWithRevision ?? pending.id} has no controlled drawing\`)`. **Do NOT** push to `errors` — release must proceed (spec §7). The `ValidationBanner` on `$id.tsx` already maps `warnings[]` (no edit needed; confirm it renders them).

**Verify**
- [ ] `pnpm --filter erp typecheck`. Manual: a CO with a drawing-less pending revision → ValidationBanner warning + release still succeeds; add the drawing → warning gone.

---

### Task 35 — `getMyChangeOrderTasks` query + "My Change Orders" list route + nav
**Area F.** `changeOrder.changeOrderId` + `name` columns **confirmed** present.

**Files (Create/Modify)**
- Modify: `apps/erp/app/modules/items/changeOrder.service.ts` (add `getMyChangeOrderTasks`)
- Create: `apps/erp/app/routes/x+/items+/change-order-tasks.tsx`
- Create: `apps/erp/app/modules/items/ui/Item/MyChangeOrderTasks.tsx`
- Modify: `apps/erp/app/modules/items/ui/useItemsSubmodules.tsx`, `apps/erp/app/utils/path.ts`

**Interfaces produced:**
```ts
export async function getMyChangeOrderTasks(client, args:{ userId; companyId }): Promise<{
  data: Array<{ kind:"review"|"approval"; taskId:string; label:string; dueDate:string|null;
    changeOrderId:string; changeOrderReadableId:string|null; changeOrderName:string|null; changeOrderStatus:string|null }>;
  error: { message:string } | null;
}>;
```

**Steps**
- [ ] `getMyChangeOrderTasks`: two parallel queries — `changeOrderReviewer.select("id, title, dueDate, changeOrderId, changeOrder:changeOrderId(changeOrderId, name, status)").eq("assignee", userId).eq("companyId", companyId).eq("status","Pending")` and the same over `changeOrderApprovalTask` (label = `name`). Map both into the unified shape; sort by `dueDate` asc (nulls last) then `changeOrderReadableId`. On any sub-query error → `{ data:null, error }`. Auto-exported via the items barrel.
- [ ] `path.ts`: add `myChangeOrderTasks: \`${x}/items/change-order-tasks\`` in the `parts` block. Row link → `path.to.changeOrder(t.changeOrderId)`.
- [ ] Route loader: `requirePermissions(request, { view: "parts" })` → `getMyChangeOrderTasks(client, { userId, companyId })` → `{ tasks: result.data ?? [] }`.
- [ ] `MyChangeOrderTasks.tsx`: `Card` + `Table` (reuse `@carbon/react` `Table/Thead/Tbody/Tr/Th/Td` exactly as `ItemDocuments.tsx`). Columns: CO (readable id, linked), Type (Review/Approval), Task (`label`), Due (`useDateFormatter`), Status badge. Empty-state row. No extra badges/icons beyond one status.
- [ ] `useItemsSubmodules.tsx`: add to the `Manage` group `{ name: t\`My Change Orders\`, to: path.to.myChangeOrderTasks, icon: <LuClipboardList />, role: "employee" }` (no `table:` key). Import an existing `react-icons/lu` icon.

**Verify**
- [ ] `pnpm --filter erp typecheck`. Manual: as a reviewer/approval-task assignee with `status="Pending"`, Items → "My Change Orders" lists the row + links to the CO; completing the sign-off removes it on reload. (Folds into the Task 32 acceptance sweep.)

---

## Notes for executors
- Tasks 2–8 MUST land in ONE PR (Duro producers + consumers + code-move) or typecheck breaks. Tasks 9–35 build on the moved `modules/items/changeOrder.*` files.
- The OnShape `*.server.ts` / `onshape-import.service.ts` stay in `modules/plm/`; their only changed import is the `plm.service` → `items/changeOrder.service` path (Task 7). Run `pnpm --filter @carbon/ee typecheck` whenever they're touched.
- Migration-gated tasks (1 → 9/12/24/28/29) and the edge-fn-gated task (31) need the USER to apply migrations / regenerate types / re-serve the `create` function; verify those preconditions at the start of Task 32.
- `__plm-import-verify.mts` (untracked, absent on disk) is a stray scratch file — `git clean` it; not part of the work.
