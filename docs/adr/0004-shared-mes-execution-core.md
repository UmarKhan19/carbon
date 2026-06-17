---
status: accepted
---

# One shared MES execution core for all three views

The Operation view (`JobOperation.tsx`, ~2,396 lines) and the Assembly POC (`AssemblyView.tsx`, ~1,766
lines) independently re-implement timers/`productionEvent`, quantity reporting, material issue, NCR,
realtime, completion, and unit navigation. Two copies already drift (the per-unit index bug in the POC is
a symptom). We extract a **single execution core** that all three views — Operation, Assembly, Inspection
— consume.

**Direction: lift the core out of the working Operation view, and re-point the Operation view at it first,
as a behavior-preserving refactor verifiable against `main`.** The Operation view is the proven,
in-production implementation, so it is the reference. Only after Operation consumes the extracted core
(same screen, zero behavior change) do we re-point Assembly and build Inspection on it. Building a fresh
core from scratch would discard proven behavior and have no parity check.

**Boundary.** Shared core = hook(s) + shared modal components + a layout shell covering timer/
`productionEvent`, quantity, material issue, NCR/quality-issue affordance, realtime channel, completion/
finish flow, and the [[unit-axis]] navigation (FIX-1). View-specific body = Operation's procedure/step
rendering, Assembly's build-step + static model, Inspection's characteristic list + record + pass/fail +
gauge.

**Sequencing.** Build and test the unit-axis module first (shared root, the founder's core concern) →
extract the rest of the core while wiring Assembly, Operation re-pointed to prove parity → Inspection
consumes the core last.

## Considered Options

- **Extract from the working Operation view, Operation consumes first (chosen).** Parity is diffable
  against `main`; lowest risk; the bug-prone POC copy is deleted, not blessed.
- **Build a fresh shared core, migrate all three.** More work, no parity gate, throws away proven behavior.
- **Keep Assembly's copy, only share going forward.** Guarantees continued drift — rejected.

## Consequences

- A future reader sees three view bodies composing one `useOperationExecution`-style hook + shared shell;
  this ADR explains why.
- The Operation-view refactor must be merged behind a strict "no behavior change vs main" check before
  Assembly/Inspection build on the core.
