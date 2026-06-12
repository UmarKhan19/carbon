# Thermo-Nuclear Review Fixes — feat/print-manager

Working state for applying review findings. Update checkboxes as items complete.
Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Priority order

### 1. Lift duplicated print UI into shared package (§1a) — DONE

- [x] Decided home: new `@carbon/printing/ui` entry (lingui catalogs updated to include `packages/printing/src/ui`; `@carbon/jobs`→`@carbon/printing` dep means the print action CANNOT move into printing — cycle)
- [x] Created `src/ui/`: PrintingProvider (context resolves all app differences at one site: printing data, printerRoutes, useMetric, printPath, settingsPath, settingsExternal), PrintButton, LabelDownloadModal
- [x] Created `src/assignments.ts`: canonical `PrinterContext` + `resolveContextAssignment` — replaces the duplicated context switch in usePrinting AND cache.server.ts (part of §2 landed early)
- [x] `manualPrintValidator` moved into printing models; both print.tsx routes now thin and identical
- [x] Both layouts wrap with PrintingProvider; mes `as any` casts removed (4 of them — §5 item done early)
- [x] `getPrinterRoutes` narrows `format` to "zpl"|"pdf" at the service boundary (DB CHECK enforces it)
- [x] Deleted 6 duplicated app files; barrels re-export from @carbon/printing/ui
- [x] Removed dead `variant` prop (declared but never used; one caller passed it)
- [x] Typechecks: packages/printing ✓, apps/mes ✓, apps/erp ✓, packages/jobs ✓; lingui extract → no catalog changes

### 2. Collapse context taxonomy to one model (§2) — DONE
- [x] `assignments.ts` in @carbon/printing: `printerContexts`, `PrinterContext`, `resolveContextAssignment` (read), `setContextAssignment` (write), `emptyLocationAssignment`, `getPrinterContextForSource` (sourceDocument→context lookup)
- [x] printing.tsx action: switch replaced with `setContextAssignment` + reuses `getPrintingSettings`/`updatePrintingSettings` service fns (JSON.parse(JSON.stringify) dance deleted)
- [x] LocationSection: 5 hand-written AssignmentRow blocks → data-driven `rows` array `.map`
- [x] print-job: nested ternary → `getPrinterContextForSource`
- [x] `updateAssignmentValidator`: enum from `printerContexts` + `.refine` requiring contextId for workCenter (was a silent no-op)
- [x] AssignmentUpdate payload typed with `PrinterContext`

### 3. Tighten ResolvedData typing (§3) — DONE
- [x] `ResolvedData<T>` generic; resolvers return `ProductLabelItem[]` / `KanbanCardItem[]` / `StorageUnitItem[]`
- [x] `PrintableDocumentItem` discriminated union; all `as string`/`as number` casts in renderers deleted
- [x] FLAG FOR USER: trackingType inferred from quantity in enrichTrackedEntities (kept as-is; behavior-preserving but smells like a bug per project rule against deriving Serial/Batch)

### 4. Decompose oversized files (§1b/§1c) — DONE
- [x] printing.tsx 942 → ~260 lines (loader/action/composition) + modules/settings/ui/Printing/{PrintersCard,AssignmentsCard}.tsx
- [x] print-job.tsx 756 → print-job/{index.tsx (~310 orchestration), resolvers.ts, renderers.tsx}; stayed in @carbon/jobs (moving to @carbon/printing would drag react-pdf/@carbon/documents into the package the apps' UI imports)
- [x] Merged verbatim-duplicate "Entity"/"Split" resolver cases; dead `!content` branch removed; DEFAULT_MEDIA_SIZE_ID constant

### 5. Medium cleanups (§4) — DONE
- [x] complete.tsx: `autoPrintFirstOperationLabel` helper replaces both ~50-line Serial/Batch blocks; redundant getCarbonServiceRole removed
- [x] printing.tsx JSON.parse(JSON.stringify()) — done in §2
- [x] packages/documents/src/zpl/utils.ts: `getZplLabelGeometry` + `zplLabelHeader`; both generators rewritten on top
- [x] _layout.tsx (mes): `as any` casts dropped — done in §1a
- [x] print-job: named constant for "label2x1" — done in §4

## Review

All five review sections applied. Verification:
- Typechecks clean: apps/erp, apps/mes (tsgo), packages/printing, packages/documents (tsgo), packages/jobs (tsc) — each scoped per-package, never whole-project
- ZPL refactor proven behavior-preserving: old-vs-new generators compared at runtime across all label sizes × 5 item shapes → 20/20 byte-identical
- lingui extract after the component move → zero catalog changes (same msgids)
- pnpm install clean after adding @carbon/printing deps/peer-deps + ./ui export

Key decisions:
- Print UI lives in `@carbon/printing/ui` (NOT @carbon/react — domain code doesn't belong in the generic UI package; NOT a shared action — @carbon/jobs→@carbon/printing dep makes that a cycle). `PrintingProvider` at each app's x+/_layout resolves the only real app differences (data shape, paths, external-vs-internal settings link).
- One canonical context model in `packages/printing/src/assignments.ts`: printerContexts/PrinterContext, resolveContextAssignment (read), setContextAssignment (write), getPrinterContextForSource (sourceDocument→context). Replaced 3 hand-maintained switches + 1 nested ternary + the loose `context: string` payloads.
- print-job stayed in @carbon/jobs as a directory (index/resolvers/renderers) — moving renderers into @carbon/printing would drag react-pdf into the package the apps import.

OPEN QUESTION for user: resolvers.ts still infers trackingType from quantity
((qty > 1 ? "Batch" : "Serial")) — preserved as-is, but it ignores the entity's
actual tracking type and looks like a latent bug.

Not done (left as-is deliberately): printing.jobs.tsx flash/data inconsistencies (cosmetic), Table.tsx controlled-selection addition (sound, documented contract), migration COMMIT after enum add (required by Postgres for enum use in same migration).
