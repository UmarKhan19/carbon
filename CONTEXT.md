# Context — MES Execution Views

Glossary for the MES execution-view work (Operation / Assembly / Inspection). Terms here are the
canonical, ubiquitous language for this subsystem. Implementation detail lives in the PRD and ADRs,
not here.

## Terms

### jobOperation
A single step of a job's routing (the live name for "BOP" — bill of process). The unit of work an
operator executes. Each `jobOperation` is copied from a `methodOperation` template by the `get-method`
edge function when a job is created.

### operationKind
A per-operation classification that decides **which execution view** an operator sees. Enum members:
`Operation | Assembly | Inspection`, NOT NULL default `Operation` (preserves today's behavior). The
member `Operation` maps 1:1 to the Operation view. Orthogonal to [[tracking-type]] and distinct from
`operationType` (Inside/Outside), which it must not overload. Stored on `methodOperation` (template) and
copied to `jobOperation` / `quoteOperation`. The stored field is the source of truth. Auto-suggest
*writes a default* at `methodOperation` author time (computed from BOM/BOP signals, overridable in the
BOP editor); `get-method` never re-runs it — it copies the stored value verbatim.

### tracking type
The item's `itemTrackingType` — `Serial | Batch | Inventory | Non-Inventory`. Decides **per-unit vs.
batch cadence inside a view**, never which view. NOTE: `requiresSerialTracking` / `requiresBatchTracking`
are **derived in code** from the item's `itemTrackingType` (=== "Serial" / === "Batch"); they are not
stored columns on `jobMakeMethod`.

### unit axis
The list of units an operator pages through ("Unit X of N"). Quantity-centric: length =
`operationQuantity` for **every** tracking type. Unit *i* carries `trackedEntities[i] ?? null`. Serial
binds a tracked entity per unit; Batch binds one lot entity to unit 0 only; Inventory/Non-Inventory bind
none. This is the FIX-1 module shared by Assembly and (per-sample) Inspection.

Record-index convention: `jobOperationStepRecord.index` = the unit's position *i* on the unit axis, for
**all** tracking types (Serial = entity position in `trackedEntities`; Batch/Inventory = `0…N-1`). Identical
to what the Operation view already writes, so the three views agree on per-unit done-state and no record
backfill is needed. Relies on `trackedEntities` being returned in a stable, deterministic order.

### inspection plan
The quality definition for a part: an `inspectionDocument` (ballooned drawing) holding `inspectionFeature`
rows (characteristics with nominal ± tolerance and unit). Today an ERP-only definition with no link to a
job/operation and no result-capture. The Inspection view executes a plan against a `jobOperation`, linked
by an explicit nullable `inspectionDocumentId` FK on the operation (picker defaults via resolve-by-item:
the part's sole `inspectionDocument` if exactly one exists).

### variable / attribute characteristic
An `inspectionFeature` is **variable** (numerically evaluated for pass/fail against `nominalNumeric ±
tolerance`) iff its numeric columns are populated; otherwise it is an **attribute** characteristic the
inspector marks pass/fail by hand (thread fits, surface-finish callouts, GD&T, visual). Numeric columns
(`nominalNumeric`, `tolerancePlusNumeric`, `toleranceMinusNumeric`) are added alongside the existing TEXT,
which is retained for display and non-numeric specs. See [[adr-0002]].

### pass/fail evaluator
A pure function `(actual, nominalNumeric, tolerance±, unit) → pass | fail | out-of-tolerance`, run only for
variable characteristics. Records actuals into the inspection [[result record]].

### result record
The new `jobOperationInspectionRecord` table — one row per `inspectionFeature` per unit/sample, keyed
`(jobOperationId, inspectionFeatureId, index)`. Modeled column-for-column on `jobOperationStepRecord`
(`numericValue` = actual; `value`/`booleanValue`/`userValue` for attribute characteristics); `index` from
the [[unit-axis]] module; optional `gaugeId`; a `result` (`pass | fail | out-of-tolerance`) **frozen at
record time** for as-inspected evidence. A failing row links a `nonConformance` via the existing
association. It is *not* a `jobOperationStepRecord` — inspection characteristics are `inspectionFeature`
rows, never synthetic procedure steps. See [[adr-0003]].
