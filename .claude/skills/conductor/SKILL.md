---
name: conductor
description: Supervised loop conductor — drive a single work item (a bug, a usability tweak, a small feature) through a doer→gate→keep-or-revert→ledger cycle to a gated PR, while the human watches. Use when asked to "conduct", "build", "fix", or "loop on" a specific item with the conductor. Supervised only — not autonomous/overnight (not yet supported). Backed by @carbon/harness + the @carbon/checks checks.
---

# conductor — supervised loop conductor

You are conducting a **supervised loop**: iterate doer→gate→keep/revert→ledger until the acceptance criteria are met, with the human watching and giving the final approval. Land a **gated PR** — never auto-merge.

This is the execution layer of the loop system. The deterministic helpers live in `@carbon/harness`; the checker is the four `@carbon/checks` checks.

## 0. Isolated worktree off `origin/main` (do this first)
- Every loop runs in its **own worktree, branched off the latest `origin/main`** — never stacked on another feature branch. Create it non-interactively:
  ```
  git fetch origin main
  crbn new loop/<id> --base origin/main --yes
  ```
  `crbn new --yes` skips all prompts (base defaults to `origin/main`) and prints the new worktree path; `cd` into it and do all the loop's work there.
- **Never run on `main`.** The loop's branch is `loop/<id>`.
- *(This assumes the loop system — `@carbon/harness` + `@carbon/checks` — is on `main`. Until that merges, the gate tooling only exists on the loop-system branch, so base off that branch instead.)*

## 1. Bind the work item
- If given a binding path, read it. Otherwise write one from the request (see `llm/loops/README.md` for the format) and save it to `llm/loops/runs/<id>/binding.loop.md` (run-loop also persists the binding there automatically).
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
   - **a0. Auto-format** — `pnpm exec biome check --write --no-errors-on-unmatched` runs automatically before the floor gates, fixing formatting and safe lint issues in-place. You do not need to run this manually — the harness handles it.
   - **a. Floor gates** — `pnpm --filter @carbon/harness gates` (lint + `@carbon/checks` conformance + clobbers), plus `typecheck` for each package you touched (per-package, never whole-repo).
   - **b. Behavior gate — MANDATORY for ANY change that affects user-facing behavior.** Choose the **simplest sufficient proof** from this hierarchy:
     1. **Unit / integration test (red→green)** — Write a test that fails on the old behavior and passes on the new. **Preferred when applicable:** logic changes, data transformations, component rendering, conditional visibility, service behavior, and anything testable without a running stack. Fast, deterministic, CI-portable, and it lives in the repo as a regression guard.
     2. **Agent-browser visual verification** — Boot the app (`crbn up`), `/login`, drive the affected screen with `agent-browser`: reproduce the exact failing condition, capture a **BEFORE screenshot**, confirm the fix, capture an **AFTER screenshot**. **Required when the proof is inherently visual** — layout, spacing, overflow, responsive behavior, animation, or anything where seeing the pixels is the only meaningful assertion.
     3. **CLI / script proof** — For non-UI changes (migrations, CLI tools, API endpoints), a command that demonstrates the correct output before and after.
     - **The principle: take the simplest possible path to provability.** If a unit test proves it, use a unit test. If it genuinely requires seeing pixels, use agent-browser. Never choose a heavier method when a lighter one gives the same confidence.
     - **At least one proof method must pass.** A user-facing change without proof is not done — the gate is flexible about *how*, not *whether*.
     - **If visual verification is needed and the stack cannot be brought up, the loop is BLOCKED** — stop and surface to the human. Do NOT open a "done" PR with verification "pending."
   - **c. Correctness (logic bug/feature)** — the **reproduce→fix→same-path** test: write a test that fails on the bug, fix, watch the *same* test pass (a unit test, or the agent-browser playbook recorded in step b).
   - If any gate fails: fix it, or revert this iteration's change.

3. **Judge — dispatch a separate review subagent** (NOT yourself) to check the diff against the acceptance criteria and the design rules. Do not grade your own homework. The judge does **not** return a holistic "looks good" — a single overall verdict rewards fluent-looking diffs that are subtly wrong. Instead it uses **binary decomposition**:
   - **Decompose each acceptance criterion + applicable design rule into atomic yes/no questions** — one verifiable property per question (e.g. "Does the change handle the 4+-label case the binding names?", "Is the precedent component actually reused, not re-implemented?", "Are audit fields + `companyId` set on every new write?"). Concrete, checkable criteria are what decomposition is *for*.
   - **Answer each question yes/no with a one-line justification grounded in a specific diff hunk or gate artifact** (file:line, screenshot, test name). A "yes" with no citation is a fail.
   - **Enumerate failure modes explicitly** — regressions, missed edge cases, fabricated/placeholder values, broken multi-tenancy — rather than trusting that a coherent-looking diff is correct.
   - **Approve only if every binary question passes.** Any "no" → the judge sends work back, and **the specific failed question becomes the next iteration's weakest-covered target** (§2.1) — so a rejection is directly actionable, not a vague "improve this."
   - **Do not over-decompose inherently holistic criteria.** For genuinely subjective acceptance (does this *feel* polished, is the copy clear), keep the judgment holistic — forcing atomic checks on a tolerant criterion produces a harsher judge that diverges from human taste. Decompose the verifiable; judge the subjective as a whole.
   - Use a **capable model** for the judge — decomposition surfaces failure modes but does not rescue a weak evaluator. Keep the question set tight; do not let it accrete unactionable boilerplate over iterations.

4. **Decide + ledger.** Keep the change iff **every gate is green — including the behavior gate (§2b) with sufficient proof** — AND the judge approves; otherwise revert it. Append one entry to `llm/loops/runs/<id>/ledger.jsonl`:
   `pnpm --filter @carbon/harness exec tsx -e "import {appendLedger} from '@carbon/harness'; appendLedger('llm/loops/runs/<id>/ledger.jsonl', {iteration: <n>, change: '<summary>', gates: {<gate>: <bool>}, decision: '<keep|revert>', reason: '<why>', at: new Date().toISOString()})"`
   (The harness has no clock — you supply `at`.)

5. **Terminate?** If every acceptance criterion is met and provable → go to Finish. If you plateau (no progress across iterations) or the human stops → stop and report.

## 3. Finish — land a gated PR
- Embed the **proof captured by the behavior gate (§2b)** in the PR body:
  - **Unit/integration tests:** name the test file(s) and the red→green assertion(s)
  - **Visual verification:** embed before/after screenshots
  - **CLI/script proof:** include the command and its output
  A PR without proof that the behavior gate passed means the loop wasn't verified — do not open it.
- Open a **gated PR via the `gh` CLI** (`gh pr create`). Never merge. The PR body must:
  - state the **design rationale** (the precedent you copied; any `research`),
  - list, per acceptance criterion, **which gate proves it and how** (test name, screenshots, or CLI output),
  - embed **before/after screenshots** for visual changes,
  - summarize the **ledger** (iterations, what was kept/reverted and why).
- **Surface every design decision for the human to approve / comment / improve** — design is never shipped silently.
- **Loop artifacts stay out of source.** `llm/loops/runs/` (bindings, ledger, outcome, screenshots) is gitignored *runtime* — never commit it to the working branch. The **ledger summary goes in the PR body**, and **before/after screenshots are embedded in the PR body** from a shared, non-merging **`loop-artifacts`** branch (under `llm/loops/runs/<id>/screenshots/`, referenced by raw URL) — never committed to the product tree. (`@carbon/harness`'s `openPr` does this hosting automatically.)

## Guardrails (non-negotiable)
- **A user-facing change is never done without sufficient proof (§2b).** The proof must use the simplest method from the provability hierarchy — unit test when applicable, visual verification when inherently visual, CLI proof for non-UI. If visual verification is needed and the stack can't boot, the loop is BLOCKED — stop and surface, not "done."
- Never auto-merge; the human approves the PR.
- Never run on `main`.
- Surface design changes to the human.
- Supervised only: do not background, schedule, or fan out across worktrees (later versions).

## Growing this
- Add a floor gate: append a `{ id, cmd }` to `FLOOR_GATES` in `@carbon/harness/src/gates.ts`.
- Add a binding field: extend the frontmatter + `parseBinding`.
- Provability hierarchy (unit test → visual → CLI) is **in** v1 (§2b). Richer gates (calibrated judge) and autonomy are deliberately out of v1.
