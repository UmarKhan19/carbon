---
status: accepted
---

# Inspection execution: explicit plan link and a dedicated result record

The Inspection view must (a) load the part's inspection plan against a specific `jobOperation` and
(b) capture an actual value per characteristic per unit/sample. Two schema decisions:

**Plan link — explicit FK, not resolve-by-item.** A nullable `inspectionDocumentId` FK is added to
`methodOperation` / `jobOperation` / `quoteOperation` and propagated through `get-method`. (Implementation
note: this FK is added in the **Inspection workstream (Phase 3)**, not the Phase 1 `operationKind`
migration — keeping the keystone classification migration independent of the inspection tables.) Resolve-by-item is ambiguous because a part can have multiple `inspectionDocument`s
(distinct `drawingNumber` / `version`) and because different ops may inspect different feature subsets.
The BOP-editor picker *defaults* via resolve-by-item (pre-selects the part's sole document when exactly
one exists), but the stored FK is the source of truth.

**Result record — a new table mirroring `jobOperationStepRecord`, not synthetic steps.** Inspection
characteristics are `inspectionFeature` rows, not `jobOperationStep` rows, so writing into
`jobOperationStepRecord` would require synthesizing fake steps — the same hack the Assembly cleanup
removes. Instead `jobOperationInspectionRecord` is keyed `(jobOperationId, inspectionFeatureId, index)`,
one row per characteristic per unit/sample, with `index` from the shared FIX-1 unit-axis module. It mirrors
the step record's value columns and stores a `result` (`pass | fail | out-of-tolerance`) **frozen at
record time** so as-inspected evidence survives later tolerance edits. A failing row links a
`nonConformance` via the existing `nonConformanceJobOperation` / `trackedEntities` association.

## Consequences

- Two new propagated FK fields on the operation tables (`operationKind`, `inspectionDocumentId`) share the
  same `get-method` copy-lists — omitting either silently breaks propagation.
- The frozen `result` is denormalized against the live tolerances; this is intentional (evidence), and the
  numeric tolerance columns from [[adr-0002]] remain the source for re-evaluation if needed.
