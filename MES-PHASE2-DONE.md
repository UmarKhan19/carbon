# MES Phase 2 — Part/Tool ↔ Step — Implementation (what & how)

Branch `poc/mes-assembly-view`. This documents the **completed Phase 2**: associating a
material (part/consumable) and a tool with a specific **operation step**, so the MES
assembly view shows only what's relevant to the step the operator is on — and the operator
scans a serial/batch part at the step where it's actually used.

> Companion docs: [MES-FEEDBACK-STATUS.md](MES-FEEDBACK-STATUS.md) (overall roadmap) and
> [MES-PHASE2-TEST-PLAN.md](MES-PHASE2-TEST-PLAN.md) (manual UI test cases).

---

## 1. The idea in one line

A material/tool is **owned by an operation** and may be **optionally assigned to one step**
of that operation. The assignment is a **nullable FK** — `NULL = applies to the whole
operation` (shown on every step, the legacy behavior). The link is authored on the **method
template** (ERP) and **copied to the job** by the `get-method` edge function, exactly like
steps, slides, tools, and parameters already are. The MES then filters per step.

```
methodOperationStep (a step of an operation)
        ▲                       ▲
        │ methodOperationStepId │ methodOperationStepId   (NULL = whole operation)
        │                       │
  methodMaterial           methodOperationTool      ← authored in ERP (BoM / BoP editors)
        │                       │
        │  get-method copy (method-step → job-step map)
        ▼                       ▼
  jobMaterial.jobOperationStepId   jobOperationTool.jobOperationStepId
        │                       │
        ▼                       ▼
        MES assembly view filters materials & tools to the current step
```

---

## 2. Data model (migration `20260628145000_operation-step-part-tool-link.sql`)

Six nullable FK columns added (3 tiers × {material, tool}), each indexed:

| Table | Column | References | On delete |
|-------|--------|-----------|-----------|
| `methodMaterial` | `methodOperationStepId` | `methodOperationStep(id)` | `SET NULL` |
| `jobMaterial` | `jobOperationStepId` | `jobOperationStep(id)` | `SET NULL` |
| `quoteMaterial` | `quoteOperationStepId` | `quoteOperationStep(id)` | `SET NULL` |
| `methodOperationTool` | `methodOperationStepId` | `methodOperationStep(id)` | `SET NULL` |
| `jobOperationTool` | `jobOperationStepId` | `jobOperationStep(id)` | `SET NULL` |
| `quoteOperationTool` | `quoteOperationStepId` | `quoteOperationStep(id)` | `SET NULL` |

- **Backward compatible:** every existing row stays `NULL` (operation-level).
- **`ON DELETE SET NULL`** is deliberate — the material/tool belongs to the *operation* and
  is only *assigned* to a step. Deleting the step must revert the link to operation-level,
  not delete the material/tool.
- The 6 columns were hand-added to the generated types (`packages/database/src/types.ts`
  and `packages/database/supabase/functions/lib/types.ts`) because a full regen is polluted
  by the restored DB — **never commit a full type regen on this branch; hand-add columns.**

---

## 3. Authoring (ERP)

### 3a. Part → step (BoM editor)
- `methodMaterialValidator` gained optional `methodOperationStepId` (NULL = whole operation).
  `upsertMethodMaterial` already spreads the field, so it persists.
- `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx`: the operation row's **Step**
  picker lists the selected operation's steps. Changing the operation clears the step.

### 3b. Tool → step (BoP editor) — `ToolsForm` + `ToolsListItem`
File: `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx`.
- **Add form** (`ToolsForm`): renders an optional **Step** `<Select>` when the operation has
  steps (empty = whole operation).
- **Edit form** (`ToolsListItem`): now also renders the same Step picker and pre-selects the
  tool's current step (`...(methodOperationStepId ? { methodOperationStepId } : {})` spread
  into `defaultValues` — bypasses the excess-property check since the field isn't in the
  tier-agnostic `operationToolValidator`).
- Routes `operation.tool.new.tsx` / `operation.tool.$id.tsx` read `methodOperationStepId`
  **straight from `formData`** (not from `validation.data`) so the shared
  `operationToolValidator` stays tier-agnostic — job/quote tools use a *different* column.
  Both pass it to `upsertMethodOperationTool`, which accepts the optional field.
- `OperationTool` type (`apps/erp/app/modules/shared/types.ts`) declares
  `methodOperationStepId?: string | null` so the loaded `methodOperationTool(*)` row carries
  it into the edit form.

---

## 4. Copy to the job (`get-method` edge function)

File: `packages/database/supabase/functions/get-method/index.ts`.

### 4a. Parts (done earlier in the branch)
Both job-copy paths (`itemToJob`, `itemToJobMakeMethod`) build a **method-step → job-step
map** (`methodStepsToJobSteps`) when steps are inserted (a bulk insert preserves order, so
`insertedSteps[i] ↔ methodOperationStep[i]`). `jobMaterial.jobOperationStepId` is then set
from that map; unmapped → `null`. The `get_method_tree` RPC was recreated to surface
`methodMaterial.methodOperationStepId` on material tree nodes
(`20260628161500` / `20260628163000`), including top-level (root assembly) materials.

### 4b. Tools (this change) — the key fix
The operation loop previously inserted **tools before steps**, so the step map didn't exist
yet when tools were written. Fix: in both job paths, the `jobOperationTool` insert was
**moved to after the step insert**, and now maps the link:

```ts
jobOperationStepId: tool.methodOperationStepId
  ? methodStepsToJobSteps[tool.methodOperationStepId] ?? null
  : null,
```

- Tools are still copied for procedure-based operations (which have no steps) — they simply
  carry `jobOperationStepId: null`.
- The accumulating `methodStepsToJobSteps` map is safe across operations because step ids
  are globally unique; a tool's step always belongs to the tool's own operation, inserted in
  the same iteration just before.

**Scope / known gap:** only the two job paths used by the part-link copy were changed
(`itemToJob`, `itemToJobMakeMethod`). The `quoteLineToJob` path (quote → job) copies neither
part→step nor tool→step — parity with the existing part-link scope. Jobs created directly
from an item's method (the common path, e.g. the demo job) are fully covered.

---

## 5. MES per-step filtering

### 5a. Tools service — read the job's own tools, not the method template
File: `apps/mes/app/services/operations.service.ts`. `getToolsByProcessId` (which looked up
*any* method operation by `processId`) was replaced by **`getToolsByOperationId`**, which
reads `jobOperationTool` for the actual operation and selects `jobOperationStepId`:

```ts
client.from("jobOperationTool")
  .select("quantity, jobOperationStepId, item:toolId(id, name, type)")
  .eq("operationId", operationId);
```

The assembly route (`apps/mes/app/routes/x+/assembly.$operationId.tsx`) calls it with
`operationId` instead of `op.processId`.

### 5b. Materials service (done earlier)
`getJobMaterialsByOperationId` attaches `jobOperationStepId` from the base `jobMaterial`
table (the make-method view doesn't carry the new FK).

### 5c. Assembly view filter — `apps/mes/app/components/AssemblyView.tsx`
Both materials and tools are filtered to the current step with the identical rule:

```ts
// material applies to this step if it's unscoped (null) or scoped to this step
m.jobOperationStepId == null || m.jobOperationStepId === (step?.id ?? null)
```

`stepTools` was added mirroring the existing `rawMaterials` filter, and the Tools sidebar
section now renders `stepTools` instead of all `tools`. Serial/batch **scan-at-step** falls
out for free: the per-step material list drives the "Scan Part" pre-selection, so the
operator scans the tracked part on the step where it's used.

---

## 6. Files touched (this change)

| File | Change |
|------|--------|
| `packages/database/supabase/functions/get-method/index.ts` | Move `jobOperationTool` insert after steps in `itemToJob` + `itemToJobMakeMethod`; map `jobOperationStepId`. |
| `apps/mes/app/services/operations.service.ts` | `getToolsByProcessId` → `getToolsByOperationId` (reads `jobOperationTool`, carries `jobOperationStepId`). |
| `apps/mes/app/routes/x+/assembly.$operationId.tsx` | Call `getToolsByOperationId(serviceRole, operationId)`. |
| `apps/mes/app/components/AssemblyView.tsx` | `tools` type gains `jobOperationStepId`; add `stepTools` per-step filter; render `stepTools`. |
| `apps/erp/app/modules/shared/types.ts` | `OperationTool` gains optional `methodOperationStepId`. |
| `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx` | Tool **edit** form gets the Step picker + pre-selected default; `steps` threaded to `ToolsListItem`. |

(Authoring of part→step, tool→step add-form, the migration, types, and the part copy landed
in earlier commits `97b12d601`, `cda500d8c`, `295f0fc63`, `7ce1bd62f`, `6b26589c9`.)

## 7. Verification done

- `pnpm --filter mes typecheck` → 0 errors.
- `pnpm --filter erp typecheck` → 0 errors.
- `get-method` is a Deno edge function (not in the tsc graph); changes are a structural
  reorder + one mapped field. Runtime verification is via the manual test plan (create a job
  and inspect `jobOperationTool.jobOperationStepId`).
