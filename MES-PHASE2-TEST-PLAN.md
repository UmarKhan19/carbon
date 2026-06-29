# MES Phase 2 — Manual UI Test Plan (Phase 1 + Phase 2, end to end)

Step-by-step manual test cases to exercise **everything up to and including Phase 2**:
mobile assembly UI (Phase 1) and part/tool ↔ step authoring → copy-to-job → per-step
filtering in the MES (Phase 2). Built from scratch so every dependency (items, method,
steps, **step image uploads**, materials, tools, a serial-tracked job) is created by you,
nothing assumed.

See [MES-PHASE2-DONE.md](MES-PHASE2-DONE.md) for what each feature does under the hood.

---

## 0. Environment & conventions

| Thing | Value |
|-------|-------|
| ERP | http://localhost:3000 |
| MES | http://localhost:3001 |
| Login | `sidgaikwad460@gmail.com` (dev bypass) |
| Company | **Minimal X** |
| Assembly view URL | `http://localhost:3001/x/assembly/{jobOperationId}` |
| DB shell | `docker exec carbon-carbon-postgres-1 psql -U postgres -d postgres -c "<SQL>"` |

**Precondition:** local stack is up (`pnpm dev` / `crbn up`) and migrations applied
(`pnpm db:migrate` — the Phase 2 migration `20260628145000` is idempotent and already live).
The `get-method` edge function is live-mounted by the docker `edge-runtime` container, so the
code change in this branch is picked up with no deploy step.

> **Legend:** ✅ = expected pass. Each case lists **Steps** then **Expected**.

---

## 1. Test data setup (ERP)

### TC-1.1 — Create the components (materials) and a tool
**Steps**
1. ERP → **Items → Parts → New**. Create **3 parts**:
   - `TEST-BRACKET` (tracking: **Inventory / none**)
   - `TEST-BOLT` (tracking: **Inventory / none**)
   - `TEST-MOTOR` (tracking: **Serial**) ← used later for scan-at-step
2. ERP → **Items → Tools → New** (or Parts with type Tool). Create **2 tools**:
   - `TEST-DRIVER` (a screwdriver)
   - `TEST-TORQUE` (a torque wrench)
3. ERP → **Items → Parts → New**: create the **assembly parent** `TEST-ASSY`
   (tracking: **Serial** so the unit axis + scan-at-step are exercised). Give it a
   thumbnail image if possible (Properties → image) — this becomes the **"Completed item"**
   image in the MES.

**Expected** ✅ All 6 items exist and open without error.

---

## 2. Method authoring — operations, steps, step images (ERP)

Open `TEST-ASSY` → **Manufacturing / Methods** → make sure you're on the **active** make
method (Draft is editable; Active/Archived are frozen).

### TC-2.1 — Create an Assembly operation
**Steps**
1. Go to the **Bill of Process** tab.
2. Add an operation, e.g. **"Final Assembly"**, pick a Process + Work Center.
3. Set the operation **Kind = `Assembly`** (this is what routes the operator to the
   assembly view in the MES — `Operation`/`Inspection` render different views).
4. Save.

**Expected** ✅ Operation saved with Kind = Assembly.

### TC-2.2 — Add multiple steps with reference images
**Steps**
1. On the "Final Assembly" operation, add **3 steps**:
   - **Step 1** "Mount bracket" — type **Task**
   - **Step 2** "Install motor" — type **Task**
   - **Step 3** "Torque bolts" — type **Measurement** (so the MES shows a Record modal),
     give it a unit (e.g. `Nm`) and min/max.
2. For **Step 1** and **Step 2**, **upload a reference image** each (the step's slides /
   reference image uploader). Use two visibly different images.
3. Optionally add a second slide to Step 1 to test multi-slide thumbnails.

**Expected** ✅ 3 steps listed in order; Step 1/2 each show their uploaded slide thumbnail.

---

## 3. Part → step authoring (ERP, BoM editor)

### TC-3.1 — Assign materials to steps
**Steps**
1. Go to the **Bill of Materials** tab of `TEST-ASSY`.
2. Add materials and set the **operation** to "Final Assembly" on each:
   - `TEST-BRACKET` → operation "Final Assembly", **Step = "Mount bracket"**
   - `TEST-MOTOR` (serial) → operation "Final Assembly", **Step = "Install motor"**
   - `TEST-BOLT` → operation "Final Assembly", **Step = (leave empty)** ← operation-level
3. Save each.

**Expected** ✅
- The **Step** picker only lists steps of the selected operation.
- Changing the operation on a row **clears** the step.
- `TEST-BOLT` saved with no step (whole-operation).

### TC-3.2 — DB check (method side)
**Steps** — run:
```sql
SELECT mm."itemId", mos."name" AS step
FROM "methodMaterial" mm
LEFT JOIN "methodOperationStep" mos ON mos."id" = mm."methodOperationStepId"
WHERE mm."makeMethodId" IN (
  SELECT "id" FROM "makeMethod" WHERE "itemId" = 'TEST-ASSY'
);
```
**Expected** ✅ BRACKET→"Mount bracket", MOTOR→"Install motor", BOLT→NULL.

---

## 4. Tool → step authoring (ERP, BoP editor)

### TC-4.1 — Add tool with a step (add form)
**Steps**
1. Bill of Process → "Final Assembly" operation → **Tools** section.
2. Add `TEST-DRIVER`, quantity 1, **Step = "Mount bracket"**. Save.
3. Add `TEST-TORQUE`, quantity 1, **Step = "Torque bolts"**. Save.
4. Add `TEST-DRIVER` again (or a 3rd tool) with **Step left empty** (operation-level). Save.

**Expected** ✅ The **Step** `<Select>` appears only because the operation has steps; empty
is allowed (operation-level). All tools appear in the list.

### TC-4.2 — Edit an existing tool's step (★ new in this change)
**Steps**
1. In the tools list, open the **⋮ menu → Edit** on `TEST-TORQUE`.
2. Confirm the edit form shows a **Step** picker **pre-selected to "Torque bolts"**.
3. Change it to **"Install motor"**, Save.
4. Re-open Edit to confirm it persisted; then change it back to "Torque bolts".

**Expected** ✅ The edit form has the Step picker, pre-populated with the current step, and
the change persists. (Before this change, only the *add* form had the picker.)

### TC-4.3 — DB check (method side)
```sql
SELECT t."id", mos."name" AS step
FROM "methodOperationTool" t
LEFT JOIN "methodOperationStep" mos ON mos."id" = t."methodOperationStepId"
WHERE t."operationId" IN (
  SELECT "id" FROM "methodOperation"
  WHERE "makeMethodId" IN (SELECT "id" FROM "makeMethod" WHERE "itemId" = 'TEST-ASSY')
);
```
**Expected** ✅ DRIVER→"Mount bracket", TORQUE→"Torque bolts", and the 3rd tool→NULL.

---

## 5. Create a job (the get-method copy)

### TC-5.1 — Create a job from the method
**Steps**
1. ERP → **Production → Jobs → New**.
2. Item = `TEST-ASSY`, **Quantity = 2** (exercises the multi-unit axis), pick a location +
   dates, create.
3. Open the job; confirm it pulled the method (operations, steps, materials, tools present).
   If prompted to "Get Method", do it.

**Expected** ✅ Job created with the Final Assembly operation, its 3 steps, the 3 materials,
and the 3 tools.

### TC-5.2 — DB check: part → step copied to job
```sql
SELECT jm."itemId", jos."name" AS step
FROM "jobMaterial" jm
LEFT JOIN "jobOperationStep" jos ON jos."id" = jm."jobOperationStepId"
WHERE jm."jobId" = '<JOB_ID>';
```
**Expected** ✅ BRACKET→"Mount bracket", MOTOR→"Install motor", BOLT→NULL — i.e. the method
links were carried onto the job.

### TC-5.3 — DB check: tool → step copied to job (★ the core of this change)
```sql
SELECT jot."toolId", jos."name" AS step
FROM "jobOperationTool" jot
LEFT JOIN "jobOperationStep" jos ON jos."id" = jot."jobOperationStepId"
WHERE jot."operationId" IN (
  SELECT "id" FROM "jobOperation" WHERE "jobId" = '<JOB_ID>'
);
```
**Expected** ✅ DRIVER→"Mount bracket", TORQUE→"Torque bolts", 3rd tool→NULL.
**This is the regression that would have been all-NULL before the get-method fix.**

> Get the operationId for the MES URL:
> ```sql
> SELECT "id", "description", "operationKind" FROM "jobOperation" WHERE "jobId" = '<JOB_ID>';
> ```

---

## 6. MES assembly view — per-step filtering (Phase 2 payoff)

Open `http://localhost:3001/x/assembly/{jobOperationId}` (the Assembly-kind operation from
TC-5.3). The steps bar shows 1/3.

### TC-6.1 — Per-step **materials**
**Steps** — page through steps via the segmented steps bar (or Skip):
1. **Step 1 "Mount bracket":** Parts sidebar.
2. **Step 2 "Install motor":** Parts sidebar.
3. **Step 3 "Torque bolts":** Parts sidebar.

**Expected** ✅
- Step 1 shows **BRACKET** + **BOLT** (BOLT is operation-level → every step).
- Step 2 shows **MOTOR** + **BOLT**.
- Step 3 shows **BOLT** only.
- The operation-level BOLT appears on **all** steps; step-scoped parts appear only on theirs.

### TC-6.2 — Per-step **tools** (★ new)
**Steps** — same paging, look at the **Tools** sidebar section.
**Expected** ✅
- Step 1 → **DRIVER** + the operation-level 3rd tool.
- Step 2 → operation-level tool only.
- Step 3 → **TORQUE** + operation-level tool.
- Tools section hides entirely on a step with no applicable tools (only if there's no
  operation-level tool — here the 3rd tool keeps it visible on every step).

### TC-6.3 — Per-step **reference images** + "Completed item"
**Steps**
1. On **Step 1**, the main image area defaults to the step's **first uploaded slide**;
   thumbnails for each slide appear; a **"Completed item"** button shows the assembly
   thumbnail.
2. Click a different slide thumbnail → main image switches; caption (if set) shows.
3. Click **"Completed item"** → main image becomes the `TEST-ASSY` thumbnail.
4. Go to **Step 3** (no slides) → main image falls back to the **"Completed item"** image;
   no "No reference image" unless the assembly has no thumbnail either.

**Expected** ✅ Reference art is per-step; "Completed item" always available when the parent
has a thumbnail.

---

## 7. Phase 1 — mobile/touch UI

### TC-7.1 — Big operator buttons & tap targets
**Steps** Resize the browser to a phone/tablet width (or use device emulation). Inspect the
**Complete**, **Flag issue**, timer Start/Pause, and material issue/scan buttons.
**Expected** ✅ Primary operator actions are `lg`; material issue/scan tap target is ~36px
(not the old 20px); everything is comfortably tappable.

### TC-7.2 — Fullscreen image with pinch / wheel zoom + pan
**Steps**
1. On a step with a reference image, tap the main image (the expand affordance, top-right).
2. In the fullscreen viewer: **mouse wheel** to zoom; **drag** to pan; on touch, **pinch**
   to zoom and drag to pan. Close it.
**Expected** ✅ `ImageZoomViewer` opens fullscreen, zooms via wheel/pinch, pans, and closes.

### TC-7.3 — "Completed item" label (was "Assy")
**Expected** ✅ The finished-product button reads **"Completed item"** (no "Assy").

---

## 8. Serial scan-at-step (Phase 2 follow-through)

### TC-8.1 — Scan the serial part on its step
**Precondition** `TEST-MOTOR` is Serial and assigned to Step 2; the job parent `TEST-ASSY`
is Serial (Quantity 2 → 2 units).
**Steps**
1. In the assembly view, note the **Unit X of N** pager in the header (2 units).
2. Go to **Step 2 "Install motor"**. The **Scan Part** action / per-row QR targets the
   tracked **MOTOR** (the first tracked material that still needs issuing).
3. Open the issue/scan modal and issue/scan a serial for MOTOR against the current unit.
4. Switch to **Step 1** — MOTOR is **not** listed (it's scoped to Step 2), so it can't be
   mis-scanned there.

**Expected** ✅ The serial part is scannable only on the step where it's used; "Scan Part"
pre-selects the tracked material relevant to the current step + unit.

---

## 9. Step completion, undo, multi-unit

### TC-9.1 — Complete & undo steps
**Steps**
1. Step 1 (Task) → **Mark done** → row turns green, steps bar segment turns green, counter
   increments. **Undo** (only the operator who recorded it can undo).
2. Step 3 (Measurement) → **Record** → enter a value within min/max → recorded.
3. Use the header **Unit** pager to switch to unit 2 → step completion state is **per unit**
   (unit 2 starts un-done).

**Expected** ✅ Per-unit step records; undo restricted to the recorder; "X / N done" tracks
the current unit.

---

## 10. Backward-compatibility & edge cases

### TC-10.1 — Legacy job with no step assignments
**Steps** Open an **older** job (created before Phase 2, e.g. the demo `jo_8651`) in the
assembly view; page through steps.
**Expected** ✅ All materials and tools are operation-level (NULL) and show on **every**
step — no regression; nothing disappears.

### TC-10.2 — Delete a step reverts the link (ON DELETE SET NULL)
**Steps**
1. In the method BoP, delete a step that has a tool/material assigned (e.g. delete a spare
   test step you assigned something to), or test on a scratch operation.
2. Re-check that material/tool.
**Expected** ✅ The material/tool is **not** deleted; its `*OperationStepId` becomes NULL
(reverts to operation-level). The item stays on the operation.

### TC-10.3 — Operation with a procedure (no steps)
**Steps** Confirm a procedure-based operation still copies its tools to the job.
**Expected** ✅ Tools copied with `jobOperationStepId = NULL` (no steps to scope to); no
errors.

### TC-10.4 — Known gap: quote → job path
**Note (not a bug):** a job created via the **quote-line → job** conversion does **not**
copy part→step or tool→step (parity with the existing part-link scope). Jobs created
directly from an item method (TC-5) are fully covered. Document, don't fail.

---

## 11. Regression sweep (should be unaffected)

| Check | Expected |
|-------|----------|
| Create a job from a method with **no** step assignments | Materials/tools all show on every step |
| Issue a non-tracked material | Works as before from any step it appears on |
| Timer Start/Pause (Setup/Labor/Machine) | Unchanged |
| Complete / Scrap / Rework / Finish flows | Unchanged |
| Open NCRs, Containment, Parameters sidebars | Unchanged |
| `pnpm --filter mes typecheck`, `pnpm --filter erp typecheck` | 0 errors |

---

## Quick DB cheat-sheet

```sql
-- find your job id
SELECT "id", "jobId", "itemId" FROM "job" WHERE "itemId" = 'TEST-ASSY' ORDER BY "createdAt" DESC LIMIT 5;

-- parts per step on the job
SELECT jm."itemId", jos."name" FROM "jobMaterial" jm
LEFT JOIN "jobOperationStep" jos ON jos."id" = jm."jobOperationStepId"
WHERE jm."jobId" = '<JOB_ID>';

-- tools per step on the job  (the core of this change)
SELECT jot."toolId", jos."name" FROM "jobOperationTool" jot
LEFT JOIN "jobOperationStep" jos ON jos."id" = jot."jobOperationStepId"
WHERE jot."operationId" IN (SELECT "id" FROM "jobOperation" WHERE "jobId" = '<JOB_ID>');
```
