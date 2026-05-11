# Picking List Feature — Video Demo Script

A turn-by-turn walkthrough covering every scenario shipped across P0–P3.
Each section has the setup, the click path, the on-screen state to point
at, and the narration to deliver. Read top-to-bottom and you have a
~25-minute demo.

> **Reference**: Implementation lives in `packages/database/supabase/functions/pick/index.ts`,
> migrations `20260505000000…20260507000009`, ERP routes under
> `apps/erp/app/routes/x+/picking-list+/`, MES routes under
> `apps/mes/app/routes/x+/picking-list*.tsx`, and components under
> `apps/erp/app/modules/inventory/ui/PickingLists/`.

---

## 0. One-Time Demo Prep

Do this **before** you hit record. None of it should be on camera.

### Data you need
- **Company** with `companySettings.usePickingLists = true` (default).
- **Location** "MAIN".
- **Item A — `BOLT-M8`** (untracked, UoM = EA), starting stock:
  - Shelf `A-01` → 500 EA
  - Shelf `A-02` → 200 EA
- **Item B — `STEEL-PLATE-10MM`** (batch-tracked), three lots:
  - Batch `B-001` (50 EA, Shelf `B-01`, oldest createdAt)
  - Batch `B-002` (30 EA, Shelf `B-01`)
  - Batch `B-003` (40 EA, Shelf `B-02`)
- **Item C — `ADHESIVE-X`** (untracked), only **10 EA** across the whole
  location — used for the shortage scenario.
- **Item D — `GENERIC-WASHER`** (untracked), **no** `pickMethod` and the
  jobMaterial will have **no `storageUnitId`** — used for the no-shelf
  case.
- **Item E — `LINE-SIDE-CAP`** (untracked), `methodMaterial.requiresPicking
  = false` — used to demonstrate the opt-out.
- A **work centre** "Assembly-01" with `defaultStorageUnitId` =
  `LINE-A` (line-side shelf).
- A **BoM / method** "Widget-100" that uses all five items, attached to
  the Assembly-01 work centre.
- A planner user, an operator user (for MES), and an approver user.

### Browser tabs to pre-open
1. ERP — `/x/inventory/picking-lists`
2. ERP — `/x/job/<JOB_ID>` (the job you'll release on camera)
3. ERP — `/x/inventory/movements`
4. MES — `/x/picking-lists`

---

## 1. The Pitch (60 seconds)

> "Today I'm walking you through Picking Lists — the workflow that sits
> between job planning and material consumption. It tells an operator
> *what* to pick, *where* to pick it from, and *where* it's going. Once
> they confirm, we post the consumption ledger entry against the job —
> not the picking list, because the picking list is a workflow artifact,
> not an accounting one.
>
> I'll show you four things in order: how a PL gets generated, the four
> different shelf scenarios the generator handles, how an operator picks
> on the MES, and then three follow-on features — staging, the
> factory-wide movements feed, and incident reporting."

---

## 2. Settings & Opt-In — the Three Levels (2 min)

The whole system is gradient-adoption. Show this **before** you generate
anything, so the audience understands the dials.

### 2.1 Company-level switch

**Where**: ERP → Settings → Company → Inventory.

**Show**: `Use Picking Lists` toggle + `Default Auto-Generate Picking
List` toggle.

**Say**:
> "Level one — company switch. If a customer doesn't want picking lists
> at all, flip this off and Carbon behaves exactly like before. We're
> leaving it on."

### 2.2 Material-level flag

**Where**: ERP → Items → `LINE-SIDE-CAP` → Methods → open the BoM step
for the cap.

**Show**: `Requires Picking` toggle on the methodMaterial row.

**Say**:
> "Level two — per-material. A cap that's permanently stocked at the
> assembly bench shouldn't be picked. Toggle off here and it'll never
> appear on a picking list. Operators issue it the old way through the
> MES material modal."

### 2.3 Job-level toggle

**Where**: ERP → Job → Properties panel.

**Show**: `Auto-Generate Picking List` toggle.

**Say**:
> "Level three — per job. If a planner wants to hand-craft the PL on a
> specific job, they untick this and the trigger leaves the job alone.
> Default is on, inherited from company settings at job creation."

---

## 3. Generation Triggers (2 min)

### 3.1 Auto-generation on status change

**Where**: ERP → Job `J-1001` (status = Draft).

**Steps**:
1. Note `job.pickingStatus` = "Not Required" on the job header.
2. Click **Release** (or change status to Planned).
3. Page reloads — pickingStatus is now **"Generated"** and a new
   `PL-00001` link appears under the Picking Lists tab.

**Say**:
> "The job goes from Draft to Planned. The
> `trigger_auto_generate_picking_list` SQL trigger fires, checks the
> company switch, the per-job toggle, and that the job has at least one
> qualifying `jobMaterial` — Pull from Inventory, quantity > 0,
> requiresPicking = true. Then it calls the same edge function the
> manual button calls. The picking list is born in Draft."

### 3.2 Manual generation

**Where**: Reset by creating a second job `J-1002` with
`autoGeneratePickingList = false`. Release it.

**Steps**:
1. Show `pickingStatus` stays "Not Generated".
2. Open the job, click **Generate Picking List** in the header menu.
3. PL is created.

**Say**:
> "If auto-gen is off, the planner gets an explicit button. Same edge
> function, same RPC, identical result. The trigger and the button are
> two doorways into the same room."

### 3.3 Idempotency

**Steps**:
1. Toggle the job back to Draft, then to Released again.
2. Show that a **second** PL is **not** created.

**Say**:
> "The trigger guards on `pickingStatus = 'Not Generated'`, so you can
> flip the job status back and forth without spawning duplicate PLs."

---

## 4. The Four Shelf Scenarios — Core of the Demo (5 min)

This is the heart of the video. The RPC
`generate_picking_list_lines` (see
`packages/database/supabase/migrations/20260507000000_picking-lists-multi-shelf-rpc.sql`)
walks shelves at the job's location, preferred shelf first, then by
available qty DESC. The behaviour fans out into four distinct cases.

> **Tip**: have all four cases on a single PL so the audience sees them
> side-by-side in one screen. Build job `J-DEMO` with one line of each.

### 4.1 Scenario A — Single shelf, enough stock

**Material**: `BOLT-M8`, need 100 EA. `pickMethod.defaultStorageUnitId =
A-01` which has 500 on hand.

**Show**: One picking list line.
```
Item: BOLT-M8 | Shelf: A-01 | Estimated: 100 | Outstanding: 100
```

**Say**:
> "Simplest case. The item has a preferred shelf via its pick method,
> the shelf has enough stock, the RPC creates one line and moves on. The
> operator goes to A-01, grabs 100, done."

### 4.2 Scenario B — Multi-shelf cascade (this is the cool one)

**Material**: `BOLT-M8` again but **need 600 EA**. A-01 has 500, A-02
has 200. The RPC walks A-01 first (preferred), takes 500, then walks the
next-best shelf A-02 for the remaining 100.

**Show**: **Two** picking list lines for the same jobMaterial.
```
Line 1: BOLT-M8 | Shelf: A-01 | Estimated: 500 | Outstanding: 500
Line 2: BOLT-M8 | Shelf: A-02 | Estimated: 100 | Outstanding: 100
```

**Say**:
> "Here's where most ERPs fall over. The job needs 600 bolts but no
> single shelf has 600. Instead of throwing a fake shortage warning, the
> RPC cascades. Preferred shelf A-01 contributes 500 — that's its full
> available balance — then it walks to the next shelf by available
> quantity descending, A-02, and takes the last 100. You get two real
> lines the operator can actually action. No phantom shortage."

**Optional aside**:
> "Note the soft-allocation field underneath — if a *different* PL is
> already reserving stock from A-01, the available number drops
> accordingly. We're not hard-reserving, but we surface it."

### 4.3 Scenario C — Shortage (aggregate stock < demand)

**Material**: `ADHESIVE-X`, need 50 EA. Total at the location is 10 EA on
shelf `C-01`.

**Show**: **Two** lines — one real allocation line and one **shortage
line** marked with a warning badge.
```
Line 1: ADHESIVE-X | Shelf: C-01 | Estimated: 10 | Outstanding: 10
Line 2: ADHESIVE-X | Shelf: C-01 | Estimated: 40 | Outstanding: 40 ⚠ shortage
```

**Say**:
> "If after walking every shelf the demand still isn't covered, the RPC
> appends one final shortage line on the preferred shelf with the
> remaining quantity. That way the operator sees `Outstanding = 40` on
> the picking list itself, not buried in a modal somewhere. The
> shortage is **non-blocking** — they can still confirm — but they'll
> be forced to give a reason, and confirming with outstanding requires
> the approver permission."

### 4.4 Scenario D — No storage unit specified

**Material**: `GENERIC-WASHER`, no `pickMethod`, jobMaterial has no
`storageUnitId`. There's stock at two random shelves: `W-FAR` (80) and
`W-NEAR` (40). Need 100.

**Show**: Two lines, walked purely by available-qty DESC.
```
Line 1: GENERIC-WASHER | Shelf: W-FAR  | Estimated: 80 | Outstanding: 80
Line 2: GENERIC-WASHER | Shelf: W-NEAR | Estimated: 20 | Outstanding: 20
```

**Say**:
> "Sometimes a material doesn't have a preferred shelf — no pick method,
> no shelf on the jobMaterial. The RPC doesn't refuse. It just orders
> every shelf with stock by available quantity descending and walks them
> top-down. The operator still gets a real, actionable list."

### 4.5 Tracked item bonus — Scenario B repeated with batches

**Material**: `STEEL-PLATE-10MM`, batch-tracked, need 100 EA. Batches:
50 at B-01, 30 at B-01, 40 at B-02.

**Show**: **Two** lines — note these are by *shelf*, not by batch. The
batch decision happens at scan time.
```
Line 1: STEEL-PLATE-10MM | Shelf: B-01 | Estimated: 80 | Outstanding: 80
Line 2: STEEL-PLATE-10MM | Shelf: B-02 | Estimated: 20 | Outstanding: 20
```

**Say**:
> "Important nuance: the generator doesn't name specific batches. It
> tells the operator 'go to B-01 and pick 80 plates' — it's up to
> physical shelf rotation and the operator's scan to determine which
> batch gets consumed. The system records whatever they scan."

---

## 5. Picking — ERP Detail View (3 min)

Open `PL-00001` for job `J-DEMO`.

### 5.1 The 3-panel layout

**Show**: Explorer (left), detail content (middle), Properties (right
sidebar with donut chart and metadata).

**Say**:
> "Sales-order-style layout — left explorer for navigating between PLs,
> the main canvas for lines, and the properties rail on the right with
> the status donut, job link, customer, location, assignee, due date.
> Both side panels are resizable, both collapse."

### 5.2 Release the PL

**Steps**: Click **Release** in the header.

**Say**:
> "Status moves from Draft to Released. Now it appears on the operator's
> MES queue and the soft-allocation calculation starts counting these
> outstanding quantities."

### 5.3 Pick a non-tracked line

**Steps**:
1. Click `BOLT-M8` line.
2. The detail card opens. Enter **100** in the picked-quantity field.
3. Submit.

**Show**: `pickedQuantity = 100`, `outstandingQuantity = 0`. Status of
the PL flips to **In Progress** on the first pick.

**Say**:
> "Non-tracked items use a quantity form — no scanning needed."

### 5.4 Pick a tracked line — scan modal

**Steps**:
1. Click the `STEEL-PLATE-10MM` line (`B-01`, est 80).
2. The scan modal opens — dual tab: QR scan + manual list.
3. Pick batch `B-001` from the list (50 EA).
4. Submit.

**Show**: Validation runs (item match, status Available, shelf match,
UoM match). The line **auto-splits**:
- Original line closes with `pickedQuantity = 50`, `adjustedQuantity =
  50` so outstanding goes to 0.
- A **sibling line** appears at the same shelf with `estimated = 30`
  for the remainder.

**Say**:
> "The scanned batch is smaller than the line needs, so we don't reject —
> we auto-split. The current line gets adjusted to what was actually
> picked, and a new sibling line takes the leftover demand. The operator
> just scans the next batch into the new line."

### 5.5 Continue the split

**Steps**: Scan `B-002` (30 EA) into the sibling line. Outstanding hits 0.

### 5.6 Over-pick hard block

**Steps**:
1. Open the second `BOLT-M8` line (estimated 100 from Scenario B's A-02).
2. Try to enter **250** (more than 2× the 100 estimate).
3. Submit.

**Show**: Error banner from the edge function — "exceeds 2× tolerance".

**Say**:
> "Hard ceiling at 2× the estimate. There's no soft tolerance tier in
> MVP — if the operator needs to over-pick that aggressively, they go
> back to the planner."

### 5.7 Unpick

**Steps**:
1. Same line — click **Unpick** action.
2. `pickedQuantity` resets to 0.

**Say**:
> "While the PL is In Progress, any line can be unpicked. No ledger has
> posted yet, so there's nothing to roll back — it's just clearing the
> picked field."

### 5.8 Regenerate — blocked

**Steps**: Click **Regenerate** in the header.

**Show**: Confirmation dialog warns that picked lines exist. After
attempting, the edge function returns an error.

**Say**:
> "Regenerate is allowed on Draft and Released, and on In Progress only
> if nothing has been picked. Otherwise the operator has to either
> finish, cancel, or unpick everything first."

---

## 6. Confirmation & Ledger (2 min)

### 6.1 Confirm with everything picked

**Steps**:
1. Pick the remaining lines so all `outstandingQuantity` = 0.
2. Click **Confirm** in the header.
3. The confirm modal opens — no shortage reason needed.
4. Submit.

**Show**: Status → **Confirmed**. PL is locked.

**Say**:
> "Confirmation is the only place we touch the ledger. For each picked
> line we post an `itemLedger` Consumption entry with `documentType =
> 'Job Consumption'`, `documentId = jobId` — not the PL id, because the
> PL is workflow, not accounting. `jobMaterial.quantityIssued` increases.
> Tracked entities flip to `Consumed`. Job's `pickingStatus` becomes
> `Complete`."

### 6.2 Verify the ledger

**Steps**:
1. Open the job → Ledger tab.
2. Show the new Consumption rows.

### 6.3 Confirm with outstanding — shortage path

For this you need a **second** PL where you intentionally pick less than
the estimate.

**Steps**:
1. Open `PL-00002`, pick 80 of 100 BOLT-M8.
2. Click **Confirm**.
3. Modal demands a **shortage reason**. Enter one.
4. Submit.

**Show**: Status → Confirmed. `job.pickingStatus` for this job goes to
**Partial** (some materials still have outstanding demand). If a
third PL is generated for the remainder and confirmed, the status will
become **Complete**.

**Say**:
> "Two side-effects worth pointing out. First, the shortage reason is
> mandatory — we capture *why* before we let them close. Second, this
> action requires the approver permission, not just inventory_update.
> Permissions matter because confirming with outstanding has accounting
> consequences."

### 6.4 Reverse a Confirmed PL

**Steps**:
1. On the just-confirmed PL, click **Reverse** in the header.

**Show**:
- Inverse ledger entries posted ("Positive Adjmt." / "Job Reversal").
- `jobMaterial.quantityIssued` decremented.
- Tracked entities go back to `Available` (only if still Consumed and
  untouched).
- PL status moves to **Cancelled**.

**Say**:
> "Full PL reversal — we don't expose line-level un-consume in MVP.
> It's all-or-nothing. The reverse posts positive adjustments against
> the same job, restores tracked entity status if it hasn't been touched
> since, and the PL itself is marked Cancelled so it never reopens."

### 6.5 PDF print

**Steps**: Click **Print** → opens `/x/picking-list/<id>/pdf`.

**Show**: A printable layout sorted by storage unit hierarchy (walking
order), checkboxes per line, tracked entity slots, signature block at
the bottom.

**Say**:
> "When operators want paper, we sort by shelf hierarchy so the walk is
> efficient. Checkbox per line, batch IDs printed if tracked."

---

## 7. MES Operator Flow (2.5 min)

Switch to the MES tab.

### 7.1 Assigned picks list

**Where**: MES → `/x/picking-lists`.

**Show**: Big cards listing PLs assigned to this operator, with item
counts and the location.

**Say**:
> "Operator's home screen. Scan-first design, big tap targets, the
> Carbon orange dashboard pattern. The badge in the top nav counts
> unfinished picks."

### 7.2 Pick screen

**Steps**: Tap a card → `picking-list.$id.tsx`.

**Show**: Lines listed as big buttons. Each shows item, shelf, quantity.

### 7.3 Inline scan modal (mirrors stock transfer UX)

**Steps**:
1. Tap a tracked line.
2. Scan or pick a batch from the list.
3. Validation runs.

**Say**:
> "This is the exact scan UX we use for stock transfers — operators only
> have to learn it once. Camera scan, manual fallback, instant
> validation feedback. Auto-submits on a successful scan."

### 7.4 Confirm from MES

**Steps**:
1. Once everything is picked, tap **Confirm**.
2. Summary screen with shortage prompt if outstanding > 0.
3. Submit.

**Say**:
> "Same confirmation backend as ERP — the MES is just a different lens
> on the same edge function."

---

## 8. Dashboards & Filters (1 min)

### 8.1 ERP supervisor dashboard

**Where**: `/x/inventory/picking-lists`.

**Show**: Saved views ("My Picks Today", "Awaiting Release", "Shortage
Risk", "Ready to Confirm"), filters by status / location / assignee /
due date, quick-action chips on rows.

**Say**:
> "Supervisor's airport-departures board for picking activity. Saved
> views cover the common operational questions, and the filters scale
> from a single-line warehouse to a multi-site customer."

### 8.2 Job tab

**Where**: Job page → Picking Lists tab.

**Show**: All PLs ever generated for this job, with status badges and
links.

---

## 9. P1 — Staging & Stock Transfers (2 min)

### 9.1 Master data

**Where**: Method (`Widget-100`) → makeMethod → **Finish-to Storage
Unit** field. Set it to a finished-goods shelf.

**Say**:
> "The 'finish to' shelf says where completed product lands. It
> propagates to `job.finishToStorageUnitId` when the job is created."

### 9.2 Staging assessment

**Where**: Job → **Staging** tab.

**Show**: A table per material with columns:
- At pick location (qty on the preferred shelf)
- Elsewhere (qty on other shelves in the same location)
- Shortage (estimated minus at-pick-location, floored at 0)
- Suggested source shelf (highest-qty alternative)

**Say**:
> "Before we even release the job we can preview what staging moves are
> needed. The assessment RPC computes, per material, what's already
> in position vs what's sitting elsewhere in the same location."

### 9.3 Generate transfers

**Steps**:
1. Tick the materials with non-zero shortage.
2. Click **Generate Stock Transfers**.

**Show**: One or more `stockTransfer` records created with lines
`fromStorageUnitId = sourceShelf`, `toStorageUnitId =
jobMaterial.storageUnitId`. The transfer is in Released status, ready
for the warehouse to move.

**Say**:
> "These are the same stock transfers we already had — we're just
> auto-creating them from the shortage assessment. Once the operator
> executes the transfers, the picking list at job-release time will find
> everything at the preferred shelf and no shortage line gets appended."

### 9.4 Round trip

**Steps**:
1. Execute one of the transfers (move stock).
2. Back on the job, click **Generate Picking List**.
3. Show the PL now allocates from the preferred shelf only.

---

## 10. P2 — Movements Feed (1.5 min)

### 10.1 The feed

**Where**: `/x/inventory/movements`.

**Show**: A flat list of every line currently in motion across the
factory:
- Active `stockTransferLine` rows (Released/In Progress, outstanding > 0)
- Active `pickingListLine` rows with `destinationStorageUnitId IS NOT
  NULL` (line-side staging)
- Active `shipmentLine` rows (outbound to customer)

Columns: Part / Qty / From shelf / To shelf / Category chips / Type /
Ref.

**Say**:
> "The factory-wide airport-departures board. Pure UNION query over
> three existing tables — no new schema. Every internal move (shelf to
> line-side, shelf to quarantine, shelf to scrap), every customer
> shipment, every stock transfer shows up here."

### 10.2 Destination category chips

**Show**: A few rows with chips like **Quarantine**, **Scrap**,
**Vehicle**, **Customer**.

**Say**:
> "Category chips are computed live from `storageUnit.storageTypeIds`.
> If a shelf is tagged as 'Quarantine' in master data, transfers going
> there light up with a Quarantine chip — no separate quarantine
> document type needed. The Customer chip is hardcoded on the shipment
> arm."

### 10.3 Filters

**Steps**: Filter by Type = Picking List. Filter by Destination Category
= Quarantine. Filter by Location.

**Say**:
> "Type, destination category, location, source/destination shelf,
> assignee — supervisors slice this however they want."

### 10.4 Drop-off

**Steps**: Confirm one of the PLs in another tab. Refresh Movements.

**Show**: The lines from that PL are gone.

**Say**:
> "Documents drop off the feed the moment they hit Confirmed or
> Cancelled. No archival logic — the filter is just `status IN
> ('Released', 'In Progress') AND outstanding > 0`."

---

## 11. P3 — Production Incidents (2 min)

### 11.1 Default types

**Where**: ERP → Settings → Production → Incident Types (or wherever
the type management lives in your build).

**Show**: Seven seeded types per company — Equipment Failure, Crop
Disease, Environmental Damage, Quality Rejection, Pest Damage,
Contamination, Other.

**Say**:
> "Each company gets seven default types when the first employee is
> linked. Companies can add their own — they're tenant-scoped."

### 11.2 Record a blocking incident

**Pre-state**: Job has an active PL with a line for `STEEL-PLATE-10MM`,
`estimatedQuantity = 100`, currently `pickedQuantity = 0`.

**Steps**:
1. Job → **Incidents** tab → **New Incident**.
2. Fill in:
   - Type = Quality Rejection
   - Item = `STEEL-PLATE-10MM`
   - Tracked Entity = (optional, leave blank for item-level adjustment)
   - Quantity Lost = **20**
   - **Impacts Picking List** = ON
3. Save.

**Show**: Trigger fires. Back on the PL:
- The matching line shows **estimatedQuantity = 100** with a strikethrough
- A new value **adjustedQuantity = 80** sits next to it
- `outstandingQuantity` recomputes to 80 via the generated column
- Tooltip on the strikethrough links back to the incident

**Say**:
> "The picking list line had `estimatedQuantity = 100`. We don't rewrite
> that snapshot — instead the trigger sets `adjustedQuantity = 80`. The
> outstanding-quantity generated column already uses
> `COALESCE(adjusted, estimated)`, so the operator's UI updates
> automatically. The original number is preserved with strikethrough so
> there's always an audit trail."

### 11.3 Non-blocking incident

**Steps**:
1. Create another incident, same item, **Impacts Picking List = OFF**.
2. Save.

**Show**: PL line is unchanged. Incident still recorded and visible on
the job's Incidents tab.

**Say**:
> "Not every incident should reduce demand — sometimes you're just
> logging an issue for the books. The toggle decides whether the trigger
> propagates."

### 11.4 Confirm with the adjustment

**Steps**:
1. Operator picks 80 plates and confirms.
2. Show the consumption ledger now shows 80, not 100.
3. `job.pickingStatus` → **Complete** because outstanding hits 0 against
   the adjusted figure.

**Say**:
> "Because the operator picked the *adjusted* quantity, outstanding is
> zero and no shortage reason is needed. The ledger records exactly what
> was consumed."

---

## 12. Wrap-Up — The 30-Second Summary

> "Recap in one breath:
>
> - **Generate** — auto on Planned/Ready, gated by three opt-in levels.
> - **Allocate** — RPC walks shelves preferred-first, then by available
>   qty descending. Handles four shelf scenarios cleanly: no preferred,
>   single shelf, multi-shelf cascade, shortage.
> - **Pick** — qty form for untracked, scan modal for tracked, auto-split
>   when a batch is smaller than the line.
> - **Confirm** — only step that hits the ledger. Document id is the
>   *job*, not the PL.
> - **Reverse** — full PL roll-back, positive ledger entries, tracked
>   entities restored.
> - **Staging** — generates stock transfers from a shortage assessment
>   so the eventual PL allocates cleanly.
> - **Movements** — single feed of every in-flight transfer, PL line,
>   and outbound shipment, with destination-category chips.
> - **Incidents** — records what was lost; if it impacts an active PL,
>   the trigger reduces line demand via `adjustedQuantity`, no operator
>   intervention needed.
>
> All ~5 weeks across P0–P3. No new accounting model, no waves, no
> hard reservations — just a workflow layer on top of the existing
> ledger and stock transfer plumbing."

---

## Appendix A — Cheat Sheet of Edge Function Ops

| Op | Status guard | Side-effects |
|---|---|---|
| `generatePickingList` | none | Creates PL header + calls RPC |
| `regeneratePickingList` | Draft, Released, In Progress (no picks) | Wipes lines, re-runs RPC |
| `pickInventoryLine` | Released, In Progress | Updates `pickedQuantity`; hard block at 2× |
| `pickTrackedEntityLine` | Released, In Progress | Validates entity, sets `pickedTrackedEntityId`, auto-splits if entity qty < outstanding |
| `unpickLine` | In Progress | Resets `pickedQuantity = 0` |
| `releasePickingList` | Draft | → Released |
| `confirmPickingList` | Released, In Progress | Posts Consumption ledger, locks PL, requires shortage reason if outstanding > 0 |
| `cancelPickingList` | any non-Confirmed | → Cancelled |
| `reversePickingList` | Confirmed | Inverse ledger, restores tracked entities, → Cancelled |
| `stageJob` (P1) | n/a | Returns staging assessment |
| `generateStockTransfer` (P1) | n/a | Creates stockTransfer + lines |

## Appendix B — Status / pickingStatus Matrix

| Trigger | `job.pickingStatus` |
|---|---|
| No qualifying materials | Not Required |
| Job not yet released | Not Generated |
| PL exists in Draft / Released | Generated |
| Any PL In Progress | In Progress |
| Some PLs confirmed, outstanding remains | Partial |
| All required qty issued | Complete |

## Appendix C — Files To Cite If Anyone Asks

- Multi-shelf RPC: `packages/database/supabase/migrations/20260507000000_picking-lists-multi-shelf-rpc.sql`
- Auto-gen trigger: `packages/database/supabase/migrations/20260507000001_picking-lists-auto-generate-trigger.sql`
- Overpick guard: `packages/database/supabase/migrations/20260507000002_picking-lists-overpick-tolerance.sql`
- Staging RPC: `packages/database/supabase/migrations/20260507000004_job-staging-assessment.sql`
- Incidents: `packages/database/supabase/migrations/20260507000009_production-incidents.sql`
- Edge function: `packages/database/supabase/functions/pick/index.ts`
- ERP detail route: `apps/erp/app/routes/x+/picking-list+/$id.tsx`
- ERP dashboard: `apps/erp/app/routes/x+/inventory+/picking-lists.tsx`
- Movements feed: `apps/erp/app/routes/x+/inventory+/movements.tsx`
- Job staging tab: `apps/erp/app/routes/x+/job+/$jobId.staging.tsx`
- Job incidents: `apps/erp/app/routes/x+/job+/$jobId.incidents.tsx`
- MES list: `apps/mes/app/routes/x+/picking-lists.tsx`
- MES pick screen: `apps/mes/app/routes/x+/picking-list.$id.tsx`
- MES scan modal: `apps/mes/app/routes/x+/picking-list.$id.scan.$lineId.tsx`
- Components: `apps/erp/app/modules/inventory/ui/PickingLists/`
