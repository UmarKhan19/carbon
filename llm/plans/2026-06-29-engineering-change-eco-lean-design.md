# Engineering Change (ECO) — Lean, Item-Native — Design Spec

- **Date:** 2026-06-29
- **Status:** Design approved in brainstorm (decisions locked); pending schema-grounding refinement + user spec review.
- **Driver:** Heaviside wants a lightweight PLM whose one feature people actually use is the **ECR/ECO flow** — create → release → peer review → approved, **controlled over revision for BOM/BOP**, while **holding the 2D drawings as the single source of truth for purchasing**. Explicitly **not a Duro clone**; everything beyond the change flow is bloat for us.

## 0. One-paragraph summary

Keep the existing `changeOrder` entity but make it **item-native** (fold it into the items module, no separate "PLM" nav), **activate the dead peer-review→approval path** (approvers + a selectable **Unanimous/Majority/First-In** rule, picked when you create the ECO from the item master), **enforce a release lock** so a released revision's BOM/BOP can only change through an ECO, add a **manual per-revision controlled 2D drawing** that purchasing sees as the single source of truth, and **delete the Duro layer** (categories, CPN, typed attributes, component import). Almost nothing is net-new; it is activation, enforcement, one upload UI, two notifications, a banner, and a deletion.

## 1. Scope

**In:**
- One change-order record covering both phases: `Draft` (the **ECR** — what's changing and why, affected items) → `In Review` → `Approved` → `Released` → `Cancelled`.
- An ECO is **created from the item master**; the item carries a **product manager** (owner). At creation you pick the **approvers** (groups or individuals) and the **approval type**.
- **Selectable approval rule — Unanimous / Majority / First-In** (reuses `changeOrder.approvalType`): the ECO auto-advances to `Approved` when the chosen threshold is met; any reject → back to `Draft`.
- **Approve/Reject in the ECO header**, each opening a **reason modal**; the decision + reason is recorded.
- **Notifications** to the reviewers + product manager on **review-requested** (submit) and on **accepted** (Approved).
- Pending sign-offs surface as **tasks** for the assignee in the Items area.
- **Revision control = enforce:** a Released revision's BOM/BOP is locked from in-place edits; changes flow through an ECO that spins up a new pending revision.
- **2D drawing SSOT:** a manual, per-revision controlled drawing (PDF), visible to purchasing on the item detail + PO line.
- **Item-under-ECO banner** at the top of the item detail page.

**Cut (Duro bloat):** categories, CPN generation, typed category attributes, component CSV import — code, UI, routes, tables, and the `item.categoryId/cpn/eid` columns.

**Parked (optional, not in the core path):** the OnShape integration stays on the branch as an optional source that can populate the controlled-drawing slot when a company is connected. The ECO feature works fully without it.

## 2. Placement & architecture

- The `changeOrder` entity stays **first-class** (its own table, status lifecycle, reviewers, tasks, redline) but moves from `modules/plm/` into the **items module** (`modules/items/`, with a `changeOrder`/`engineeringChange` sub-namespace). Routes move out of `x+/change-order+` / `x+/plm+` and into the **Items area**; the change order is surfaced under Items, not a top-level "PLM" section.
- **Delete** the Duro Phase-2 surface: `category.*`, `components-import.*`, the `Category` UI, routes `x+/category+`, `x+/plm+/categories`, `x+/plm+/components-import`, `api+/plm.categories`, and the `ComponentsImportModal`.
- **Schema cleanup:** the Phase-2 migration (`20260622100000_plm-phase2.sql`) is **uncommitted**, so revise it in place to remove `category`, `categoryAttribute`, the CPN settings, and the `item.categoryId/cpn/eid` columns (or add a focused drop migration if a local DB already has it applied). Keep `methodMaterial.referenceDesignators/itemNumber` (useful, not Duro-specific). `plmActivity` — drop unless reused as the ECO audit log (the `changeOrder` already carries its own audit columns; default: **drop**).

## 3. The ECO record & lifecycle (one record, two phases)

- **Entity:** reuse `changeOrder` + `changeOrderItem` (affected items, each with a `pendingItemId`).
- **Product manager (on the item):** the item master carries a `productManager` (owner — one person), shown on the item and **notified** when their product is under change. (New nullable `item.productManager` FK to user — small migration.)
- **Entry point:** an ECO is created **from the item master** — a "Create change order" action on the item detail seeds that item as the affected item and opens the create form, where you pick the approvers + approval type (§4).
- **Phases via status:** `Draft` is the request (ECR) — name, type, priority, description (what/why), affected items, assignee. `In Review → Approved → Released` is the controlled change (ECO). `Cancelled` from any non-terminal.
- **Transition guard (hardening — missing today):** enforce allowed transitions **server-side** in the status action (`Draft→In Review→Approved→Released`, `→Cancelled`, `Reject:→Draft`), not just by disabling buttons client-side.

## 4. Peer review & approval

- **Approvers (picked at ECO creation):** when you create an ECO from the item master, you choose its approvers — a mix of **reusable groups and individual people** (reuse `group`/`membership`; selecting a group resolves to its members via the existing **`users_for_groups()`** RPC). Each resolved person becomes a `changeOrderReviewer`. Reusable "approver groups" are just existing `group`s, optionally flagged `isApprovalGroup` so the picker can filter to them. **No new groups table.**
- **Approval type (selectable per ECO):** `Unanimous` (all must approve) / `Majority` (>50%) / `First-In` (first decision wins) — **reuse the existing `changeOrder.approvalType` enum, which already has exactly these three.** Chosen on the create form (default `Unanimous`).
- **Approve/Reject UI:** buttons in `ChangeOrderHeader`. **Approve** opens a modal for a **reason** → records that reviewer's sign-off (`changeOrderReviewer.status = Completed` + reason). **Reject** opens a reason modal → ECO returns to `Draft` and decisions reset.
- **Auto-advance (hardening — the core gap):** on each decision, evaluate the chosen `approvalType`'s threshold (all / majority / first-in); when met, the ECO auto-advances to `Approved` server-side. (`approvalType` is currently dead config — this activates all three modes.) The optional `changeOrderWorkflow` template can pre-fill default approvers + type, but is not required.
- **Tasks:** each reviewer's pending sign-off is a `changeOrderReviewer` row (with `assignee`, indexed on `assignee`+`status`). Surface the assignee's open ECO sign-offs as a **task list in the Items area** — a lightweight "my change-order tasks" list sourced from `changeOrderReviewer`/`changeOrderApprovalTask` where `assignee = me` and `status = Pending`. The topbar in-app notification (§5) is the alert; this list is the actionable work surface. *(No existing cross-cutting "my tasks" inbox was found, so this Items-area list is the one small new surface — see §11.)*

## 5. Notifications

- **Mechanism:** reuse the existing **Inngest `notify`** pipeline (`packages/jobs/src/inngest/functions/notifications/notify.ts`) — `trigger("notify", { event, recipient: { type: "groups", groupIds }, documentId: changeOrderId, companyId })` fans out to in-app (`notification` table → topbar bell), plus email/Slack via EE integrations. **Only new bit:** add `NotificationEvent` values `ChangeOrderSubmittedForReview` and `ChangeOrderApproved` (plus `ChangeOrderRejected`/`ChangeOrderReleased` while we're there) in `packages/notifications`. The `recipient: {type:"groups"}` path already resolves group members.
- **Triggers** (recipient = the ECO's selected reviewers + the affected item's product manager):
  1. **Review requested** — on `Draft → In Review`, notify every reviewer + the product manager ("ECO-#### needs your review").
  2. **Accepted** — on `→ Approved`, notify every reviewer + the product manager ("ECO-#### was accepted").

## 6. Revision control — enforce

- **Lock:** a released revision's BOM (`methodMaterial`) and BOP (`methodOperation`) cannot be edited in place. "Released" = `item.revisionStatus === 'Production'` (the enum is `Design/Prototype/Production/Obsolete`; there is **no** `Released` value — the released-and-active state is `Production`). The mutation lock points are the method routes — `x+/items+/methods+/material.new.tsx`, `material.$id.tsx`, `operation.new.tsx`, `operation.step.$id.tsx` — plus the `BillOfMaterial.tsx` editor for the UI affordance. Each route action gates: if `item.revisionStatus === 'Production'` and `companySettings.plmReleaseControl === 'enforce'` → reject with a validation error prompting "open a change order"; `warn` flashes a toast but allows; `off` no-op. The pending revision the ECO creates is `Design`/`Prototype` (not `Production`), so it stays editable. `plmReleaseControl` currently defaults `'off'` — flip the default to `'enforce'` in the (uncommitted) `20260621143000` migration per the decision, and expose it in company settings.
- **Change path:** open an ECO → `createPendingRevision` (new pending revision, BOM/BOP deep-copied) → edit the **pending** revision → recursive **redline** (current Production vs pending) → unanimous review → approve → release.
- **On Release:** `releaseChangeOrder` promotes the pending revision to `Production`, obsoletes the prior, and **marks the new make method `Active` + archives the old** (hardening — release currently never flips `makeMethod.status`).

## 7. 2D drawing as purchasing SSOT (manual)

- **Attach:** a manual upload UI on the item/revision attaches the controlled 2D drawing (PDF) using the **per-revision `modelUpload`** (already per-revision) under the `private` bucket.
- **SSOT for purchasing:** the **released** revision's drawing is authoritative and visible to purchasing on the **item detail** and the **PO line**, via the auth-gated, tenant-scoped preview surface built in the OnShape increment (reuse it).
- **Supersede:** a new released revision's drawing supersedes; the prior is retained for history (per-revision attachment).
- **Validation:** missing controlled drawing at release → a **warning** in the existing ECO validation banner; **release still proceeds**.
- **OnShape (optional):** if connected, can fill the same drawing slot; never required.

## 8. Item-under-ECO indicator

- In the part detail loader (`x+/part+/$itemId.tsx`), call `getOpenChangeOrderForItem({ itemId, companyId })` (exists, `plm.service.ts:541`; matches an item to a CO in status `Draft`/`In Review`/`Approved`). If it returns an open CO, fetch its status via `getChangeOrder` and render a **warning banner above `PartHeader`** (`modules/items/ui/Parts/PartHeader.tsx`): "This item is under change order **ECO-####** (status)", linking to the ECO.

## 9. Reuse vs build

- **Reuse:** `changeOrder`/`changeOrderItem`, the `changeOrder.approvalType` enum (Unanimous/Majority/First-In), the recursive BOM/BOP redline, `releaseChangeOrder`, `createPendingRevision`, `getOpenChangeOrderForItem`, per-revision `modelUpload`, the part/PO drawing preview surface, `changeOrderReviewer`/`changeOrderApprovalTask`, the optional `changeOrderWorkflow` template, the `group`/`membership` tables + `users_for_groups()` RPC, the Inngest `notify` pipeline + `notification` table, and the `plmReleaseControl` setting.
- **Build / harden:** a `Create change order` action on the item master; a new `item.productManager` field; the approver picker (groups + people) + **selectable approval type** seeding `changeOrderReviewer`s via `users_for_groups()`; **all-three-mode auto-advance** (Unanimous/Majority/First-In) + Approve/Reject reason modals; the two `ChangeOrder*` notification events + triggers (reviewers + product manager); the enforce-lock consumer on the method routes/editor; the manual drawing-upload UI on the revision; the Items-area "my change-order tasks" list; the item-under-ECO banner; the server-side transition guard; release-marks-method-Active; the code move into Items; and the Duro deletion.

## 10. Out of scope / deferred

Sequential/staged review; majority or first-in approval; OnShape in the core path (parked); release-package dedupe; where-used cascade; component import; categories / CPN / typed attributes; a separate drawing-revision lifecycle.

## 11. Resolved / migrations

**All decisions resolved:** approvers + approval type are **picked when creating the ECO from the item master** (Duro-style — approvers on the CO, not locked on the item); approval type is **selectable** (Unanimous/Majority/First-In, reusing `changeOrder.approvalType`); approvers are groups + people (reuse `group`/`membership` + `users_for_groups()`); the item carries a **product manager**; tasks → a dedicated Items-area "my change-order tasks" list; notifications → Inngest `notify` + new `ChangeOrder*` events to reviewers + product manager; item banner → `PartHeader` + `getOpenChangeOrderForItem`; lock points → the `material.*`/`operation.*` method routes + `BillOfMaterial.tsx`, gated on `revisionStatus === 'Production'`.

**Migrations needed (all small; user applies):** `item.productManager` FK (nullable); `isApprovalGroup` flag on `group`; flip `plmReleaseControl` default to `'enforce'`; drop the Duro tables/columns (`category`, `categoryAttribute`, `item.categoryId/cpn/eid`). All small; the user applies them.
