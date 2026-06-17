---
status: accepted
---

# Separate MES route per execution view, with redirect guards

Supersedes [ADR-0001](0001-single-mes-operation-route-switches-on-operationkind.md). ADR-0001 had one
route (`/x/operation/:id`) switch on `operationKind` and render `JobOperation | AssemblyView |
InspectionView` from a discriminated-union loader. We reverse that: **each execution view gets its own
route** —

```
/x/operation/:id    → JobOperation     (operationKind = Operation, the default)
/x/assembly/:id     → AssemblyView      (operationKind = Assembly)
/x/inspection/:id   → InspectionView    (operationKind = Inspection — Phase 3)
```

Each route's loader returns **one** shape and renders **one** view. To keep deep links and dispatch
navigation robust, every route opens with a **redirect guard**: it reads the operation's `operationKind`
and, if the kind doesn't belong to that route, throws a `redirect` to the correct one (preserving search
params). So any of the three URLs self-corrects, and a reclassified operation's saved link still lands on
the right screen.

`operationKind` remains the single source of truth for *which* view; this ADR only changes *how* that maps
to URLs.

## Why we reversed

- **A route shouldn't return three different response shapes.** The discriminated-union loader was a
  polymorphic-route smell (the reviewer's objection). One shape per route is cleaner and each loader fetches
  exactly its own data.
- **The three modes diverge.** Assembly gains CAD-driven animated work instructions; Inspection executes a
  quality plan. Distinct routes age better than a single branching one as the views grow apart.
- **The URL communicates the mode.** `/x/assembly/:id` tells operators, support, and logs what's happening.
- The deep-link-stability argument that justified ADR-0001 is preserved anyway — by the redirect guards —
  at the cost of an occasional extra redirect hop, which is negligible on the floor.

## Consequences

- The work queue navigates to `/x/operation/:id`; the operation route's guard redirects `Assembly` ops to
  `/x/assembly/:id` (one hop). Routing the queue directly by kind would need `operationKind` added to the
  work-queue RPC — deferred as an optimization.
- Until the Phase-3 inspection route exists, `Inspection` ops fall through to `JobOperation` (no redirect),
  to avoid a redirect loop. Phase 3 adds `/x/inspection/:id` and the matching guard.
- Guards must not create loops: a route only redirects kinds it does *not* serve, and only to routes that
  exist.
