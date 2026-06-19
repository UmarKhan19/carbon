# PRD: Import BOM & BOP (Method Import)

> Vocabulary follows [CONTEXT.md](./CONTEXT.md). Decisions are bound by
> [ADR-0001](./docs/adr/0001-method-import-is-atomic-per-parent-part.md) and
> [ADR-0002](./docs/adr/0002-method-import-file-format.md). Implementation checklist lives in
> [llm/tasks/import-bom-bop.md](./llm/tasks/import-bom-bop.md).

## Problem Statement

Carbon has bulk CSV importers for parts, materials, customers, contacts, and similar
entities. When a user uploads a part, there is no way to upload the part's associated
**BOM** (its Bill of Materials — what it is built from) or **BOP** (its Bill of Process —
the operations used to build it). A team onboarding onto Carbon, or migrating a catalog
from a legacy ERP, can load thousands of parts but must then hand-build every part's
recipe in the UI, one line at a time. For a real manufacturing catalog this is prohibitive,
so the parts arrive in Carbon with no method and the system cannot plan, cost, or
manufacture them until someone manually recreates work that already exists in a spreadsheet.

## Solution

Add the ability to bulk-import a part's Make Method — its BOM and BOP, including the
nested detail of each operation (procedure steps, required tools, and process
parameters) — via CSV, using the same import experience users already know.

The user chooses how they want to work:

- **Import BOM** — a focused file of BOM lines against parts that already exist.
- **Import Operations** — a focused file of operations (and their steps/tools/parameters)
  against parts that already exist.
- **Import Parts with Methods** — one combined file that creates the parts *and* their
  full BOM and BOP together, for a clean catalog migration in a single upload.

These appear in the existing **Bulk Import** dropdown on the Parts and Tools lists. Every
row names its parent part explicitly, so multi-level assemblies, multiple part revisions,
and even specific recipe versions all import correctly. The importer is safe by
construction: it validates the whole file first, treats each part's recipe as
all-or-nothing, never overwrites a recipe that already has content, and reports results
per part so the user knows exactly what imported, what was skipped, and why.

## User Stories

1. As a data-migration user, I want to upload a CSV of BOM lines for parts that already
   exist, so that I do not have to hand-enter each component in the UI.
2. As a data-migration user, I want to upload a CSV of operations for parts that already
   exist, so that I can populate routings in bulk.
3. As a data-migration user, I want to upload one combined file that creates parts and
   their BOM and BOP together, so that I can migrate a whole catalog in a single step.
4. As an engineer, I want every BOM/BOP row to name its parent part by readable ID and
   revision, so that the importer never guesses which part a line belongs to.
5. As an engineer, I want a sub-assembly's components to be expressed as that
   sub-assembly's own BOM lines, so that multi-level BOMs import without a fragile level
   column.
6. As an engineer, I want to import the BOM/BOP for a specific part revision, so that
   revision A and revision B each get their own independent recipe.
7. As an engineer, I want to optionally target a specific Make Method Version, so that a
   migrated part can carry more than just its current recipe.
8. As an engineer, when I leave the version blank, I want the importer to fill the part's
   current method, so that the common case needs no extra columns.
9. As an engineer, I want an explicitly versioned import to create a Draft and never change
   which version is Active, so that importing cannot disturb live production.
10. As an engineer, I want the importer to fill a recipe only when it is empty, so that a
    part that already has a BOM/BOP is never silently overwritten or duplicated.
11. As an engineer, I want a part that already has a recipe to be skipped and reported, so
    that re-running the same file is safe.
12. As an engineer, I want each operation to carry an operation number unique within the
    part, so that I can attach steps, tools, and parameters to the right operation.
13. As an engineer, I want to import procedure steps for an operation, including the step
    type, whether it is required, measurement bounds, and list options, so that work
    instructions migrate with the routing.
14. As an engineer, I want to import the tools required by an operation with quantities, so
    that tooling requirements migrate with the routing.
15. As an engineer, I want to import the parameters of an operation as key/value pairs, so
    that process settings migrate with the routing.
16. As a process planner, I want to import both in-house (Inside) and outsourced (Outside)
    operations, so that a routing with outsourced steps like plating or heat-treat imports
    completely.
17. As a process planner, I want to optionally link an Outside operation to a supplier and
    that supplier's process, so that outsourced costing is captured where known.
18. As a cost engineer, I want method type and sourcing to come from the component item
    rather than the BOM line, so that the same component behaves consistently everywhere it
    is used.
19. As an engineer, I want components, processes, work centers, tools, and units of measure
    to already exist, so that an import never invents a junk record from a stray cell.
20. As an engineer, I want a missing reference to fail only the affected part's recipe, so
    that one bad line does not silently produce an incomplete recipe.
21. As an engineer, I want validation to run across the whole file before anything is
    written, so that I can see and fix every error up front.
22. As an engineer, I want each part's recipe to import all-or-nothing, so that I never end
    up with a partial recipe missing a component.
23. As an engineer, I want one bad part to not block the rest of the file, so that a single
    error does not waste a large import.
24. As an engineer importing a combined file, if a new part's recipe fails, I want the part
    itself to not be created, so that I am not left with orphaned parts.
25. As an engineer importing against an existing part, if its incoming recipe fails, I want
    the existing part left untouched, so that the import never destroys data I did not
    upload.
26. As an engineer, I want a per-part result of what was created, updated, skipped, and why,
    so that I can reconcile the import against my source data.
27. As an engineer, I want to import a method only for makeable items (Parts and Tools), and
    get a clear error if I point a BOM at a Material, so that I am not misled into an
    impossible operation.
28. As an engineer, I only want these import options to appear where they make sense (the
    Parts and Tools lists), so that the UI does not offer dead-ends on Materials or
    Consumables.
29. As an engineer, I want to download a template for each import type, so that I know the
    exact columns expected.
30. As an engineer, I want to map my spreadsheet columns to the expected fields with the
    existing column-mapper, so that my source file does not have to match Carbon's headers
    exactly.
31. As an engineer, I want list-valued step options expressed with a simple delimiter in one
    cell, so that I can author them in a spreadsheet.
32. As an engineer, I want operation order (After Previous / With Previous) as an explicit
    column defaulting to After Previous, so that parallel steps are expressible and the
    common sequential case needs no input.
33. As an engineer, I want BOM line order to follow the row order in the file, so that I do
    not have to hand-number sequence columns.

## Implementation Decisions

- **One engine, three entry points.** A single row-type-multiplexed importer backs three
  import types — `bom`, `operations`, and a combined `partWithMethod` — surfaced as **Import
  BOM**, **Import Operations**, and **Import Parts with Methods** in the existing Bulk
  Import dropdown on the Parts and Tools lists. The combined file may contain all row types;
  the focused files carry a subset. All share validation, error reporting, and the
  column-mapper.

- **Row-type multiplexing.** A `Row Type` column discriminates six types: `PART`, `BOM`,
  `BOP`, `STEP`, `TOOL`, `PARAM`. Each routes to its own processor. (ADR-0002)

- **Explicit parent keying.** Every BOM/BOP/STEP/TOOL/PARAM row names its parent by
  `Parent ID + Parent Revision` plus an optional `Make Method Version`. Multi-level BOM is
  recursive: a sub-assembly is another part that owns its own rows. The positional `Level`
  format is export-only. (ADR-0002)

- **Operation correlation key.** Each `BOP` row carries an `Op No` unique within the parent.
  It sets the operation's sequence and is the key that `STEP`/`TOOL`/`PARAM` rows reference
  via `(Parent + Op No)`. BOM line order is positional (row order within the parent).
  (ADR-0002)

- **Method type and sourcing are item-level, not line-level.** A BOM line mirrors its
  component item for method type and sourcing; these are derived from the component, never
  read from the import. The half-built `methodMaterial` stub's `methodType` column and
  `level` column are removed.

- **Versioning.** Blank version targets the part's current method (`activeMakeMethods` — for
  a new part, the empty Draft v1 created by the make-method trigger). An explicit version
  finds-or-creates that Make Method Version as a **Draft** and fills it with the file's
  content exactly (no copy-from-prior). The importer never changes which version is Active.
  (ADR-0002)

- **Create-only / fill-if-empty, evaluated per version.** A method is filled only if the
  targeted version has zero materials and zero operations. A populated version is skipped
  and reported, never clobbered. (ADR-0001)

- **Atomicity per parent part.** The whole file is validated before any write. Each part's
  recipe commits all-or-nothing; other parts proceed. In a combined file the new part row is
  part of the unit and rolls back with a failed recipe; a pre-existing part is never rolled
  back. (ADR-0001)

- **Reference resolution.** Items (parent, component, tool) resolve by `readableId + revision`
  within the company; the parent must be a makeable item (Part or Tool) or the part errors.
  Process and work center resolve by name; an ambiguous name errors. UOM resolves by code
  (default EA). Outside operations may optionally link a supplier process by supplier + process
  name. Missing references hard-fail the affected part; nothing is auto-created.

- **Processing order.** Within a file, all `PART` rows are processed first, then `BOM`, then
  `BOP`, then `STEP`/`TOOL`/`PARAM`, so that parents and components defined in the same file
  resolve.

- **Modules touched.** Import rulebook (`apps/erp/app/modules/shared/imports.models.ts`):
  replace the `methodMaterial` stub, add field mappings + Zod schemas + the `parts`
  permission for the three types. The `import-csv` edge function
  (`packages/database/supabase/functions/import-csv/`): row-type splitter, per-parent
  grouping, up-front validation pass, atomic-per-part transactions, reference resolution, and
  Make Method find-or-create. The Bulk Import dropdown (`TableHeader.tsx`) on the Parts and
  Tools lists. Template generation for the three types.

- **Edge-function caveat (architectural risk).** The `import-csv` edge function writes
  directly to the database and does **not** call the app's `items.service.ts` upsert
  functions. The derivation logic those functions own — method type/sourcing from the
  component item, `materialMakeMethodId` resolution for Make-to-Order components, and
  storage-unit seeding — must be replicated inside the edge function rather than reused.

- **Result contract.** The importer returns a per-part summary in the existing
  `{ inserted/created, updated, skipped, errors[] }` shape, keyed by part, surfaced in the
  import modal.

## Testing Decisions

- **What makes a good test here:** assert external behavior, not internals. Drive the
  importer with CSV content + column/enum mappings and assert (a) the resulting Make Method
  state — which `methodMaterial`, `methodOperation`, and nested step/tool/parameter rows
  exist under which version — and (b) the returned per-part summary (created/updated/skipped
  + error reasons). Do not assert on private helper shapes or row-classification internals.

- **Primary seam — the `import-csv` edge function.** This is the highest existing seam that
  exercises parse → classify → validate → write end-to-end. Prefer it over introducing new
  seams. New per-row validation is expressed through the Zod schemas in the import rulebook
  and is covered transitively by edge-function tests; add focused schema tests only where a
  conditional rule (e.g. Inside ⇒ units required, List ⇒ list values required) warrants it.

- **Modules tested:** the `import-csv` edge function (behavioral, the bulk of coverage) and
  the new import Zod schemas (targeted).

- **Prior art:** follow the existing import-csv processing and `classify-import-row` logic and
  any existing tests around it; mirror their fixture-driven style (CSV in, summary +
  resulting rows out).

- **Behavioral cases to cover:** combined file creating a new part with a multi-level BOM and
  mixed Inside/Outside operations plus steps/tools/parameters; focused BOM and Operations
  files against pre-existing parts; skip-if-content on re-run; atomicity (one bad line fails
  only its part; a new part with a failing recipe is not persisted; a pre-existing part is
  untouched); makeable-parent guard (Material parent errors); explicit version fills a new
  Draft without disturbing the Active version; missing-reference hard-fail.

## Out of Scope

- A per-part "Import Method" button on the part's method page (the round-trip editing use
  case). The same engine could power it later, but it is not part of this work.
- A new round-trippable, import-shaped BOM/BOP **export**. The existing export remains a
  cost report; this PRD does not make it byte-identical to the import format.
- **Overwrite** of an existing populated recipe. The importer is create-only; overwrite would
  be a separate, explicit opt-in.
- Creating a new Make Method **Version** as a copy of a prior version (the in-app
  copy-then-edit workflow). The importer only fills empty versions with explicit content.
- Auto-creating components, processes, work centers, tools, or units of measure referenced by
  the file. These must pre-exist.
- Importing methods for non-makeable items (Material, Consumable, Fixture) as parents.
- Non-CSV formats (xlsx, CAD files). Part upload is CSV-only and this feature stays in CSV.

## Further Notes

- There is an abandoned `methodMaterial` import stub in the rulebook with a `level` column
  and a `methodType` column and no parent key; it is unwired in the edge function. This work
  replaces that stub rather than extending it.
- The make-method trigger creates an empty Draft v1 for every new Part and Tool, which is why
  "already has a BOM" must mean "has method content," not "has a make method row."
- Make Method Versions and Part Revisions are independent in the schema (separate rows,
  cascade-scoped), which is what makes per-version and per-revision import safe. Jobs snapshot
  the active version at creation, so importing into a method never disturbs running jobs.
- The combined file carries the union of all six row types' columns and is therefore wide and
  mostly-empty per row; the focused BOM and Operations files exist for users who want narrow
  sheets.
