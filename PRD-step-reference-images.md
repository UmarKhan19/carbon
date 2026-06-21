# PRD — Step Reference Images ("Slides")

Status: Draft · Owner: MES execution-views · Related: [CONTEXT.md](CONTEXT.md), `docs/adr/0004-shared-mes-execution-core.md`, `apps/mes/app/components/AssemblyView.tsx`

## 1. Problem

Operators in the Assembly (and soon Inspection) view need **reference imagery per build step** — "here's what this looks like when done / where this part goes." Today there is no first-class way to attach a reference image to a job-operation step:

- Images are **embedded inside the step's rich-text `description`** (TipTap `image` nodes) and scraped back out at render time by `extractImages()` in `AssemblyView.tsx`.
- `jobOperationStep` / `methodOperationStep` have **no media column** (only `description`, plus `fileTypes` which governs *operator File-record uploads*, not reference art).
- The feature is **hard-disabled**: `const SHOW_REFERENCE_IMAGES = false` in `AssemblyView.tsx` — every step shows the "No reference image" placeholder.

Consequences: image order/captions aren't data, rendering depends on a heuristic, reference art is tangled with instruction prose, and there's no clean "page through reference photos" UX.

## 2. Goal

Introduce a **slide** primitive: a first-class child of a step that holds **one image** (plus optional caption and order). A step has zero or more slides; the execution views render them as a per-step image carousel. Slides are authored on the **method** (template) and copied to the **job/quote** operation by `get-method`, exactly like steps, materials, tools, and parameters.

### Non-goals
- Replacing the rich-text `description` (prose stays; slides are separate reference media).
- Video / 3D model slides (the CAD model already has its own tab/panel).
- Operator-captured photos at run time (that is the existing **File** step-record type; out of scope).
- Annotation/markup tooling on images.

## 3. Definitions

- **Slide** — one reference image attached to a step, with an optional caption and a `sortOrder`. The atomic unit operators page through.
- **Step** — an existing `methodOperationStep` / `jobOperationStep` (type Task/Measurement/…). Slides are reference media on the step, *not* a step `type`.

## 4. Proposed model

### 4.1 Schema (new tables)

Mirror the step-copy chain (template → job/quote):

- `methodOperationStepSlide` (template, authored in ERP)
- `jobOperationStepSlide` (copied per job)
- `quoteOperationStepSlide` (copied per quote)

Columns (each table):

| column | type | notes |
|---|---|---|
| `id` | text PK | `id('slide')` default |
| `stepId` | text FK → the matching `*OperationStep`.id, `ON DELETE CASCADE` | |
| `imagePath` | text | storage path (private bucket), same convention as other uploads |
| `caption` | text null | optional |
| `sortOrder` | double precision | advisory order within the step |
| `companyId` | text FK | RLS scope |
| `createdAt/By`, `updatedAt/By` | standard audit | |

RLS: identical policies to the parent step tables (company-scoped; MES read for assigned operations).

### 4.2 get-method copy

In `packages/database/supabase/functions/get-method/index.ts`, wherever `methodOperationStep` rows are copied to `jobOperationStep` (and quote equivalents), also copy each step's `methodOperationStepSlide` rows into `jobOperationStepSlide`, remapping `stepId` to the newly-inserted job step id. Pure value copy (no derivation). Same pattern already used for steps/tools/parameters.

### 4.3 ERP authoring

In the BOP step editor (`apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx`, the step form): add a **Slides** section — upload one-image-per-slide, optional caption, drag to reorder. Reuse the existing upload/storage flow and `Editor`/image components already in that file. Slides are independent of the description's inline images.

### 4.4 MES rendering

In `AssemblyView.tsx` (and the future Inspection view):
- Replace `extractImages(step.description)` + `SHOW_REFERENCE_IMAGES` with the step's `slides` (from the loader).
- Render slides as the main reference panel + a thumbnail strip ("Slide 1 / N"), captions shown when present.
- Keep "Completed assy" (the item thumbnail) as today.
- Remove `stripImages()`/`extractImages()` once slides ship (description renders prose only).

## 5. Migration & rollout

- **Migration**: create the three tables + RLS. No backfill required (existing description-embedded images stay rendering via the legacy path until the flag flips).
- **Feature flag**: keep `SHOW_REFERENCE_IMAGES`-style gate until authoring + copy + render land together; then default slides on and retire the heuristic path.
- **Types**: regenerate `packages/database/src/types.ts` for the new tables (and the existing `operationKind` RPC, currently stale).

## 6. Acceptance criteria

1. An engineer can attach N slides (image + caption + order) to a BOP step in the ERP.
2. Creating a job copies the step's slides into `jobOperationStepSlide` with order preserved.
3. The assembly view shows the current step's slides as a carousel; "No reference image" only when a step truly has none.
4. Captions render; ordering respects `sortOrder`.
5. Description prose no longer needs embedded images (legacy embedded images may remain but are not required).
6. RLS: an operator can only read slides for operations in their company/assignment.

## 7. Open questions

- One image per slide confirmed — do we also want **multiple images per slide** later? (Default: no; a slide = one image.)
- Should Inspection characteristics (`inspectionFeature`) get slides too, or reuse the ballooned drawing? (Likely reuse drawing; revisit in Inspection workstream.)
- Max slides per step / image size limits?
- Do quote operations need slides at all in v1, or job-only? (Schema includes quote for symmetry; copy can be deferred.)

## 8. Effort (rough)

Migration + RLS (S) · get-method copy (S–M) · ERP authoring UI (M) · MES render + remove heuristic (S–M) · types regen (S). One vertical slice; ship behind the existing flag.
