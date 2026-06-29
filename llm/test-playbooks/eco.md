# ECO (Engineering Change) — Manual /test Playbook

Lean, item-native Engineering Change feature. Run after the deploy steps below. Drive via `/login` + browser, or by hand.

## 0. Prerequisites (deploy steps — required)
1. **`db reset` + `pnpm db:types`** — applies the revised migrations: `item.revisionStatus` default now **`Design`** (was `Production`), `companySettings.plmReleaseControl` default **`enforce`**, `item.productManager`, `group.isApprovalGroup`. (If `db:types` TLS-times-out: append `?sslmode=disable` per the saved note.)
2. **Re-serve the `create` edge function** — so it no longer double-seeds placeholder reviewers (app-side seeding is now the single source of truth).
3. Bring up the dev stack (Supabase + ERP). Sanity: a **newly created part is editable** (its BOM/BOP can be edited) — confirms the `Design` default landed.

## 1. Product manager on the item
- Create a Part; set **Product Manager** (Employee picker). Save → reopen → PM persists.
- On an existing part, **Properties → Product Manager**: change it; it persists (posts to `bulkUpdateItems`).

## 2. Create ECO from the item
- On a Part, header menu → **Create Change Order** → lands on the new-CO form with the part pre-seeded as the affected item.
- Pick **approvers** — one **group** + one **individual** (the `Users verbose` picker). Pick **approval type = Unanimous**. Set name/type=Engineering. Create.
- Open the part → a **warning banner** shows "This item is under change order ECO-#### (Draft)" linking to the CO.
- On the CO: a **pending revision** exists for the affected item (redline renders) — *this is the create-path fix; without it release is impossible*.

## 3. Submit + notify + tasks
- **Submit for review** (Draft→In Review). Reviewers were seeded = the group's members (resolved via `users_for_groups`) ∪ the individual, deduped.
- Each reviewer + the product manager gets a notification (topbar bell shows a real, linkable row; the "View" link resolves to the CO).
- As a reviewer, **Items → My Change Orders** lists this pending sign-off, linking to the CO.

## 4. Approve via reason modal → auto-advance
- As reviewer 1: header **Approve** → reason modal → submit. CO stays **In Review** (Unanimous, not all done).
- As reviewer 2 (last): **Approve** + reason → CO **auto-advances to Approved**; Approved notification fires.
- Verify the reason shows on the reviewer task row.

## 5. Release
- **Release** the CO. Verify: the pending revision → **Production**, the prior revision → **Obsolete**, the new **makeMethod = Active** (prior Archived). Released notification fires.

## 6. Enforce-lock (released = locked)
- On the now-Production revision, open **Bill of Material / Bill of Process** → editing is **disabled** with a "released — open a change order" notice.
- Try a direct edit anyway (or any of: add/edit/delete material, operation, step, tool, parameter, reorder, get/save-method, version-activate) → **server rejects** ("open a change order"). *(21 mutation paths gated.)*
- A **Design/Prototype** pending revision (the one an ECO creates) stays **editable**.
- Set `plmReleaseControl = warn` → editing allowed, informational banner only (not a hard lock).

## 7. Controlled drawing (purchasing SSOT)
- On an item revision, **upload a controlled drawing (PDF)** (ItemDocuments). It previews via the auth-gated route.
- On a **Purchase Order line** for that item: the **Controlled Drawing** link shows — both when re-picking the item AND on an **already-saved** line (mount-time fetch).
- Release a CO whose revision has **no** drawing → release **warns** (not blocks) "has no controlled drawing".

## 8. Edge cases (the hardening)
- **Zero approvers:** create a CO, pick no approvers, try to submit → **blocked** ("add at least one approver").
- **Skipped reviewer:** with 2 reviewers, one **Skip** + one **Approve** → CO **advances** (Skipped = recusal, denominator shrinks). All-Skipped → does not advance.
- **Reject:** any reviewer **Reject** + reason → CO back to **Draft**, all decisions reset (no stale reason).
- **Affected-item edit lock:** once In Review/Approved, you **cannot** add/remove affected items (only in Draft).
- **One open CO per item:** try to create a 2nd open CO for the same item → blocked.

## 9. Security spot-checks (optional)
- Another company's CO id in the URL → **not loadable** (companyId-scoped `getChangeOrder`).
- A non-reviewer completing someone's reviewer row via the task route → **rejected** (assignee check).

## Pass criteria
Create-from-item → pending revision → submit (notified) → reason-modal approve → auto-advance → release (Production + Active method) → drawing visible to purchasing → released BOM/BOP locked, with the zero-reviewer / Skipped / reject / lock edge cases behaving as above.
