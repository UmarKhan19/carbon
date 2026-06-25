# @carbon/core

Executable checks for the loop system's "core" (see `llm/plans/loops/design.md`).

## Conformance net

Forbids deprecated code patterns in migrations. Existing violations are
grandfathered in `src/conformance/baseline.json`; only **new** violations fail CI.

- Add a check: implement a `ConformanceCheck` under `src/conformance/`, add it to
  `CONFORMANCE_CHECKS` in `src/run.ts`, then re-baseline.
- Re-baseline (after intentionally accepting current state): `pnpm --filter @carbon/core baseline`
- Run the gate: `pnpm --filter @carbon/core test`

Each check records `provenance` (the transition event that retired the old pattern).
