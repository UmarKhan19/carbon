# MES Feedback — Status (caveman)

Branch `poc/mes-assembly-view`. ✅ done · 🟡 partial · ⬜ todo.

## Phase 1 — mobile UI ✅ (commit 0539c1097)
- ✅ buttons `lg` (operator actions); tiny material tap target 20px->36px
- ✅ drop "Assy" -> "Completed item"
- ✅ fullscreen image + pinch/wheel zoom + pan (`ImageZoomViewer.tsx`)

## Phase 2 — part/tool ↔ step
- ✅ migration: `*OperationStepId` FK on 6 tables (97b12d601)
- ✅ types: +6 cols (hand-added, regen polluted by restored DB)
- ✅ MES: parts filtered per step + demo seeded on jo_8651 (97b12d601)
- ✅ author tool->step, BOP editor add-tool form (cda500d8c)
- ✅ author part->step, BoM editor (295f0fc63)
- ✅ get_method_tree RPC surfaces step (7ce1bd62f)
- ✅ get-method copies part->step to new jobs, both job paths (7ce1bd62f)
- ✅ fix: top-level (root assembly) materials carry step (6b26589c9) — RPC verified
- ✅ get-method copy tool->step (tools moved after steps in op loop; both job paths)
- ✅ MES tools filtered per step (loads `jobOperationTool` by operation, carries `jobOperationStepId`)
- ✅ tool edit-form step picker (add + edit forms)

**Phase 2 = end-to-end done (part path + tool tail).** See [MES-PHASE2-DONE.md](MES-PHASE2-DONE.md)
for what/how and [MES-PHASE2-TEST-PLAN.md](MES-PHASE2-TEST-PLAN.md) for the manual UI test cases.
Known gap: `quoteLineToJob` get-method path copies neither part->step nor tool->step (parity with
the part-link scope); jobs created directly from an item method (the common path) are unaffected.

## Verify part path (you do)
1. `pnpm db:migrate` -> applies 20260628163000 (idempotent, already live in DB)
2. create job from method w/ part->step set
3. `docker exec carbon-carbon-postgres-1 psql -U postgres -d postgres -c "SELECT \"jobOperationStepId\", count(*) FROM \"jobMaterial\" WHERE \"jobId\"='<id>' GROUP BY 1;"`

## Phase 3 — behavioral ⬜ (not started)
- ⬜ auto-start job when operator starts step (productionEvent + jobStatus exist -> small server add)
- ⬜ MES preview from BOP tab, no live job (render assembly view vs methodOperation; read-only)
- ⬜ refresh BOP steps on live job w/o closing (realtime channel partly there)

## Phase 4 — remaining ⬜ (not started)

### Op Type + Kind merge (Brad)
- 🟡 design agreed: single op field `Standard|Assembly|Inspection|Outside Processing`, drop Batch (=tracking type), keep process.processType (Inside/Outside/both). ⬜ impl = big refactor (~29 `=== "Outside"` sites + collapse operationType/operationKind + view router + BOP picker)

### Tool tail (finish Phase 2 tools) ✅ DONE
- ✅ get-method copy tool->step (tools-after-steps reorder in op loop)
- ✅ MES tools filtered per step (loads jobOperationTool, not method-via-process)
- ✅ tool edit-form step picker

### Production/job
- ⬜ shortage flag -> close w/o consuming stock -> auto-raise future job
- ⬜ passive step timer (cycle time) · ⬜ mgr complete-all override
- ⬜ step overview (finished+BoM+tools, one-tap return) [easier post part/tool-step]

### Content authoring
- ⬜ image resize/grid in editor · ⬜ annotation · ⬜ tool hotspots

### MES UX
- ⬜ navigate/filter incomplete steps · 🟡 flick serials (pager exists, swipe ⬜)
- ⬜ hands-free advance btn

### Quality
- ⬜ NCR->step · ⬜ parts/tools on NCR

### 💡 suggested (low prio)
- revision history · copy/clone steps · operator dashboard · step sign-off · rework flag · NCR trend · first-pass-rate

## Founder bullets map
- ✅ bigger buttons · ✅ fullscreen+pan · ✅ drop Assy
- ✅ part->step · ✅ serial scan-at-step (scan exists, filtered per step)
- ✅ link tools->step (author ✅, copy ✅, MES filter ✅)
- ⬜ auto-start job on step start
- ⬜ MES preview from BOP (no live job)
- ⬜ shortage flag -> future job
- 🟡 merge Type+Kind (design only)

## Notes
- demo job: MES `:3001/x/assembly/jo_8651wnMAbSiZMvGVF62tyh` (company "Minimal X", login sidgaikwad460)
- types regen pollutes (restored 1267-co DB) -> never commit full regen; hand-add cols
