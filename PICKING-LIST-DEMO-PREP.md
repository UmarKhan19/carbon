# Picking List Demo Prep From Empty Data

Use this file before recording the Picking List demo. It assumes you are starting with no useful demo data and need to create a clean, repeatable setup that covers P0 through P3.

The goal is to end with:

- One demo company with picking lists enabled.
- One warehouse location with shelves that exercise each allocation case.
- Five demo items.
- One method / BoM.
- Several jobs and picking lists for generation, picking, confirmation, staging, movements, and incidents.
- Browser tabs ready so the recording feels smooth.

---

## 1. Demo Company

Create or choose one company.

| Field | Value |
|---|---|
| Company name | `Picking Demo Co` |
| `Use Picking Lists` | ON |
| `Default Auto-Generate Picking List` | ON |

You need three users.

| User | Purpose | Needed access |
|---|---|---|
| Planner | Creates and releases jobs and picking lists | ERP job + inventory access |
| Operator | Picks lines in MES | MES picking access |
| Approver | Confirms with shortages and reverses confirmed picking lists | Permission to confirm with outstanding demand |

Pre-recording checks:

- [ ] Company-level picking list switch is ON.
- [ ] Default auto-generation is ON.
- [ ] Planner can access ERP jobs and inventory.
- [ ] Operator can access MES picking lists.
- [ ] Approver can confirm picking lists with outstanding demand.

---

## 2. Locations And Shelves

Create one main location.

| Location code | Name |
|---|---|
| `MAIN` | Main Warehouse |

Create these storage units / shelves under `MAIN`.

| Shelf | Purpose |
|---|---|
| `A-01` | Preferred shelf for bolts |
| `A-02` | Overflow shelf for bolts |
| `B-01` | Main shelf for steel plates |
| `B-02` | Overflow shelf for steel plates |
| `C-01` | Shortage shelf for adhesive |
| `W-FAR` | Washer shelf with more stock |
| `W-NEAR` | Washer shelf with less stock |
| `LINE-A` | Line-side destination shelf |
| `FG-01` | Finished goods destination |
| `QUAR-01` | Quarantine shelf |
| `SCRAP-01` | Scrap shelf |

Parent-child note:

- Storage units do support parent-child nesting through `parentId`.
- For this demo, keep it simple: create all shelves above as top-level storage units under location `MAIN`.
- Do not make `MAIN` the parent storage unit. `MAIN` is the location.
- The picking allocation RPC does not need hierarchy. It allocates by actual `storageUnitId`, preferred shelf first, then available quantity descending.
- Hierarchy only matters for storage-unit tree views, subtree helpers, and PDF / walking-order presentation.

Important storage type setup:

- [ ] Tag `QUAR-01` with a Quarantine storage type.
- [ ] Tag `SCRAP-01` with a Scrap storage type.

This lets the movements feed show destination category chips such as `Quarantine` and `Scrap`.

---

## 3. Work Center

Create one work center.

| Field | Value |
|---|---|
| Name | `Assembly-01` |
| Location | `MAIN` |
| Default storage unit | `LINE-A` |

Why this matters:

- `Assembly-01` gives the job a line-side destination.
- `LINE-A` is the place materials are being picked toward.
- This supports staging and movements scenarios later in the demo.

Pre-recording checks:

- [ ] `Assembly-01` exists.
- [ ] It belongs to location `MAIN`.
- [ ] Its default storage unit is `LINE-A`.

---

## 4. Items

Create these five items.

| Item | Tracking | UoM | Purpose |
|---|---:|---|---|
| `BOLT-M8` | Untracked | EA | Single shelf and multi-shelf cascade |
| `STEEL-PLATE-10MM` | Batch-tracked | EA | Tracked scan and auto-split |
| `ADHESIVE-X` | Untracked | EA | Shortage scenario |
| `GENERIC-WASHER` | Untracked | EA | No preferred shelf scenario |
| `LINE-SIDE-CAP` | Untracked | EA | Requires Picking = false opt-out |

Set pick defaults where needed.

| Item | Pick / default shelf |
|---|---|
| `BOLT-M8` | `A-01` |
| `STEEL-PLATE-10MM` | `B-01` |
| `ADHESIVE-X` | `C-01` |
| `GENERIC-WASHER` | none |
| `LINE-SIDE-CAP` | `LINE-A`, but this material should not require picking |

Pre-recording checks:

- [ ] `BOLT-M8` is untracked.
- [ ] `STEEL-PLATE-10MM` is batch-tracked.
- [ ] `ADHESIVE-X` is untracked.
- [ ] `GENERIC-WASHER` has no pick method / default shelf.
- [ ] `LINE-SIDE-CAP` exists and will be set to `Requires Picking = false` on the method material row.

---

## 5. Starting Stock

Load stock into `MAIN` like this.

| Item | Shelf | Qty |
|---|---|---:|
| `BOLT-M8` | `A-01` | 500 |
| `BOLT-M8` | `A-02` | 200 |
| `ADHESIVE-X` | `C-01` | 10 |
| `GENERIC-WASHER` | `W-FAR` | 80 |
| `GENERIC-WASHER` | `W-NEAR` | 40 |
| `LINE-SIDE-CAP` | `LINE-A` | 500 |

Create three available batch / tracked entities for `STEEL-PLATE-10MM`.

| Batch | Shelf | Qty | Note |
|---|---|---:|---|
| `B-001` | `B-01` | 50 | Oldest batch |
| `B-002` | `B-01` | 30 | Second batch |
| `B-003` | `B-02` | 40 | Overflow batch |

Pre-recording checks:

- [ ] All untracked stock balances are visible in inventory.
- [ ] `B-001`, `B-002`, and `B-003` are status `Available`.
- [ ] `B-001` and `B-002` are both on `B-01`.
- [ ] `B-003` is on `B-02`.
- [ ] `ADHESIVE-X` total stock is only 10 EA, so the shortage scenario works.

---

## 6. Method / BoM

Plain English:

- `Widget-100` is the finished product you are making.
- The Method / BoM is the recipe for making `Widget-100`.
- The BoM says which materials are needed: bolts, plates, adhesive, washers, cap.
- The BoP / operation says where the work happens: `Assembly-01`.
- `Finish-to Storage Unit = FG-01` means completed `Widget-100` output lands on shelf `FG-01`.

Before this section, you should already have:

- [ ] Location `MAIN`
- [ ] Storage units `LINE-A` and `FG-01`
- [ ] Work center `Assembly-01`
- [ ] All five material items: `BOLT-M8`, `STEEL-PLATE-10MM`, `ADHESIVE-X`, `GENERIC-WASHER`, `LINE-SIDE-CAP`

### 6.1 Create A Process First

Carbon method operations need a `Process`. Create a simple one for assembly.

Go to:

- ERP -> Resources -> Processes

Create:

| Field | Value |
|---|---|
| Name | `Assembly` |
| Process Type | `Inside` |
| Default Standard Factor | `Minutes/Piece` |
| Work Centers | `Assembly-01` |

If the process already exists, just edit it and make sure `Assembly-01` is selected as one of its work centers.

Pre-recording checks:

- [ ] Process `Assembly` exists.
- [ ] Process type is `Inside`.
- [ ] Process is linked to work center `Assembly-01`.

### 6.2 Create The Finished Item

Go to:

- ERP -> Items -> Parts -> New Part

Create:

| Field | Value / Notes |
|---|---|
| Part ID | `WIDGET-100` or `Widget-100`, depending on your ID style |
| Short Description / Name | `Widget-100` |
| Replenishment System | `Make` |
| Tracking Type | `Inventory` |
| Default Method Type | `Make to Order` |
| Unit of Measure | `EA` |
| Batch Size | `1` is fine for the demo |

Save the part.

After saving, Carbon should take you to the `Widget-100` part page. This page has the manufacturing method sections.

### 6.3 Open The Make Method

On the `Widget-100` part page, look for the method/version area.

Usually you will see:

- A method version badge such as `V1 Draft`
- `Bill of Material`
- `Bill of Process`
- `Make Method Properties`

For the demo, keep the method version as `Draft` while editing. Draft is editable; Active is read-only.

If you only see item details and not the method sections:

- Open the part page for `Widget-100`.
- Look for the `Make` / method tab or method version link.
- Use version `V1 Draft`.

### 6.4 Set Finish-To Storage Unit

In the `Make Method Properties` card:

| Field | Value |
|---|---|
| Finish To Storage Unit | `FG-01` |

Click `Save`.

This is the field from the script:

```text
Finish-to Storage Unit = FG-01
```

It means finished goods from jobs created from this method should default to shelf `FG-01`.

### 6.5 Add The Operation / Work Center

In `Bill of Process`, click `Add Operation`.

Fill:

| Field | Value |
|---|---|
| Process | `Assembly` |
| Operation Order | `After Previous` |
| Operation Type | `Inside` |
| Description | `Assemble Widget-100` |
| Work Center | `Assembly-01` |
| Setup Time | `0` |
| Labor Time | `0` or `1` |
| Machine Time | `0` |

Click `Save`.

Why this matters:

- Picking list generation uses job/material and operation context.
- The operation ties the method to `Assembly-01`.
- `Assembly-01` has default storage unit `LINE-A`, so picked materials can show a line-side destination.

### 6.6 Add The BoM Materials

In `Bill of Material`, click `Add Item` once per material.

Add these rows:

| Material | Qty for main demo | Requires Picking | Notes |
|---|---:|---|---|
| `BOLT-M8` | 100 | ON | Single shelf case |
| `BOLT-M8` | 600 | ON | Multi-shelf cascade case |
| `ADHESIVE-X` | 50 | ON | Shortage case |
| `GENERIC-WASHER` | 100 | ON | No preferred shelf case |
| `STEEL-PLATE-10MM` | 100 | ON | Batch-tracked case |
| `LINE-SIDE-CAP` | 20 | OFF | Opt-out case |

For each row:

1. Select the item.
2. Set `Quantity`.
3. Keep `Method Type = Pull from Inventory`.
4. Set `Location = MAIN`.
5. Set `Storage Unit` only where you need a preferred shelf.
6. Expand `Backflush`.
7. Set `Operation = Assemble Widget-100` if the field is shown.
8. Set `Requires picking` ON or OFF as shown below.
9. Click `Save`.

Recommended material row details:

| Material | Method Type | Location | Storage Unit | Requires Picking |
|---|---|---|---|---|
| `BOLT-M8` 100 row | Pull from Inventory | `MAIN` | `A-01` | ON |
| `BOLT-M8` 600 row | Pull from Inventory | `MAIN` | `A-01` | ON |
| `ADHESIVE-X` | Pull from Inventory | `MAIN` | `C-01` | ON |
| `GENERIC-WASHER` | Pull from Inventory | `MAIN` | leave blank | ON |
| `STEEL-PLATE-10MM` | Pull from Inventory | `MAIN` | `B-01` | ON |
| `LINE-SIDE-CAP` | Pull from Inventory | `MAIN` | `LINE-A` | OFF |

If the system does not allow duplicate material rows for `BOLT-M8` in one method, use two demo jobs:

| Job | Bolt qty | Purpose |
|---|---:|---|
| `J-BOLT-100` | 100 | Single shelf case |
| `J-BOLT-600` | 600 | Multi-shelf cascade case |

### 6.7 Save / Activate Method

For setup, keeping the method as `Draft` is usually fine while you are editing. Before creating final demo jobs, make sure the job creation flow can use this method.

If your build requires an active method:

1. Open the method version dropdown.
2. Choose `Set as Active Version`.
3. Confirm.

Important:

- Once active, the version may become read-only.
- If you need more edits later, create/copy a new Draft version.

Pre-recording checks:

- [ ] Part `Widget-100` / `WIDGET-100` exists.
- [ ] Replenishment System is `Make`.
- [ ] Default Method Type is `Make to Order`.
- [ ] Process `Assembly` exists.
- [ ] Bill of Process has one operation using `Assembly-01`.
- [ ] Finish-to storage unit is `FG-01`.
- [ ] `LINE-SIDE-CAP` has `Requires Picking = false`.
- [ ] Every other material has `Requires Picking = true`.

---

## 7. Jobs To Prepare

Create these jobs before recording.

| Job | Purpose | Auto-generate PL |
|---|---|---|
| `J-1001` | Show auto-generation on release | ON |
| `J-1002` | Show manual generation | OFF |
| `J-DEMO` | Main walkthrough with all shelf scenarios | ON |
| `J-SHORT` | Confirm with outstanding shortage | ON |
| `J-INCIDENT` | Production incident adjustment | ON |

Recommended pre-state:

| Job | Starting status |
|---|---|
| `J-1001` | Draft |
| `J-1002` | Draft, or Planned with no PL |
| `J-DEMO` | Draft, ready to release |
| `J-SHORT` | Released with PL already generated, or ready to generate |
| `J-INCIDENT` | Released with active PL for steel plates |

Pre-recording checks:

- [ ] `J-1001` is ready to release on camera.
- [ ] `J-1002` has `Auto-Generate Picking List = false`.
- [ ] `J-DEMO` uses the full `Widget-100` material setup.
- [ ] `J-SHORT` can be used to pick less than required and confirm with a shortage reason.
- [ ] `J-INCIDENT` has an active PL line for `STEEL-PLATE-10MM`.

---

## 8. Picking Lists To Have Ready

By the time recording starts, you should be able to create or show these.

| Picking list | Job | Purpose |
|---|---|---|
| `PL-00001` | `J-DEMO` | Main generated list |
| `PL-00002` | `J-SHORT` | Pick less than required, confirm with reason |
| `PL-00003` | `J-INCIDENT` | Show incident adjustment |

For the main PL, verify the generated lines.

| Scenario | Expected result |
|---|---|
| `BOLT-M8`, need 100 | One line from `A-01` |
| `BOLT-M8`, need 600 | `A-01` for 500 and `A-02` for 100 |
| `ADHESIVE-X`, need 50 | 10 real qty and 40 shortage |
| `GENERIC-WASHER`, need 100 | `W-FAR` for 80 and `W-NEAR` for 20 |
| `STEEL-PLATE-10MM`, need 100 | `B-01` for 80 and `B-02` for 20 |
| `LINE-SIDE-CAP` | Should not appear |

Pre-recording checks:

- [ ] `PL-00001` can be generated from `J-DEMO`.
- [ ] `LINE-SIDE-CAP` is absent from `PL-00001`.
- [ ] The shortage line for `ADHESIVE-X` is visible.
- [ ] The steel plate lines are by shelf, not by specific batch.
- [ ] `PL-00002` is available for shortage confirmation.
- [ ] `PL-00003` is available for production incident adjustment.

---

## 9. Scenario Line Expectations

Use this section as a quick validation guide.

### 9.1 Single Shelf, Enough Stock

Material:

- Item: `BOLT-M8`
- Need: 100 EA
- Preferred shelf: `A-01`
- Stock on `A-01`: 500 EA

Expected picking list line:

```text
Item: BOLT-M8 | Shelf: A-01 | Estimated: 100 | Outstanding: 100
```

### 9.2 Multi-Shelf Cascade

Material:

- Item: `BOLT-M8`
- Need: 600 EA
- Preferred shelf: `A-01`
- Stock on `A-01`: 500 EA
- Stock on `A-02`: 200 EA

Expected picking list lines:

```text
Line 1: BOLT-M8 | Shelf: A-01 | Estimated: 500 | Outstanding: 500
Line 2: BOLT-M8 | Shelf: A-02 | Estimated: 100 | Outstanding: 100
```

### 9.3 Shortage

Material:

- Item: `ADHESIVE-X`
- Need: 50 EA
- Total stock at location: 10 EA
- Preferred shelf: `C-01`

Expected picking list lines:

```text
Line 1: ADHESIVE-X | Shelf: C-01 | Estimated: 10 | Outstanding: 10
Line 2: ADHESIVE-X | Shelf: C-01 | Estimated: 40 | Outstanding: 40 | Shortage
```

### 9.4 No Storage Unit Specified

Material:

- Item: `GENERIC-WASHER`
- Need: 100 EA
- No pick method
- No job material storage unit
- Stock on `W-FAR`: 80 EA
- Stock on `W-NEAR`: 40 EA

Expected picking list lines:

```text
Line 1: GENERIC-WASHER | Shelf: W-FAR  | Estimated: 80 | Outstanding: 80
Line 2: GENERIC-WASHER | Shelf: W-NEAR | Estimated: 20 | Outstanding: 20
```

### 9.5 Tracked Item With Batches

Material:

- Item: `STEEL-PLATE-10MM`
- Need: 100 EA
- Batch `B-001`: 50 EA on `B-01`
- Batch `B-002`: 30 EA on `B-01`
- Batch `B-003`: 40 EA on `B-02`

Expected picking list lines:

```text
Line 1: STEEL-PLATE-10MM | Shelf: B-01 | Estimated: 80 | Outstanding: 80
Line 2: STEEL-PLATE-10MM | Shelf: B-02 | Estimated: 20 | Outstanding: 20
```

Important:

- The generator creates lines by shelf.
- The batch decision happens at scan time.
- Scanning `B-001` into an 80 EA line should auto-split the line into 50 picked and 30 remaining.

---

## 10. P1 Staging Data

For staging, make sure some material is not already at its desired pick / line-side shelf.

You need:

- [ ] `job.finishToStorageUnitId = FG-01`.
- [ ] At least one material has demand at a preferred shelf.
- [ ] Some of that material exists elsewhere in `MAIN`.
- [ ] The staging assessment can show `At pick location`, `Elsewhere`, `Shortage`, and `Suggested source shelf`.

Useful staging setup:

| Material | Desired shelf | Other shelf with stock | Why |
|---|---|---|---|
| `BOLT-M8` | `A-01` | `A-02` | Shows source shelf suggestion |
| `GENERIC-WASHER` | `LINE-A` or job material shelf | `W-FAR` | Shows stock that needs moving |

Expected behavior:

- The job staging tab should show what is already in position.
- It should show what exists elsewhere in the same location.
- It should calculate shortage against the desired shelf.
- Generating stock transfers should create released stock transfer records.

---

## 11. P2 Movements Feed Data

The movements feed needs active rows from at least one source. Ideally, prepare all three.

| Source | Required state |
|---|---|
| Stock transfer line | Released or In Progress, outstanding > 0 |
| Picking list line | Released or In Progress, outstanding > 0, destination storage unit is not null |
| Shipment line | Active outbound shipment line, if shipments are available in your demo environment |

Destination category chip setup:

- [ ] Have one transfer or movement going to `QUAR-01`.
- [ ] Have one transfer or movement going to `SCRAP-01`.
- [ ] If shipments are available, have one outbound shipment to show the Customer chip.

Expected filters to test:

- [ ] Type = Picking List.
- [ ] Destination Category = Quarantine.
- [ ] Location = MAIN.
- [ ] Source shelf.
- [ ] Destination shelf.
- [ ] Assignee, if available.

Expected drop-off behavior:

- [ ] Confirm a PL in another tab.
- [ ] Refresh `/x/inventory/movements`.
- [ ] Confirmed or cancelled PL lines disappear from the active feed.

---

## 12. P3 Production Incidents Data

Verify default incident types exist for the company.

| Default incident type |
|---|
| Equipment Failure |
| Crop Disease |
| Environmental Damage |
| Quality Rejection |
| Pest Damage |
| Contamination |
| Other |

Prepare `J-INCIDENT`:

- [ ] Job has an active PL.
- [ ] PL has a line for `STEEL-PLATE-10MM`.
- [ ] Line estimated quantity is 100.
- [ ] Picked quantity is 0.

Blocking incident setup:

| Field | Value |
|---|---|
| Type | Quality Rejection |
| Item | `STEEL-PLATE-10MM` |
| Tracked Entity | blank, unless you want entity-level adjustment |
| Quantity Lost | 20 |
| Impacts Picking List | ON |

Expected result:

- Original `estimatedQuantity = 100` stays as the snapshot.
- Line gets `adjustedQuantity = 80`.
- Outstanding recomputes to 80.
- UI shows the original estimate with strikethrough.
- Tooltip or link references the incident.

Non-blocking incident setup:

| Field | Value |
|---|---|
| Type | Quality Rejection |
| Item | `STEEL-PLATE-10MM` |
| Quantity Lost | 20 |
| Impacts Picking List | OFF |

Expected result:

- Incident is recorded.
- PL line is unchanged.

---

## 13. Browser Tabs To Pre-Open

Open these before recording.

| Tab | URL |
|---|---|
| ERP picking list dashboard | `/x/inventory/picking-lists` |
| ERP main demo job | `/x/job/<J-DEMO_ID>` |
| ERP movements feed | `/x/inventory/movements` |
| MES picking lists | `/x/picking-lists` |
| ERP incident job | `/x/job/<J-INCIDENT_ID>/incidents` |
| ERP staging job | `/x/job/<J-DEMO_ID>/staging` |

Optional extra tabs:

| Tab | URL |
|---|---|
| ERP manual generation job | `/x/job/<J-1002_ID>` |
| ERP shortage job | `/x/job/<J-SHORT_ID>` |
| ERP job ledger | `/x/job/<JOB_ID>` ledger tab |
| Picking list PDF | `/x/picking-list/<PL_ID>/pdf` |

---

## 14. Full Dry Run Checklist

Run this once before recording.

### Company And Settings

- [ ] Company picking lists are enabled.
- [ ] Default auto-generation is enabled.
- [ ] `J-1002` has job-level auto-generation disabled.
- [ ] `LINE-SIDE-CAP` has `Requires Picking = false`.

### Generation

- [ ] `J-1001` auto-generates a picking list when released.
- [ ] `J-1002` does not auto-generate.
- [ ] Manual `Generate Picking List` works on `J-1002`.
- [ ] Releasing the same job again does not create a duplicate PL.

### Allocation

- [ ] `BOLT-M8` 100 EA creates one line from `A-01`.
- [ ] `BOLT-M8` 600 EA creates two lines: `A-01` 500 and `A-02` 100.
- [ ] `ADHESIVE-X` 50 EA creates a shortage line for 40.
- [ ] `GENERIC-WASHER` walks shelves by available quantity descending.
- [ ] `STEEL-PLATE-10MM` creates shelf-level lines, not batch-level lines.
- [ ] `LINE-SIDE-CAP` does not appear on the PL.

### Picking

- [ ] Non-tracked quantity picking works for `BOLT-M8`.
- [ ] Tracked scan modal opens for `STEEL-PLATE-10MM`.
- [ ] Scanning `B-001` into an 80 EA steel line auto-splits the remainder.
- [ ] Scanning `B-002` clears the sibling line.
- [ ] Entering more than 2x estimated quantity shows the overpick error.
- [ ] Unpick resets picked quantity while the PL is In Progress.
- [ ] Regenerate is blocked once picked lines exist.

### Confirmation And Ledger

- [ ] Confirming a fully picked PL changes status to Confirmed.
- [ ] Confirmed PL is locked.
- [ ] Consumption ledger rows are posted against the job.
- [ ] `documentType = Job Consumption`.
- [ ] `documentId = jobId`, not picking list id.
- [ ] `jobMaterial.quantityIssued` increases.
- [ ] Tracked entities move to Consumed.
- [ ] Job picking status becomes Complete when all adjusted demand is issued.

### Shortage Confirmation

- [ ] Picking less than required leaves outstanding quantity.
- [ ] Confirm modal requires a shortage reason.
- [ ] Confirming with outstanding demand requires approver permission.
- [ ] Job picking status becomes Partial if demand remains.

### Reversal

- [ ] Reversing a confirmed PL posts inverse ledger entries.
- [ ] `jobMaterial.quantityIssued` is decremented.
- [ ] Tracked entities return to Available if still untouched.
- [ ] PL status becomes Cancelled.
- [ ] PL does not reopen after reversal.

### PDF

- [ ] Print opens `/x/picking-list/<id>/pdf`.
- [ ] Lines are sorted by storage unit hierarchy / walking order.
- [ ] Checkboxes appear per line.
- [ ] Tracked entity slots appear where appropriate.
- [ ] Signature block appears at the bottom.

### MES

- [ ] MES `/x/picking-lists` shows assigned PL cards.
- [ ] MES top nav badge counts unfinished picks.
- [ ] Tapping a PL opens the pick screen.
- [ ] Tapping a tracked line opens the scan modal.
- [ ] Manual fallback works if camera scanning is not available.
- [ ] MES confirmation uses the same backend behavior as ERP.

### Dashboards

- [ ] ERP picking dashboard loads.
- [ ] Saved views are visible.
- [ ] Status, location, assignee, and due date filters work.
- [ ] Job Picking Lists tab shows all PLs for the job.

### Staging

- [ ] Job staging tab loads.
- [ ] Assessment shows at-pick-location quantity.
- [ ] Assessment shows elsewhere quantity.
- [ ] Assessment shows shortage.
- [ ] Assessment shows suggested source shelf.
- [ ] Generate Stock Transfers creates released transfer records.
- [ ] Executing transfers improves the eventual PL allocation.

### Movements

- [ ] Movements feed shows active stock transfer rows.
- [ ] Movements feed shows active picking list rows.
- [ ] Movements feed shows shipment rows if available.
- [ ] Quarantine chip appears for `QUAR-01`.
- [ ] Scrap chip appears for `SCRAP-01`.
- [ ] Customer chip appears for shipment rows if available.
- [ ] Confirmed or cancelled documents drop off the feed.

### Incidents

- [ ] Default incident types exist.
- [ ] Blocking incident with `Impacts Picking List = ON` adjusts active PL demand.
- [ ] `estimatedQuantity` remains preserved.
- [ ] `adjustedQuantity` is reduced.
- [ ] Outstanding quantity recomputes from adjusted quantity.
- [ ] Non-blocking incident with `Impacts Picking List = OFF` leaves PL unchanged.
- [ ] Confirming after adjustment consumes the adjusted quantity, not the original estimate.

---

## 15. Quick Recording Readiness

You are ready to record when all of these are true:

- [ ] You can release `J-1001` and show auto-generation.
- [ ] You can manually generate a PL for `J-1002`.
- [ ] `J-DEMO` shows all shelf scenarios side by side.
- [ ] `PL-00001` can be released, picked, confirmed, printed, and reversed.
- [ ] `PL-00002` can demonstrate confirm-with-shortage.
- [ ] MES operator flow works for the same backend PL.
- [ ] Staging tab can generate stock transfers.
- [ ] Movements feed has live rows and useful filters.
- [ ] `J-INCIDENT` can show adjusted picking demand.

---

# Full Picking List Video Demo Script

A turn-by-turn walkthrough covering every scenario shipped across P0-P3.
Use the prep checklist above first, then follow this section while recording.

Reference implementation:

- Edge function: `packages/database/supabase/functions/pick/index.ts`
- Migrations: `20260505000000...20260507000009`
- ERP routes: `apps/erp/app/routes/x+/picking-list+/`
- MES routes: `apps/mes/app/routes/x+/picking-list*.tsx`
- Components: `apps/erp/app/modules/inventory/ui/PickingLists/`

---

## 16. The Pitch - 60 Seconds

Say:

> "Today I'm walking you through Picking Lists - the workflow that sits
> between job planning and material consumption. It tells an operator
> what to pick, where to pick it from, and where it's going. Once they
> confirm, we post the consumption ledger entry against the job - not
> the picking list, because the picking list is a workflow artifact, not
> an accounting one.
>
> I'll show you four things in order: how a PL gets generated, the four
> different shelf scenarios the generator handles, how an operator picks
> on the MES, and then three follow-on features - staging, the
> factory-wide movements feed, and incident reporting."

---

## 17. Settings And Opt-In - The Three Levels

The whole system is gradient-adoption. Show this before generating anything so the audience understands the dials.

### 17.1 Company-Level Switch

Where:

- ERP -> Settings -> Company -> Inventory

Show:

- `Use Picking Lists` toggle
- `Default Auto-Generate Picking List` toggle

Say:

> "Level one - company switch. If a customer doesn't want picking lists
> at all, flip this off and Carbon behaves exactly like before. We're
> leaving it on."

### 17.2 Material-Level Flag

Where:

- ERP -> Items -> `LINE-SIDE-CAP` -> Methods -> open the BoM step for the cap

Show:

- `Requires Picking` toggle on the method material row

Say:

> "Level two - per-material. A cap that's permanently stocked at the
> assembly bench shouldn't be picked. Toggle off here and it'll never
> appear on a picking list. Operators issue it the old way through the
> MES material modal."

### 17.3 Job-Level Toggle

Where:

- ERP -> Job -> Properties panel

Show:

- `Auto-Generate Picking List` toggle

Say:

> "Level three - per job. If a planner wants to hand-craft the PL on a
> specific job, they untick this and the trigger leaves the job alone.
> Default is on, inherited from company settings at job creation."

---

## 18. Generation Triggers

### 18.1 Auto-Generation On Status Change

Where:

- ERP -> Job `J-1001`
- Starting status: Draft

Steps:

1. Point at `job.pickingStatus = Not Required` on the job header.
2. Click Release, or change status to Planned.
3. Wait for the page to reload.
4. Point at `pickingStatus = Generated`.
5. Open the Picking Lists tab and show the new `PL-00001` link.

Say:

> "The job goes from Draft to Planned. The
> `trigger_auto_generate_picking_list` SQL trigger fires, checks the
> company switch, the per-job toggle, and that the job has at least one
> qualifying `jobMaterial` - Pull from Inventory, quantity greater than
> zero, requiresPicking true. Then it calls the same edge function the
> manual button calls. The picking list is born in Draft."

### 18.2 Manual Generation

Where:

- Job `J-1002`
- `autoGeneratePickingList = false`

Steps:

1. Release `J-1002`.
2. Show `pickingStatus` stays `Not Generated`.
3. Open the job.
4. Click `Generate Picking List` in the header menu.
5. Show the PL is created.

Say:

> "If auto-gen is off, the planner gets an explicit button. Same edge
> function, same RPC, identical result. The trigger and the button are
> two doorways into the same room."

### 18.3 Idempotency

Steps:

1. Toggle the job back to Draft.
2. Release it again.
3. Show a second PL is not created.

Say:

> "The trigger guards on `pickingStatus = Not Generated`, so you can
> flip the job status back and forth without spawning duplicate PLs."

---

## 19. The Four Shelf Scenarios

This is the heart of the video.

The RPC `generate_picking_list_lines` in `packages/database/supabase/migrations/20260507000000_picking-lists-multi-shelf-rpc.sql` walks shelves at the job's location, preferred shelf first, then by available quantity descending.

Tip:

- Try to have all four cases on a single PL so the audience sees them side-by-side.
- Use `J-DEMO`.

### 19.1 Scenario A - Single Shelf, Enough Stock

Material setup:

- Item: `BOLT-M8`
- Need: 100 EA
- Preferred shelf: `A-01`
- Stock on `A-01`: 500 EA

Show:

```text
Item: BOLT-M8 | Shelf: A-01 | Estimated: 100 | Outstanding: 100
```

Say:

> "Simplest case. The item has a preferred shelf via its pick method,
> the shelf has enough stock, the RPC creates one line and moves on. The
> operator goes to A-01, grabs 100, done."

### 19.2 Scenario B - Multi-Shelf Cascade

Material setup:

- Item: `BOLT-M8`
- Need: 600 EA
- Preferred shelf: `A-01`
- Stock on `A-01`: 500 EA
- Stock on `A-02`: 200 EA

Expected behavior:

- RPC walks `A-01` first.
- It takes 500 EA.
- It walks to `A-02`.
- It takes the remaining 100 EA.

Show:

```text
Line 1: BOLT-M8 | Shelf: A-01 | Estimated: 500 | Outstanding: 500
Line 2: BOLT-M8 | Shelf: A-02 | Estimated: 100 | Outstanding: 100
```

Say:

> "Here's where most ERPs fall over. The job needs 600 bolts but no
> single shelf has 600. Instead of throwing a fake shortage warning, the
> RPC cascades. Preferred shelf A-01 contributes 500 - that's its full
> available balance - then it walks to the next shelf by available
> quantity descending, A-02, and takes the last 100. You get two real
> lines the operator can actually action. No phantom shortage."

Optional aside:

> "Note the soft-allocation field underneath - if a different PL is
> already reserving stock from A-01, the available number drops
> accordingly. We're not hard-reserving, but we surface it."

### 19.3 Scenario C - Shortage

Material setup:

- Item: `ADHESIVE-X`
- Need: 50 EA
- Total stock at location: 10 EA
- Shelf: `C-01`

Show two lines:

```text
Line 1: ADHESIVE-X | Shelf: C-01 | Estimated: 10 | Outstanding: 10
Line 2: ADHESIVE-X | Shelf: C-01 | Estimated: 40 | Outstanding: 40 | Shortage
```

Say:

> "If after walking every shelf the demand still isn't covered, the RPC
> appends one final shortage line on the preferred shelf with the
> remaining quantity. That way the operator sees Outstanding = 40 on the
> picking list itself, not buried in a modal somewhere. The shortage is
> non-blocking - they can still confirm - but they'll be forced to give
> a reason, and confirming with outstanding requires the approver
> permission."

### 19.4 Scenario D - No Storage Unit Specified

Material setup:

- Item: `GENERIC-WASHER`
- No pick method
- Job material has no `storageUnitId`
- Stock on `W-FAR`: 80 EA
- Stock on `W-NEAR`: 40 EA
- Need: 100 EA

Show:

```text
Line 1: GENERIC-WASHER | Shelf: W-FAR  | Estimated: 80 | Outstanding: 80
Line 2: GENERIC-WASHER | Shelf: W-NEAR | Estimated: 20 | Outstanding: 20
```

Say:

> "Sometimes a material doesn't have a preferred shelf - no pick method,
> no shelf on the jobMaterial. The RPC doesn't refuse. It just orders
> every shelf with stock by available quantity descending and walks them
> top-down. The operator still gets a real, actionable list."

### 19.5 Tracked Item Bonus - Scenario B Repeated With Batches

Material setup:

- Item: `STEEL-PLATE-10MM`
- Tracking: batch-tracked
- Need: 100 EA
- Batch `B-001`: 50 EA at `B-01`
- Batch `B-002`: 30 EA at `B-01`
- Batch `B-003`: 40 EA at `B-02`

Show:

```text
Line 1: STEEL-PLATE-10MM | Shelf: B-01 | Estimated: 80 | Outstanding: 80
Line 2: STEEL-PLATE-10MM | Shelf: B-02 | Estimated: 20 | Outstanding: 20
```

Say:

> "Important nuance: the generator doesn't name specific batches. It
> tells the operator 'go to B-01 and pick 80 plates' - it's up to
> physical shelf rotation and the operator's scan to determine which
> batch gets consumed. The system records whatever they scan."

---

## 20. Picking - ERP Detail View

Open `PL-00001` for job `J-DEMO`.

### 20.1 The Three-Panel Layout

Show:

- Explorer on the left
- Detail content in the middle
- Properties rail on the right
- Donut chart and metadata
- Job link
- Customer
- Location
- Assignee
- Due date

Say:

> "Sales-order-style layout - left explorer for navigating between PLs,
> the main canvas for lines, and the properties rail on the right with
> the status donut, job link, customer, location, assignee, due date.
> Both side panels are resizable, both collapse."

### 20.2 Release The PL

Steps:

1. Click `Release` in the header.
2. Show status moves from Draft to Released.

Say:

> "Status moves from Draft to Released. Now it appears on the operator's
> MES queue and the soft-allocation calculation starts counting these
> outstanding quantities."

### 20.3 Pick A Non-Tracked Line

Steps:

1. Click the `BOLT-M8` line.
2. Open the detail card.
3. Enter `100` in the picked quantity field.
4. Submit.

Show:

- `pickedQuantity = 100`
- `outstandingQuantity = 0`
- PL status flips to In Progress on the first pick

Say:

> "Non-tracked items use a quantity form - no scanning needed."

### 20.4 Pick A Tracked Line - Scan Modal

Steps:

1. Click the `STEEL-PLATE-10MM` line for `B-01`, estimated 80.
2. The scan modal opens.
3. Show the dual tab: QR scan and manual list.
4. Pick batch `B-001` from the list.
5. Submit.

Validation to point at:

- Item match
- Status Available
- Shelf match
- UoM match

Expected auto-split:

| Line | Result |
|---|---|
| Original line | Closes with `pickedQuantity = 50` and `adjustedQuantity = 50` |
| Sibling line | Appears at the same shelf with `estimated = 30` |

Say:

> "The scanned batch is smaller than the line needs, so we don't reject -
> we auto-split. The current line gets adjusted to what was actually
> picked, and a new sibling line takes the leftover demand. The operator
> just scans the next batch into the new line."

### 20.5 Continue The Split

Steps:

1. Open the sibling line.
2. Scan `B-002`.
3. Confirm 30 EA.
4. Show outstanding hits 0.

### 20.6 Over-Pick Hard Block

Steps:

1. Open the second `BOLT-M8` line from `A-02`, estimated 100.
2. Try to enter `250`.
3. Submit.

Show:

- Error banner from the edge function
- Message should communicate that the quantity exceeds 2x tolerance

Say:

> "Hard ceiling at 2x the estimate. There's no soft tolerance tier in
> MVP - if the operator needs to over-pick that aggressively, they go
> back to the planner."

### 20.7 Unpick

Steps:

1. Stay on the same line.
2. Click `Unpick`.
3. Show `pickedQuantity` resets to 0.

Say:

> "While the PL is In Progress, any line can be unpicked. No ledger has
> posted yet, so there's nothing to roll back - it's just clearing the
> picked field."

### 20.8 Regenerate - Blocked

Steps:

1. Click `Regenerate` in the header.
2. Show confirmation dialog warning that picked lines exist.
3. Attempt the action.
4. Show the edge function error.

Say:

> "Regenerate is allowed on Draft and Released, and on In Progress only
> if nothing has been picked. Otherwise the operator has to either
> finish, cancel, or unpick everything first."

---

## 21. Confirmation And Ledger

### 21.1 Confirm With Everything Picked

Steps:

1. Pick the remaining lines so all `outstandingQuantity = 0`.
2. Click `Confirm` in the header.
3. The confirm modal opens.
4. Show no shortage reason is required.
5. Submit.

Show:

- Status becomes Confirmed.
- PL is locked.

Say:

> "Confirmation is the only place we touch the ledger. For each picked
> line we post an `itemLedger` Consumption entry with `documentType =
> Job Consumption`, `documentId = jobId` - not the PL id, because the PL
> is workflow, not accounting. `jobMaterial.quantityIssued` increases.
> Tracked entities flip to Consumed. Job's `pickingStatus` becomes
> Complete."

### 21.2 Verify The Ledger

Steps:

1. Open the job.
2. Go to the Ledger tab.
3. Show the new Consumption rows.

Point at:

- Document type
- Job id / job reference
- Consumed item
- Quantity
- Shelf / tracked entity where visible

### 21.3 Confirm With Outstanding - Shortage Path

Use a second PL where you intentionally pick less than the estimate.

Steps:

1. Open `PL-00002`.
2. Pick 80 of 100 `BOLT-M8`.
3. Click `Confirm`.
4. Show modal demands a shortage reason.
5. Enter a reason.
6. Submit.

Show:

- Status becomes Confirmed.
- `job.pickingStatus` becomes Partial if materials still have outstanding demand.
- If another PL is generated for the remainder and confirmed, status becomes Complete.

Say:

> "Two side-effects worth pointing out. First, the shortage reason is
> mandatory - we capture why before we let them close. Second, this
> action requires the approver permission, not just inventory_update.
> Permissions matter because confirming with outstanding has accounting
> consequences."

### 21.4 Reverse A Confirmed PL

Steps:

1. Open the just-confirmed PL.
2. Click `Reverse` in the header.

Show:

- Inverse ledger entries are posted.
- Positive adjustment / Job Reversal appears.
- `jobMaterial.quantityIssued` is decremented.
- Tracked entities go back to Available if still Consumed and untouched.
- PL status moves to Cancelled.

Say:

> "Full PL reversal - we don't expose line-level un-consume in MVP. It's
> all-or-nothing. The reverse posts positive adjustments against the same
> job, restores tracked entity status if it hasn't been touched since,
> and the PL itself is marked Cancelled so it never reopens."

### 21.5 PDF Print

Steps:

1. Click `Print`.
2. Open `/x/picking-list/<id>/pdf`.

Show:

- Printable layout
- Lines sorted by storage unit hierarchy / walking order
- Checkboxes per line
- Tracked entity slots
- Signature block at the bottom

Say:

> "When operators want paper, we sort by shelf hierarchy so the walk is
> efficient. Checkbox per line, batch IDs printed if tracked."

---

## 22. MES Operator Flow

Switch to the MES tab.

### 22.1 Assigned Picks List

Where:

- MES -> `/x/picking-lists`

Show:

- Big cards listing PLs assigned to the operator
- Item counts
- Location
- Top nav unfinished picks badge

Say:

> "Operator's home screen. Scan-first design, big tap targets, the
> Carbon orange dashboard pattern. The badge in the top nav counts
> unfinished picks."

### 22.2 Pick Screen

Steps:

1. Tap a card.
2. Open `picking-list.$id.tsx`.

Show:

- Lines listed as big buttons
- Each line shows item, shelf, and quantity

### 22.3 Inline Scan Modal

Steps:

1. Tap a tracked line.
2. Scan or pick a batch from the list.
3. Show validation feedback.

Say:

> "This is the exact scan UX we use for stock transfers - operators only
> have to learn it once. Camera scan, manual fallback, instant
> validation feedback. Auto-submits on a successful scan."

### 22.4 Confirm From MES

Steps:

1. Once everything is picked, tap `Confirm`.
2. Show summary screen.
3. If outstanding quantity exists, show shortage prompt.
4. Submit.

Say:

> "Same confirmation backend as ERP - the MES is just a different lens
> on the same edge function."

---

## 23. Dashboards And Filters

### 23.1 ERP Supervisor Dashboard

Where:

- `/x/inventory/picking-lists`

Show:

- Saved views
- `My Picks Today`
- `Awaiting Release`
- `Shortage Risk`
- `Ready to Confirm`
- Filters by status
- Filters by location
- Filters by assignee
- Filters by due date
- Quick-action chips on rows

Say:

> "Supervisor's airport-departures board for picking activity. Saved
> views cover the common operational questions, and the filters scale
> from a single-line warehouse to a multi-site customer."

### 23.2 Job Tab

Where:

- Job page -> Picking Lists tab

Show:

- All PLs ever generated for the job
- Status badges
- Links

---

## 24. P1 - Staging And Stock Transfers

### 24.1 Master Data

Where:

- Method `Widget-100` -> makeMethod -> `Finish-to Storage Unit`

Set:

- `Finish-to Storage Unit = FG-01`

Say:

> "The 'finish to' shelf says where completed product lands. It
> propagates to `job.finishToStorageUnitId` when the job is created."

### 24.2 Staging Assessment

Where:

- Job -> Staging tab

Show table columns:

- At pick location
- Elsewhere
- Shortage
- Suggested source shelf

Say:

> "Before we even release the job we can preview what staging moves are
> needed. The assessment RPC computes, per material, what's already in
> position versus what's sitting elsewhere in the same location."

### 24.3 Generate Transfers

Steps:

1. Tick materials with non-zero shortage.
2. Click `Generate Stock Transfers`.

Show:

- One or more `stockTransfer` records created.
- Lines have `fromStorageUnitId = sourceShelf`.
- Lines have `toStorageUnitId = jobMaterial.storageUnitId`.
- Transfer status is Released.

Say:

> "These are the same stock transfers we already had - we're just
> auto-creating them from the shortage assessment. Once the operator
> executes the transfers, the picking list at job-release time will find
> everything at the preferred shelf and no shortage line gets appended."

### 24.4 Round Trip

Steps:

1. Execute one of the transfers.
2. Move stock.
3. Go back to the job.
4. Click `Generate Picking List`.
5. Show the PL now allocates from the preferred shelf only.

---

## 25. P2 - Movements Feed

### 25.1 The Feed

Where:

- `/x/inventory/movements`

Show a flat list of every line currently in motion across the factory:

- Active `stockTransferLine` rows
- Active `pickingListLine` rows with `destinationStorageUnitId IS NOT NULL`
- Active `shipmentLine` rows

Required row state:

- Released or In Progress
- Outstanding quantity greater than zero

Columns to point at:

- Part
- Quantity
- From shelf
- To shelf
- Category chips
- Type
- Reference

Say:

> "The factory-wide airport-departures board. Pure UNION query over
> three existing tables - no new schema. Every internal move, every
> customer shipment, every stock transfer shows up here."

### 25.2 Destination Category Chips

Show rows with chips like:

- Quarantine
- Scrap
- Vehicle
- Customer

Say:

> "Category chips are computed live from `storageUnit.storageTypeIds`.
> If a shelf is tagged as Quarantine in master data, transfers going
> there light up with a Quarantine chip - no separate quarantine
> document type needed. The Customer chip is hardcoded on the shipment
> arm."

### 25.3 Filters

Steps:

1. Filter by Type = Picking List.
2. Filter by Destination Category = Quarantine.
3. Filter by Location.

Say:

> "Type, destination category, location, source and destination shelf,
> assignee - supervisors slice this however they want."

### 25.4 Drop-Off

Steps:

1. Confirm one of the PLs in another tab.
2. Refresh Movements.
3. Show the lines from that PL are gone.

Say:

> "Documents drop off the feed the moment they hit Confirmed or
> Cancelled. No archival logic - the filter is just status in Released
> or In Progress and outstanding greater than zero."

---

## 26. P3 - Production Incidents

### 26.1 Default Types

Where:

- ERP -> Settings -> Production -> Incident Types

Show seven seeded types per company:

- Equipment Failure
- Crop Disease
- Environmental Damage
- Quality Rejection
- Pest Damage
- Contamination
- Other

Say:

> "Each company gets seven default types when the first employee is
> linked. Companies can add their own - they're tenant-scoped."

### 26.2 Record A Blocking Incident

Pre-state:

- Job has an active PL.
- PL has a line for `STEEL-PLATE-10MM`.
- `estimatedQuantity = 100`.
- `pickedQuantity = 0`.

Steps:

1. Open Job -> Incidents tab.
2. Click `New Incident`.
3. Set Type = Quality Rejection.
4. Set Item = `STEEL-PLATE-10MM`.
5. Leave Tracked Entity blank, unless demonstrating entity-level adjustment.
6. Set Quantity Lost = 20.
7. Set `Impacts Picking List = ON`.
8. Save.

Show:

- Matching PL line shows `estimatedQuantity = 100` with strikethrough.
- New `adjustedQuantity = 80` sits next to it.
- `outstandingQuantity` recomputes to 80.
- Tooltip on the strikethrough links back to the incident.

Say:

> "The picking list line had `estimatedQuantity = 100`. We don't rewrite
> that snapshot - instead the trigger sets `adjustedQuantity = 80`. The
> outstanding-quantity generated column already uses
> `COALESCE(adjusted, estimated)`, so the operator's UI updates
> automatically. The original number is preserved with strikethrough so
> there's always an audit trail."

### 26.3 Non-Blocking Incident

Steps:

1. Create another incident for the same item.
2. Set `Impacts Picking List = OFF`.
3. Save.

Show:

- PL line is unchanged.
- Incident is still recorded and visible on the job's Incidents tab.

Say:

> "Not every incident should reduce demand - sometimes you're just
> logging an issue for the books. The toggle decides whether the trigger
> propagates."

### 26.4 Confirm With The Adjustment

Steps:

1. Operator picks 80 plates.
2. Confirm the PL.
3. Show the consumption ledger.
4. Point at quantity 80.
5. Show `job.pickingStatus = Complete`.

Say:

> "Because the operator picked the adjusted quantity, outstanding is
> zero and no shortage reason is needed. The ledger records exactly what
> was consumed."

---

## 27. Wrap-Up - The 30-Second Summary

Say:

> "Recap in one breath:
>
> Generate - auto on Planned or Ready, gated by three opt-in levels.
> Allocate - RPC walks shelves preferred-first, then by available qty
> descending. Handles no preferred, single shelf, multi-shelf cascade,
> and shortage. Pick - quantity form for untracked, scan modal for
> tracked, auto-split when a batch is smaller than the line. Confirm -
> only step that hits the ledger. Document id is the job, not the PL.
> Reverse - full PL rollback, positive ledger entries, tracked entities
> restored. Staging - generates stock transfers from a shortage
> assessment so the eventual PL allocates cleanly. Movements - single
> feed of every in-flight transfer, PL line, and outbound shipment, with
> destination-category chips. Incidents - records what was lost; if it
> impacts an active PL, the trigger reduces line demand via
> `adjustedQuantity`, no operator intervention needed.
>
> All P0 through P3. No new accounting model, no waves, no hard
> reservations - just a workflow layer on top of the existing ledger and
> stock transfer plumbing."

---

## Appendix A - Cheat Sheet Of Edge Function Ops

| Op | Status guard | Side-effects |
|---|---|---|
| `generatePickingList` | none | Creates PL header and calls RPC |
| `regeneratePickingList` | Draft, Released, In Progress with no picks | Wipes lines and re-runs RPC |
| `pickInventoryLine` | Released, In Progress | Updates `pickedQuantity`; hard block at 2x |
| `pickTrackedEntityLine` | Released, In Progress | Validates entity, sets `pickedTrackedEntityId`, auto-splits if entity qty is less than outstanding |
| `unpickLine` | In Progress | Resets `pickedQuantity = 0` |
| `releasePickingList` | Draft | Moves to Released |
| `confirmPickingList` | Released, In Progress | Posts Consumption ledger, locks PL, requires shortage reason if outstanding > 0 |
| `cancelPickingList` | Any non-Confirmed | Moves to Cancelled |
| `reversePickingList` | Confirmed | Inverse ledger, restores tracked entities, moves to Cancelled |
| `stageJob` (P1) | n/a | Returns staging assessment |
| `generateStockTransfer` (P1) | n/a | Creates stockTransfer and lines |

---

## Appendix B - Status / Picking Status Matrix

| Trigger | `job.pickingStatus` |
|---|---|
| No qualifying materials | Not Required |
| Job not yet released | Not Generated |
| PL exists in Draft / Released | Generated |
| Any PL In Progress | In Progress |
| Some PLs confirmed, outstanding remains | Partial |
| All required qty issued | Complete |

---

## Appendix C - Files To Cite If Anyone Asks

| Area | File |
|---|---|
| Multi-shelf RPC | `packages/database/supabase/migrations/20260507000000_picking-lists-multi-shelf-rpc.sql` |
| Auto-gen trigger | `packages/database/supabase/migrations/20260507000001_picking-lists-auto-generate-trigger.sql` |
| Overpick guard | `packages/database/supabase/migrations/20260507000002_picking-lists-overpick-tolerance.sql` |
| Staging RPC | `packages/database/supabase/migrations/20260507000004_job-staging-assessment.sql` |
| Incidents | `packages/database/supabase/migrations/20260507000009_production-incidents.sql` |
| Edge function | `packages/database/supabase/functions/pick/index.ts` |
| ERP detail route | `apps/erp/app/routes/x+/picking-list+/$id.tsx` |
| ERP dashboard | `apps/erp/app/routes/x+/inventory+/picking-lists.tsx` |
| Movements feed | `apps/erp/app/routes/x+/inventory+/movements.tsx` |
| Job staging tab | `apps/erp/app/routes/x+/job+/$jobId.staging.tsx` |
| Job incidents | `apps/erp/app/routes/x+/job+/$jobId.incidents.tsx` |
| MES list | `apps/mes/app/routes/x+/picking-lists.tsx` |
| MES pick screen | `apps/mes/app/routes/x+/picking-list.$id.tsx` |
| MES scan modal | `apps/mes/app/routes/x+/picking-list.$id.scan.$lineId.tsx` |
| Components | `apps/erp/app/modules/inventory/ui/PickingLists/` |
