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

**Grandfathering granularity** is per `(checkId, file, snippet)`, not per occurrence:
adding a *second* occurrence of an already-baselined pattern to an already-baselined
file is not flagged. This is acceptable because shipped migrations are immutable /
append-only — new migration files, and new check types in old files, are always caught.

## Invariant net

Runnable database assertions. Each invariant is a `.sql` file in `src/invariants/`
that SELECTs the rows which **violate** the rule (empty result = healthy).

- Add an invariant: drop a `.sql` file in `src/invariants/` — no code or registration.
- Run against a database: `DATABASE_URL=<conn> pnpm --filter @carbon/core invariants`
  (exits non-zero if any invariant returns rows).
- Invariants run against a **live DB** (a loop's worktree DB, or nightly against prod),
  NOT the static CI `test` job. The runner is DB-agnostic (injected query), so the
  logic is unit-tested without a database.
