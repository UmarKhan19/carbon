---
name: conductor
description: Supervised loop conductor — drive a single work item (a bug, a usability tweak, a small feature) through a doer→gate→keep-or-revert→ledger cycle to a gated PR, while the human watches. Use when asked to "conduct", "build", "fix", or "loop on" a specific item with the conductor. Supervised only — not autonomous/overnight (not yet supported). Backed by @carbon/harness + the @carbon/checks checks.
---

# conductor — supervised loop conductor

You are conducting a **supervised loop**: iterate doer→gate→keep/revert→ledger until the acceptance criteria are met, with the human watching and giving the final approval. Land a **gated PR** — never auto-merge.

This is the execution layer of the loop system (`llm/plans/loops/design.md`). The deterministic helpers live in `@carbon/harness`; the checker is the four `@carbon/checks` checks.

## 0. Safety preconditions (do these first)
- **Never run on `main`.** Confirm `git branch --show-current` is a feature branch; if on `main`, create one first.
- Confirm the working tree is clean (or that pending changes are intended to be part of this loop).

## 1. Bind the work item
- If given a binding path (`llm/loops/<id>.loop.md`), read it. Otherwise write one from the request (see `llm/loops/README.md` for the format) and save it to `llm/loops/<id>.loop.md`.
- Parse it to validate the shape:
  `pnpm --filter @carbon/harness exec tsx -e "import {parseBinding} from '@carbon/harness'; import {readFileSync} from 'node:fs'; console.log(JSON.stringify(parseBinding(readFileSync('<path>','utf8'))))"`
- The binding has `id`, `kind` (bug|feature|usability|copy), `title`, `risk`, and an `acceptance` list. **Each acceptance criterion is the definition of done** — you are not finished until each is satisfied and provable.

## 2. The cycle (repeat until acceptance met OR the human stops)
For each iteration:

1. **Doer — make the smallest change toward the weakest-covered acceptance criterion.** Do not batch unrelated changes.
   - **UI work:** FIRST find the nearest existing screen/component that matches and *copy its layout/components/approach* — do not design from concepts. Cite the precedent path. (See the design's exemplar/precedent rule.)
   - **ERP-domain features** (accounting, RMAs, costing, tax, inventory valuation, …): FIRST use the `research` skill to ground the design in how real ERPs do it. Do not invent domain logic.
   - **Schema/migration changes:** after the change, regenerate types (`pnpm run generate:types`) BEFORE typechecking — a typecheck against stale types is a false green.
   - **Module code:** keep one `<module>.service.ts` and one `<module>.models.ts` per module; never scatter new service/models files.

2. **Gate.** Run these in order; every applicable one must be green:
   - **a. Floor gates** — `pnpm --filter @carbon/harness gates` (lint + `@carbon/checks` conformance + clobbers), plus `typecheck` for each package you touched (per-package, never whole-repo).
   - **b. Behavior gate — MANDATORY for ANY UI / user-facing change. A UI change is NOT solved until you have seen it work in the running app.** Boot the app (`crbn up` if it isn't already running), `/login`, and drive the affected screen with `agent-browser` (use the `/test` skill): **reproduce the exact failing condition the binding describes** (e.g. a record with 4+ labels), confirm the fix actually works, and **capture screenshots**. The change cannot be kept or finished until this gate is green. This is not optional and not deferrable to PR time.
     - **If the stack cannot be brought up, the loop is BLOCKED** — stop and surface to the human. Do NOT proceed to keep/finish, and do NOT open a "done" PR with visual verification "pending." Reaching a "should I screenshot?" question is itself a failure of this gate.
   - **c. Correctness (logic bug/feature)** — the **reproduce→fix→same-path** test: write a test that fails on the bug, fix, watch the *same* test pass (a unit test, or the agent-browser playbook recorded in step b).
   - If any gate fails: fix it, or revert this iteration's change.

3. **Judge — dispatch a separate review subagent** (NOT yourself) to check the diff against the acceptance criteria and the design rules. It may send work back. Do not grade your own homework.

4. **Decide + ledger.** Keep the change iff **every gate is green — including the behavior gate (§2b) for UI work, with screenshots captured proving the fix** — AND the judge approves; otherwise revert it. Append one entry to `llm/loops/<id>/ledger.jsonl`:
   `pnpm --filter @carbon/harness exec tsx -e "import {appendLedger} from '@carbon/harness'; appendLedger('llm/loops/<id>/ledger.jsonl', {iteration: <n>, change: '<summary>', gates: {<gate>: <bool>}, decision: '<keep|revert>', reason: '<why>', at: new Date().toISOString()})"`
   (The harness has no clock — you supply `at`.)

5. **Terminate?** If every acceptance criterion is met and provable → go to Finish. If you plateau (no progress across iterations) or the human stops → stop and report.

## 3. Finish — land a gated PR
- Attach the **screenshots captured by the behavior gate (§2b)**. A UI PR without them means the loop wasn't actually verified — do not open it.
- Open a **gated PR via the `gh` CLI** (`gh pr create`). Never merge. The PR body must:
  - state the **design rationale** (the precedent you copied; any `research`),
  - list, per acceptance criterion, **which gate proves it**,
  - attach the **screenshots** for UI work,
  - summarize the **ledger** (iterations, what was kept/reverted and why).
- **Surface every design decision for the human to approve / comment / improve** — design is never shipped silently.

## Guardrails (non-negotiable)
- **A UI/user-facing change is never done without passing visual e2e verification in the running app (§2b).** If the stack can't boot, the loop is BLOCKED — stop and surface, not "done."
- Never auto-merge; the human approves the PR.
- Never run on `main`.
- Surface design changes to the human.
- Supervised only: do not background, schedule, or fan out across worktrees (later versions).

## Growing this
- Add a floor gate: append a `{ id, cmd }` to `FLOOR_GATES` in `@carbon/harness/src/gates.ts`.
- Add a binding field: extend the frontmatter + `parseBinding`.
- Visual e2e behavior verification is **in** v1 (§2b). Richer gates (TDD-mandatory, calibrated judge) and autonomy are deliberately out of v1.
