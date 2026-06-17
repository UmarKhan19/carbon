---
status: superseded by ADR-0005
---

# Single MES operation route switches on operationKind

> **Superseded by [ADR-0005](0005-separate-routes-per-execution-view.md).** We reversed this:
> a route returning three different response shapes (a discriminated-union loader) is a
> polymorphic-route smell, and the three execution modes diverge over time. We moved to one
> route *per view* with redirect guards. The rest of this ADR is kept for history.

The MES work queue already navigates exclusively through `path.to.operation(id)` →
`/x/operation/:operationId`, and a per-operation `operationKind` (`Operation | Assembly | Inspection`)
now decides which execution screen an operator should see. We keep **one** route — the existing
`operation.$operationId.tsx` loads the operation, reads `operationKind`, and renders
`JobOperation | AssemblyView | InspectionView` — rather than three routes (`/operation`, `/assembly`,
`/inspection`) with cross-redirects. The orphan `x+/assembly.$operationId.tsx` route and the
`path.to.assembly` helper are removed (they have zero inbound links).

## Considered Options

- **One route switching on `operationKind` (chosen).** Deep links are `/x/operation/:id` permanently;
  changing an operation's kind never breaks a saved link or dispatch navigation (user stories 7–9).
  Less code than the alternative because the entry point already points here.
- **Three routes with redirects.** Two extra route files plus redirect logic whose only purpose is to
  bounce a wrong-kind URL back to the right screen — self-cancelling work, and a saved `/assembly/:id`
  link silently breaks if the op is later reclassified.

## Consequences

- A future reader sees one route render three different screens; this ADR explains why.
- The render-time switch must default to the Operation view for the `Operation` member and for any
  unrecognized/null kind, so the route is always safe to open.
