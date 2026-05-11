# Picking List — Manual Testing Guide (P0 → P3)

Complete manual test plan for everything shipped on this branch. Walk
top-to-bottom and you exercise every scenario built across the four
phases: P0 core picking, P1 job staging, P2 movements feed, P3
production incidents.

> **Scope honesty**: known polish gaps not covered by this plan —
> soft overpick warning tier (only hard 2× block exists), saved
> dashboard views, `SoftAllocationBadge`, extracted MES component
> folder, `inventory_approve`-tier perms. Everything else from
> P0–P3 has a test below.

---

## 1. Environment

- ERP: `npm run dev -w erp` → `http://localhost:3000`
- MES: `npm run dev -w mes` → `http://localhost:3001`
- Supabase: `npx supabase start`
- Edge functions: `npx supabase functions serve`
- DB migrated through `20260507000009_production-incidents.sql`
- Users:
  - **Planner** — `inventory_create` + `inventory_update`
  - **Operator** — `inventory_update` only (MES)
  - **Supervisor** — `inventory_delete` for cancels of In Progress PLs

Reset between cases by deleting test jobs / PLs rather than
truncating tables.

---

## 2. Seed Data (one-time)

All seeded via UI — no SQL required.

| ID | What | Notes |
|---|---|---|
| **SD-01** | Location `MAIN` | Resources → Locations → New |
| **SD-02** | Shelves at MAIN: `A-01`, `A-02`, `B-01`, `B-02`, `C-01`, `W-FAR`, `W-NEAR`, `LINE-A`, `FG-DONE`, `QUARANTINE`, `SCRAP-BIN` | Resources → Storage Units. Tag `QUARANTINE` and `SCRAP-BIN` with the matching storageType names. |
| **SD-03** | Work Centre `Assembly-01` with `defaultStorageUnitId = LINE-A` | Resources → Work Centres |
| **SD-04** | Item `BOLT-M8` (untracked, EA). Pick method: shelf `A-01`. | Items → New |
| **SD-05** | Item `STEEL-PLATE-10MM` (batch-tracked). Pick method: shelf `B-01`. | Tracking type = Batch |
| **SD-06** | Batches: `B-001` (50 EA @ B-01, oldest), `B-002` (30 EA @ B-01), `B-003` (40 EA @ B-02) | Receipts |
| **SD-07** | Item `ADHESIVE-X` (untracked) — only 10 EA at `C-01` | for shortage scenario |
| **SD-08** | Item `GENERIC-WASHER` (untracked) — **no** pick method. 80 @ `W-FAR`, 40 @ `W-NEAR` | for no-storage-unit scenario |
| **SD-09** | Item `LINE-SIDE-CAP` (untracked) — methodMaterial.requiresPicking will be false on its BoM | for opt-out |
| **SD-10** | Stock on hand: BOLT-M8 → 500 @ A-01, 200 @ A-02 | via receipts |
| **SD-11** | Method `Widget-100` with finish-to shelf `FG-DONE` and BoM containing all of SD-04..SD-09 lines, all on operation linked to Assembly-01 | Items → Widget-100 → Methods |

---

## 3. P0 — Settings & Opt-In

### TC-P0-OPT-01 — Company opt-out skips PL entirely

**Pre**: `companySettings.usePickingLists = false` (Settings → Company → Inventory)

**Steps**:
1. Create job `J-OPT-01` from `Widget-100`, qty 10.
2. Release the job.

**Expected**:
- No PL created.
- `job.pickingStatus` stays `Not Required`.
- Reset: re-enable `usePickingLists = true`.

---

### TC-P0-OPT-02 — Material-level opt-out skips that line only

**Pre**: On `Widget-100` BoM, set `LINE-SIDE-CAP.requiresPicking = false`.

**Steps**:
1. Create job `J-OPT-02` from `Widget-100`, qty 10.
2. Release.

**Expected**:
- PL is generated.
- PL has lines for BOLT-M8, STEEL-PLATE-10MM, ADHESIVE-X, GENERIC-WASHER.
- **No line for LINE-SIDE-CAP**.

---

### TC-P0-OPT-03 — Job-level toggle off blocks auto-gen

**Pre**: Create job `J-OPT-03`. Untick `Auto-Generate Picking List` in job properties.

**Steps**:
1. Release the job.

**Expected**:
- No PL auto-created.
- `pickingStatus = Not Generated`.
- Manual button **Generate Picking List** still works → creates PL.

---

## 4. P0 — Generation Triggers

### TC-P0-GEN-01 — Auto-gen on `status → Planned`

**Steps**:
1. Create job `J-GEN-01`, status Draft.
2. Change status to `Planned`.

**Expected**:
- A PL (`PL-xxxxx`) is created in Draft.
- `job.pickingStatus = Generated`.

---

### TC-P0-GEN-02 — Auto-gen on `status → Ready`

**Steps**:
1. Create job `J-GEN-02`. Move Draft → Ready (skip Planned).

**Expected**:
- PL created.
- `pickingStatus = Generated`.

---

### TC-P0-GEN-03 — Idempotent re-status

**Steps**:
1. On `J-GEN-01`, move status back to Draft, then to Planned again.

**Expected**:
- **No** second PL created.
- Trigger guarded by `pickingStatus = 'Not Generated'`.

---

### TC-P0-GEN-04 — Manual generation button

**Pre**: Job with `autoGeneratePickingList = false`.

**Steps**:
1. Click **Generate Picking List** in the job header.

**Expected**: PL created.

---

## 5. P0 — Shelf Allocation Variations (the core scenarios)

The RPC `generate_picking_list_lines` lives in
`20260507000000_picking-lists-multi-shelf-rpc.sql`. These cases prove
the multi-shelf cascade works.

### TC-P0-ALLOC-01 — Single shelf, enough stock

**Pre**: BOLT-M8: 500 @ A-01, 200 @ A-02. Job needs **100 EA**.

**Steps**:
1. Generate PL.

**Expected**:
- **One** line: `BOLT-M8 | A-01 | est=100 | outstanding=100`.

---

### TC-P0-ALLOC-02 — Multi-shelf cascade

**Pre**: BOLT-M8: 500 @ A-01 (preferred), 200 @ A-02. Job needs **600 EA**.

**Steps**:
1. Generate PL.

**Expected**:
- **Two** lines:
  - `BOLT-M8 | A-01 | est=500`
  - `BOLT-M8 | A-02 | est=100`
- Total estimated = 600. No shortage.

---

### TC-P0-ALLOC-03 — Shortage line appended

**Pre**: ADHESIVE-X: 10 EA total at C-01. Job needs **50 EA**.

**Steps**:
1. Generate PL.

**Expected**:
- **Two** lines:
  - `ADHESIVE-X | C-01 | est=10`
  - `ADHESIVE-X | C-01 | est=40` (shortage line, on preferred shelf)
- Sum of estimated = 50.
- Shortage badge visible in lines table.

---

### TC-P0-ALLOC-04 — No storage unit (no preferred shelf)

**Pre**: GENERIC-WASHER: 80 @ W-FAR, 40 @ W-NEAR. **No** pick method, jobMaterial has **no** storageUnitId. Job needs **100 EA**.

**Steps**:
1. Generate PL.

**Expected**:
- **Two** lines, walked by available-qty DESC:
  - `GENERIC-WASHER | W-FAR | est=80` (highest stock first)
  - `GENERIC-WASHER | W-NEAR | est=20`

---

### TC-P0-ALLOC-05 — Tracked item, multi-shelf

**Pre**: STEEL-PLATE-10MM: 80 @ B-01 (50+30 across two batches), 40 @ B-02. Job needs **100 EA**.

**Steps**:
1. Generate PL.

**Expected**:
- **Two** lines (lines are per *shelf*, not per batch):
  - `STEEL-PLATE-10MM | B-01 | est=80`
  - `STEEL-PLATE-10MM | B-02 | est=20`
- `requiresBatchTracking = true` on both lines.

---

### TC-P0-ALLOC-06 — Destination resolution

**Pre**: Material with operation at `Assembly-01` (which has `defaultStorageUnitId = LINE-A`).

**Steps**:
1. Generate PL.

**Expected**:
- All lines for that operation have `destinationStorageUnitId = LINE-A`.
- If no workCenter shelf, falls back to PL header destination.
- If neither set, destination is NULL.

---

### TC-P0-ALLOC-07 — Skips zero quantity / non-Pull / opt-out

**Pre**: A jobMaterial with `quantityToIssue = 0`. Another with `methodType = 'Make'`. Another with `requiresPicking = false`.

**Steps**:
1. Generate PL.

**Expected**: None of those three materials appear as PL lines.

---

## 6. P0 — Picking Flow (ERP)

### TC-P0-PICK-01 — Non-tracked quantity pick

**Pre**: PL with a non-tracked line (BOLT-M8, est 100, outstanding 100).

**Steps**:
1. Release the PL.
2. Open the line → quantity form.
3. Enter `100` → Submit.

**Expected**:
- `pickedQuantity = 100`, `outstandingQuantity = 0`.
- PL status flips from `Released` → `In Progress` on first pick.

---

### TC-P0-PICK-02 — Tracked scan (exact qty)

**Pre**: PL line for STEEL-PLATE-10MM at B-01, est 50. Batch `B-001` (50 EA) at B-01.

**Steps**:
1. Open line → scan modal opens.
2. Select `B-001`. Submit.

**Expected**:
- Line populated with `pickedTrackedEntityId = B-001`, `pickedQuantity = 50`.
- Outstanding = 0.

---

### TC-P0-PICK-03 — Tracked auto-split (entity smaller than line)

**Pre**: PL line for STEEL-PLATE-10MM at B-01, est 80. Batches at B-01: `B-001` (50 EA), `B-002` (30 EA).

**Steps**:
1. Open line → scan `B-001` (50 EA). Submit.

**Expected**:
- Original line closes: `adjustedQuantity = 50`, `pickedQuantity = 50`, outstanding = 0, `pickedTrackedEntityId = B-001`.
- **Sibling line** appears at same shelf B-01 with `est = 30`, no picked entity yet.
2. Open new sibling → scan `B-002`. Submit.

**Expected**:
- Sibling line: picked = 30, outstanding = 0.

---

### TC-P0-PICK-04 — Scan validation failures

**Pre**: PL line for STEEL-PLATE-10MM at B-01.

| Sub | Try to scan | Expected error |
|---|---|---|
| a | Different item's batch | "Item mismatch" |
| b | Batch with status `Consumed` | "Entity not Available" |
| c | Batch at shelf `B-02` (not the line's shelf) | "Wrong shelf" |
| d | Batch with mismatched UoM | "UoM mismatch" |

---

### TC-P0-PICK-05 — Over-pick hard block (2× cap)

**Pre**: Non-tracked line, est = 100.

**Steps**:
1. Enter `pickedQuantity = 250` (2.5× est). Submit.

**Expected**: Edge function rejects with error message; pickedQuantity not updated.

---

### TC-P0-PICK-06 — Unpick line in In Progress

**Pre**: A line with `pickedQuantity > 0` on an In Progress PL.

**Steps**:
1. Click **Unpick** action on the line.

**Expected**:
- `pickedQuantity = 0`, outstanding restored to estimated/adjusted.
- For tracked lines: `pickedTrackedEntityId` cleared.
- No ledger entries (none had been posted yet).

---

## 7. P0 — Regeneration

### TC-P0-REGEN-01 — Regenerate Draft

**Pre**: PL in Draft, lines present.

**Steps**: Click **Regenerate**.

**Expected**: Lines wiped, RPC re-run, fresh lines created.

---

### TC-P0-REGEN-02 — Regenerate Released

**Same as above** but PL in `Released`. Same expected.

---

### TC-P0-REGEN-03 — Regenerate In Progress with no picks

**Pre**: PL In Progress but every line `pickedQuantity = 0`.

**Expected**: Regenerate succeeds.

---

### TC-P0-REGEN-04 — Regenerate In Progress with picks (blocked)

**Pre**: At least one line with `pickedQuantity > 0`.

**Expected**: Edge function returns error. Lines untouched.

---

### TC-P0-REGEN-05 — Regenerate Confirmed (blocked)

**Expected**: Disallowed. Create a new PL for the remainder instead.

---

## 8. P0 — Confirmation & Ledger

### TC-P0-CONF-01 — Clean confirm (no outstanding)

**Pre**: PL with all lines fully picked.

**Steps**: Header → **Confirm** → modal → no shortage prompt → Submit.

**Expected**:
- Status → `Confirmed`. `confirmedAt`, `confirmedBy` set.
- `itemLedger` rows: one Consumption per line with `documentId = jobId`, `documentType = 'Job Consumption'`.
- `jobMaterial.quantityIssued` incremented by `pickedQuantity`.
- Tracked entities flipped to `Consumed`; partial-batch picks generate trackedEntity splits with the remainder still `Available`.
- `trackedActivity` row (type='Consume', sourceDocument='Picking List', sourceDocumentId=PL).
- `trackedActivityInput` links the consumed entity.
- `job.pickingStatus = Complete` (if all required qty issued).
- PL is locked — no edit actions available.

---

### TC-P0-CONF-02 — Confirm with outstanding (shortage path)

**Pre**: PL with at least one line where `pickedQuantity < estimated/adjusted`.

**Steps**:
1. Header → **Confirm**.
2. Modal opens — shortage textarea **required**.
3. Submit empty → Submit button disabled.
4. Type a reason → submit enabled → Submit.

**Expected**:
- `pickingList.shortageReason` populated.
- Ledger entries match `pickedQuantity` only.
- `job.pickingStatus = Partial` (because outstanding remains overall).

---

### TC-P0-CONF-03 — Two sequential PLs cover demand

**Pre**: Job material `quantityToIssue = 100`. First PL picked 60 of 100 and confirmed with shortage reason.

**Steps**:
1. On the same job, click **Generate Picking List** again.

**Expected**:
- Second PL generates with `quantityToIssue = 40` (the remainder via `GENERATED` column on jobMaterial).
- Pick + confirm second PL fully → `pickingStatus = Complete`.

---

### TC-P0-CONF-04 — Confirm tracked partial-batch behavior

**Pre**: Line scanned with batch `B-001` (50 EA). `pickedQuantity = 30` (less than entity quantity).

**Steps**: Confirm PL.

**Expected**:
- The 30 picked → status `Consumed`.
- The remaining 20 of B-001 → stays `Available` (entity split).

---

## 9. P0 — Reversal

### TC-P0-REV-01 — Reverse a Confirmed PL

**Pre**: PL in Confirmed.

**Steps**: Header → **Reverse**.

**Expected**:
- Inverse `itemLedger` entries posted (Positive Adjmt / Job Reversal).
- `jobMaterial.quantityIssued` decremented.
- Tracked entities restored to `Available` **only if still `Consumed` and not touched since**.
- PL status → `Cancelled`.
- `job.pickingStatus` recomputes (likely → `Generated` or `Not Generated` depending on other PLs).

---

### TC-P0-REV-02 — Reverse blocked when tracked entity already moved

**Pre**: A Confirmed PL with a tracked entity. After confirm, the entity was further transacted (e.g., outputs registered).

**Expected**:
- Reverse still posts ledger reversal for the qty.
- Tracked entity that's no longer `Consumed` is **not** restored — it stays in its current state.

---

## 10. P0 — Cancel & Delete

### TC-P0-CAN-01 — Cancel Draft / Released

**Steps**: Header → **Cancel**.

**Expected**: Status → `Cancelled`. No ledger impact.

---

### TC-P0-CAN-02 — Cancel In Progress (requires delete perm)

**As**: Supervisor user with `inventory_delete`.

**Expected**: Cancel succeeds. Any `pickedQuantity` rolled back to 0 (no ledger had posted).

**As**: Plain operator user — Cancel action either hidden or rejected.

---

### TC-P0-DEL-01 — Delete a Draft PL

**Pre**: PL in Draft.

**Steps**: Header overflow → **Delete**.

**Expected**: PL row gone. `job.pickingStatus` recomputes.

---

### TC-P0-DEL-02 — Delete blocked for Confirmed PL

**Expected**: Delete action hidden or rejected with error.

---

## 11. P0 — Line Edit / Add / Delete

### TC-P0-LINE-01 — Edit `adjustedQuantity` on a line

**Pre**: Released PL.

**Steps**: Open line → set `adjustedQuantity` to a number ≠ estimated.

**Expected**:
- `outstandingQuantity` recomputes via `GENERATED` column = `GREATEST(adjusted - picked, 0)`.
- UI shows strikethrough on original `estimatedQuantity`.

---

### TC-P0-LINE-02 — Add manual line

**Steps**: PickingListLines → **Add Line** → choose item/shelf/qty.

**Expected**: New line appears. RPC was bypassed; this is operator-authored.

---

### TC-P0-LINE-03 — Delete a line

**Steps**: Line row → delete action.

**Expected**: Line removed. Allowed in Draft/Released/In Progress (with no picks on that line).

---

## 12. P0 — Soft Allocation

### TC-P0-ALLOC-VIS-01 — Two PLs reserve same item

**Steps**:
1. Generate PL-A for Job 1 needing 100 BOLT-M8 → released.
2. Generate PL-B for Job 2 needing 100 BOLT-M8 → released.
3. Hit `GET /api/inventory/soft-allocations?itemIds=BOLT-M8`.

**Expected**:
- Response: `[{ itemId: "BOLT-M8", allocatedQuantity: 200 }]`.
- After PL-A confirmed → allocation drops to 100.
- After PL-A cancelled → allocation drops by 100 (lines no longer outstanding).

---

## 13. P0 — PDF / Print

### TC-P0-PDF-01 — Print sort order

**Steps**: Open `/x/picking-list/<id>/pdf`.

**Expected**:
- Print-CSS page.
- Lines grouped/sorted by `storageUnitId` name.
- Each line has item, qty, shelf, tracked entity slot.
- Header has PL id, job, location, due, assignee.

---

## 14. P0 — Dashboard & Filters

### TC-P0-DASH-01 — List + filters

**Steps**: `/x/inventory/picking-lists`.

**Expected**:
- Filters work: status (multi), location, assignee, due.
- Quick-action chips per row.

---

### TC-P0-DASH-02 — Job tab

**Steps**: Job → Picking Lists tab.

**Expected**: All PLs for the job listed with their statuses.

---

## 15. P0 — MES Flow

### TC-P0-MES-01 — Assigned picks list

**Pre**: Released PL with assignee = operator user.

**Steps**: Sign in to MES as operator → `/x/picking-lists`.

**Expected**: PL card visible with line count + due date.

---

### TC-P0-MES-02 — Pick screen tracked scan

**Steps**: Tap card → tap a tracked line → scan modal.

**Expected**: Same validation as ERP scan. Auto-submit on success.

---

### TC-P0-MES-03 — Pick screen non-tracked qty

**Steps**: Tap non-tracked line → enter qty → submit.

**Expected**: Picked qty updated.

---

### TC-P0-MES-04 — Confirm from MES

**Steps**: Tap **Confirm** from pick screen → summary → submit.

**Expected**: Same backend path as ERP. Status → Confirmed.

---

## 16. P0 — `job.pickingStatus` State Machine

### TC-P0-STATUS-01 — Full lifecycle

| Step | Expected `job.pickingStatus` |
|---|---|
| Job created, no qualifying materials | `Not Required` |
| Add qualifying material, still Draft | `Not Generated` |
| Release job → PL created | `Generated` |
| Operator picks first line | `In Progress` |
| Confirm PL with outstanding > 0 | `Partial` |
| Second PL for remainder confirmed | `Complete` |
| Reverse one confirmed PL | recomputes — likely `Partial` or `Generated` |

Verify after each step.

---

## 17. P1 — Job Staging

### TC-P1-FIN-01 — `finishTo` propagation

**Pre**: On method `Widget-100`, set `makeMethod.finishToStorageUnitId = FG-DONE`.

**Steps**: Create job from this method.

**Expected**: `job.finishToStorageUnitId = FG-DONE` (copied via
`upsertJobMakeMethodFromJob`).

---

### TC-P1-STAGE-01 — Staging assessment view

**Pre**: Job with materials whose preferred shelves don't have enough stock. Stock exists on alternate shelves in the same location.

**Steps**: Job → **Staging** tab.

**Expected**: For each material:
- `atPickLocation` qty
- `elsewhere` qty
- `shortage = max(estimated - atPickLocation, 0)`
- `sourceStorageUnitId` = highest-qty alternate shelf

---

### TC-P1-STAGE-02 — Generate stock transfers

**Pre**: Staging assessment shows shortages with valid source/dest shelves.

**Steps**: Tick shortage rows → **Generate Stock Transfers**.

**Expected**:
- A `stockTransfer` is created in Draft.
- `stockTransferLine` rows: `fromStorageUnitId = sourceShelf`, `toStorageUnitId = preferredShelf`, `quantity = min(shortage, sourceAvailable)`.
- `lineCount` returned matches the number of actionable shortages.

---

### TC-P1-STAGE-03 — No actionable shortages

**Pre**: Job with no shortages, or shortages have no valid source.

**Steps**: Generate Stock Transfers.

**Expected**: Edge function returns `{ stockTransferId: null, lineCount: 0, message: "No actionable shortages" }`. No DB rows created.

---

### TC-P1-STAGE-04 — Round trip: stage → execute → regenerate PL

**Steps**:
1. Generate transfers.
2. Execute one (Release transfer, then complete it — moves stock).
3. Back on job, **Regenerate Picking List**.

**Expected**: New PL allocates from the preferred shelf with no shortage line — because the transfer moved stock to that shelf.

---

## 18. P2 — Movements Feed

### TC-P2-FEED-01 — Stock transfer in feed

**Pre**: A Released `stockTransfer` with outstanding lines.

**Steps**: `/x/inventory/movements`.

**Expected**: Row visible with Type = `Stock Transfer`, From/To shelves, ref = `stockTransferId`.

---

### TC-P2-FEED-02 — Picking list with destination in feed

**Pre**: PL with `destinationStorageUnitId IS NOT NULL` on lines, status Released or In Progress.

**Expected**: Rows visible with Type = `Picking List`, From = source shelf, To = destination.

---

### TC-P2-FEED-03 — Outbound shipment in feed

**Pre**: Active shipment with unshipped lines.

**Expected**: Rows with Type = `Shipment`, Category chip `Customer`. To shelf = NULL.

---

### TC-P2-FEED-04 — Destination category chips

**Pre**:
- Shelf `QUARANTINE` tagged with storageType "Quarantine".
- Shelf `SCRAP-BIN` tagged with storageType "Scrap".
- A stock transfer moving to each.

**Expected**:
- Transfer to QUARANTINE → chip `Quarantine`.
- Transfer to SCRAP-BIN → chip `Scrap`.
- Normal shelf → no chip.

---

### TC-P2-FEED-05 — Drop-off on completion

**Steps**:
1. Confirm one of the PLs visible in the feed.
2. Refresh `/x/inventory/movements`.

**Expected**: That PL's lines disappear from feed.

---

### TC-P2-FEED-06 — Filters

**Verify**:
- Filter by Type (multi-select).
- Filter by destination category.
- Filter by source/destination shelf.
- Filter by location.

---

## 19. P3 — Production Incidents

### TC-P3-SEED-01 — Default types seeded

**Steps**: Settings → Production → Incident Types (or `productionIncidentType` in DB).

**Expected**: Seven rows per company:
- Equipment Failure
- Crop Disease
- Environmental Damage
- Quality Rejection
- Pest Damage
- Contamination
- Other

---

### TC-P3-INC-01 — Blocking incident reduces PL line

**Pre**: Active PL with `STEEL-PLATE-10MM` line, `estimatedQuantity = 100`, `pickedQuantity = 0`.

**Steps**: Job → Incidents → **New** → type `Quality Rejection`, item = STEEL-PLATE-10MM, qty lost = 20, `impactsPickingList = ON`.

**Expected**:
- `productionIncident` row created.
- Trigger fires on the PL line: `adjustedQuantity = 80`.
- Outstanding recomputes to 80 via generated column.
- UI: line shows estimated `100` strikethrough + adjusted `80` next to it. Tooltip references the incident.

---

### TC-P3-INC-02 — Non-blocking incident leaves PL alone

**Steps**: Create incident with `impactsPickingList = OFF`.

**Expected**:
- Incident row exists.
- PL line is **unchanged**.

---

### TC-P3-INC-03 — Tracked-entity-specific incident

**Pre**: PL line with `pickedTrackedEntityId = B-001`.

**Steps**: Create incident with `trackedEntityId = B-001`, qty lost = 10, impactsPickingList ON.

**Expected**: Adjustment applied to the matching line (matched on item + entity).

---

### TC-P3-INC-04 — Incident on Confirmed PL is ignored

**Pre**: PL already in Confirmed status.

**Steps**: Create blocking incident matching one of its items.

**Expected**: Confirmed PL not modified (trigger filters on active PLs only).

---

### TC-P3-INC-05 — Confirm PL with adjustment

**Pre**: PL line with `estimated = 100`, `adjustedQuantity = 80` from incident.

**Steps**: Operator picks 80. Confirm PL.

**Expected**:
- No shortage prompt (outstanding = 0 against adjusted).
- Consumption ledger posts 80, not 100.
- `jobMaterial.quantityIssued` increases by 80.
- `job.pickingStatus → Complete`.

---

### TC-P3-INC-06 — Edit / close incident

**Steps**: Open existing incident → change status to `Resolved` → save.

**Expected**: Status saved. PL adjustment NOT reverted (decoupled — operators choose to re-adjust manually if needed).

---

## 20. Permissions Matrix

Run each as the listed role.

| Action | Operator | Planner | Supervisor |
|---|---|---|---|
| View PL | ✓ | ✓ | ✓ |
| Create PL (manual) | ✗ | ✓ | ✓ |
| Edit line / pick / unpick | ✓ | ✓ | ✓ |
| Release | ✓ | ✓ | ✓ |
| Cancel Draft/Released | ✓ | ✓ | ✓ |
| Cancel In Progress | ✗ | ✗ | ✓ |
| Confirm clean | ✓ | ✓ | ✓ |
| Confirm with shortage | ✓ * | ✓ * | ✓ |
| Reverse Confirmed | ✗ | ✓ | ✓ |
| Delete (Draft / Cancelled) | ✗ | ✓ | ✓ |

\* Note: this branch does not split shortage-confirm into the
`inventory_approve` tier from the v2 plan. Any user with `inventory_update`
can confirm with shortage. Track as a known gap.

---

## 21. Regression Checks (run after any picking-list code change)

- TC-P0-ALLOC-02 (multi-shelf cascade)
- TC-P0-ALLOC-03 (shortage append)
- TC-P0-PICK-03 (tracked auto-split)
- TC-P0-CONF-01 (clean confirm ledger)
- TC-P0-CONF-02 (shortage reason required)
- TC-P0-REV-01 (reverse)
- TC-P0-STATUS-01 (pickingStatus lifecycle)
- TC-P1-STAGE-02 (generate transfers)
- TC-P2-FEED-05 (drop-off)
- TC-P3-INC-01 (incident adjustment)

These ten cases exercise every major code path. Green here = green
build.

---

## 22. DB Quick Verification (optional, via SQL)

When in doubt, query directly. Common verifications:

```sql
-- PL header + line count
SELECT pl."pickingListId", pl.status, pl."shortageReason",
       COUNT(pll.id) AS lines,
       SUM(pll."estimatedQuantity") AS est,
       SUM(pll."pickedQuantity")   AS picked,
       SUM(pll."outstandingQuantity") AS outstanding
FROM "pickingList" pl
LEFT JOIN "pickingListLine" pll ON pll."pickingListId" = pl.id
WHERE pl.id = '<PL_ID>'
GROUP BY pl.id;

-- Ledger entries for the job
SELECT "entryType", "documentType", "documentId", "quantity",
       "trackedEntityId"
FROM "itemLedger"
WHERE "documentId" = '<JOB_ID>'
ORDER BY "createdAt";

-- Soft allocation snapshot
SELECT pll."itemId", SUM(pll."outstandingQuantity") AS allocated
FROM "pickingListLine" pll
JOIN "pickingList" pl ON pll."pickingListId" = pl.id
WHERE pl.status IN ('Released','In Progress')
GROUP BY pll."itemId";

-- pickingStatus check
SELECT id, "jobId", "pickingStatus" FROM "job" WHERE id = '<JOB_ID>';

-- Movements feed sanity (3-arm UNION conceptually)
SELECT 'transfer' AS arm, COUNT(*) FROM "stockTransferLine" stl
JOIN "stockTransfer" st ON stl."stockTransferId" = st.id
WHERE st.status IN ('Released','In Progress') AND stl."outstandingQuantity" > 0
UNION ALL
SELECT 'pl', COUNT(*) FROM "pickingListLine" pll
JOIN "pickingList" pl ON pll."pickingListId" = pl.id
WHERE pl.status IN ('Released','In Progress') AND pll."destinationStorageUnitId" IS NOT NULL
UNION ALL
SELECT 'shipment', COUNT(*) FROM "shipmentLine" sl
JOIN "shipment" s ON sl."shipmentId" = s.id
WHERE s.status NOT IN ('Posted','Cancelled') AND (sl.quantity - sl."shippedQuantity") > 0;
```

---

## 23. Bug Triage Template

When a test fails, log it here for quick re-runs.

| Date | Test ID | Symptom | Root cause | Fix commit |
|---|---|---|---|---|
| | | | | |
