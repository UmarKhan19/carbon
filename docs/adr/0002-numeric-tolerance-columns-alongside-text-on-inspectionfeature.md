---
status: accepted
---

# Numeric tolerance columns alongside TEXT on inspectionFeature

The Inspection view computes pass/fail from `actual vs. nominal ± tolerance`, which needs numbers, but
`inspectionFeature.nominalValue / tolerancePlus / toleranceMinus / unit` are TEXT and there is no
characteristic-type column. TEXT is retained deliberately: not every characteristic is numeric (thread
fits like `H7`, surface-finish callouts like `≤Ra 1.6`, GD&T symbols, visual go/no-go). We **add nullable
numeric columns** (`nominalNumeric`, `tolerancePlusNumeric`, `toleranceMinusNumeric` as DOUBLE PRECISION)
**alongside** the existing TEXT rather than replacing it or parsing TEXT at evaluation time.

A feature is treated as a **variable** characteristic (numerically evaluated) iff `nominalNumeric` is
non-null; otherwise it is an **attribute** characteristic the inspector marks pass/fail by hand. No new
`featureType` enum in v1 — presence of numeric data is the mode.

## Considered Options

- **Numeric columns alongside TEXT (chosen).** Numeric drives the evaluator; TEXT survives for display and
  for non-numeric specs. The balloon-extraction/save path emits numeric for new features; a one-time
  lenient backfill parses existing TEXT into numeric where it parses cleanly and leaves null otherwise.
- **Replace TEXT with numeric.** Loses non-numeric characteristics entirely — unacceptable.
- **Parse TEXT at evaluation time.** Fragile, re-parses on every evaluation, no clean place to store the
  variable/attribute distinction.
- **Explicit `featureType` enum.** More explicit but heavier; deferred — numeric-presence is sufficient
  for v1.

## Consequences

- Two representations of the same spec coexist; the numeric columns are authoritative for pass/fail, TEXT
  for display. Keeping them consistent is the extraction/save path's responsibility.
- The backfill must not fail the migration on unparseable TEXT (leave numeric null → attribute feature).
