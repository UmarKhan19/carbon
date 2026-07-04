---
name: conductor
description: Supervised loop conductor — drive a single work item (a bug, a usability tweak, a small feature) through a doer→gate→judge→keep-or-revert→ledger cycle to a gated PR, while the human watches. Use when asked to "conduct", "loop on", or build/fix one tightly-scoped item with explicit acceptance criteria. Backed by @carbon/harness and the @carbon/checks gates. Supervised only — never autonomous/overnight, never auto-merged. For multi-phase features prefer /feature.
---

# conductor — supervised doer→gate→judge loop

Iterate on one work item until its acceptance criteria are met and provable,
with the human watching and giving final approval. Ship a **gated PR** — never
merge. Architecture context: `.ai/docs/loop-system.md`; the deterministic
helpers live in `packages/harness` (see its `AGENTS.md`).

**Announce at start:** "Using the conductor skill — supervised loop on
{work item}."

## Step 0: Isolated worktree off origin/main — always first

```bash
git fetch origin main
crbn new loop/<id> --base origin/main --yes   # prints the worktree path
```

Do all loop work in that worktree, on branch `loop/<id>`. **Never run on
`main`, and never stack on another feature branch.**

## Step 1: Bind the work item

The binding is a `.loop.md` file with frontmatter `id`, `kind`
(`bug|feature|usability|copy`), `title`, `risk`, optional `issue`, and an
`acceptance` list (field reference: `packages/harness/AGENTS.md`). If given a
binding path, read it; otherwise write one from the request to
`.ai/runs/<id>/binding.loop.md` (gitignored runtime). Validate the shape:

```bash
pnpm --filter @carbon/harness exec tsx -e "import {parseBinding} from '@carbon/harness'; import {readFileSync} from 'node:fs'; console.log(JSON.stringify(parseBinding(readFileSync('<path>','utf8'))))"
```

**Each acceptance criterion is the definition of done** — you are not finished
until every one is satisfied and provable.

The binding's **markdown body is grooming context** and is fed to the doer,
judge, and behavior gate: resolved questions, repro steps, test-data hints,
precedent pointers. Ambiguities should be settled there — at grooming time,
on the issue — before the loop ever starts, not asked mid-loop.

## Step 2: Plan — chunk the work before building

If the binding has more than a couple of criteria, decompose it into **2–6
small, ordered, independently-committable tasks** (schema first, then services,
then UI), each mapped to the criteria it advances. Each task must be small
enough for one focused session to build and one short review to verify. Record
the plan; every commit and ledger entry names its task. (Headless, the harness
does this itself — `runner/plan.ts`.)

## Step 3: The cycle (per task, repeat until its criteria are met or the human stops)

### 3.1 Doer

Make the **smallest change that completes the current task** — other tasks are
not this session's job. If the task won't fit in one focused session, stop at a
**coherent, committable slice** (compiles, lint-clean) and record what remains
— a clean partial slice is progress; a broken "complete" sprint is failure.
Never batch unrelated changes. Domain rules:

- **UI work**: FIRST find the nearest existing screen/component and copy its
  layout/components/approach — cite the precedent path. Never design from concepts.
- **ERP-domain logic** (accounting, RMA, costing, valuation, tax…): FIRST run
  `/research` — never invent domain logic.
- **Schema changes**: `pnpm run generate:types` after the migration, BEFORE
  typechecking (stale types make typecheck a false green).
- **Module code**: one `{module}.service.ts` + one `{module}.models.ts`.

### 3.2 Checkpoint, then gate

**Commit the doer's work immediately** — `wip`-style checkpoint commits, pushed
to the loop branch before any gate runs. Commit early, commit often: a failed
gate is feedback for the next attempt, never a reason to discard work with
`git checkout -- .`.

Run in order; every applicable gate must be green:

a. **Floor gates** — format first, then the harness gate suite (lint +
   `@carbon/checks` conformance + clobber detection), then scoped typechecks:

   ```bash
   pnpm exec biome check --write --no-errors-on-unmatched <changed paths>
   pnpm --filter @carbon/harness gates
   pnpm exec turbo run typecheck --filter=<pkg>   # per touched package, never whole-repo
   ```

b. **Behavior gate — mandatory for ANY user-facing change.** Choose the
   **simplest sufficient proof**:

   1. **Unit/integration test (red→green)** — preferred whenever the behavior is
      testable without a running stack: logic, transformations, rendering,
      conditional visibility, service behavior. Fast, CI-portable, lives on as a
      regression guard.
   2. **Agent-browser visual verification** — required when the proof is
      inherently visual (layout, spacing, overflow, animation): boot with
      `crbn up`, `/auth`, drive the screen per `/test`, capture BEFORE and
      AFTER screenshots.
   3. **CLI/script proof** — for non-UI changes (migrations, endpoints): a
      command demonstrating correct output.

   Never pick a heavier method when a lighter one gives the same confidence.
   The proof attempt has **three outcomes**, and the distinction matters:

   - **Proved** — you saw the behavior work. The gate is green.
   - **Disproved** — you reached the relevant state and the behavior is still
     wrong. The gate is red: fix forward on the next attempt.
   - **Unverifiable** — you could not reach the state either way (test data you
     can't construct at reasonable cost, stack won't boot, login/environment
     failure). This is **absence of proof, not disproof** — do NOT revert
     working, judge-approved code over it. Record exactly what proof is missing
     and what a human would need to do, keep going, and ship the PR **flagged
     for human verification** (draft + `agent:needs-verification`, see Step 5).
     Never spend the whole behavior budget grinding on test-data generation —
     stop early and mark it unverifiable.

c. **Correctness (bug fixes)** — reproduce→fix→same-path: the test (or recorded
   browser playbook) that failed on the bug must pass after the fix.

Any gate fails → the checkpoint STAYS; record why in the ledger and fix forward
on the next attempt. After ~3 failed attempts on the same task, park the
attempts on a rescue branch (`loop-rescue/<id>/t<k>`), reset to the last green
checkpoint, and surface it — never delete the attempts.

### 3.3 Judge — a separate subagent, never yourself

Dispatch a review subagent to check the diff against the acceptance criteria
and design rules. Do not grade your own homework, and do not accept a holistic
"looks good":

- **Decompose** each acceptance criterion + applicable design rule into atomic
  yes/no questions (one verifiable property each: "Is the precedent component
  actually reused, not re-implemented?", "Are audit fields + `companyId` set on
  every new write?").
- Each answer needs a **one-line justification citing a specific diff hunk or
  artifact** (file:line, test name, screenshot). A "yes" without a citation is a fail.
- **Enumerate failure modes explicitly** — regressions, missed edge cases,
  placeholder values, broken multi-tenancy.
- Approve only if every question passes. Any "no" → that question becomes the
  next iteration's weakest-covered target.
- Keep genuinely subjective criteria (copy clarity, polish) holistic — don't
  force atomic checks onto matters of taste.
- **Disputed criteria are questions, not targets.** If a criterion rests on a
  premise the code contradicts (the described mechanism doesn't exist) or
  hinges on a product decision no agent can make, don't iterate against its
  literal text — record it as *disputed* with a one-line question, exclude it
  from the unmet set, and surface the question on the PR/issue. Iterating
  cannot answer a product question; grooming can.

### 3.4 Decide + ledger

The task is **done** iff every gate is green AND the judge approves AND none of
the task's criteria remain unmet; otherwise the checkpoint stays and the next
attempt fixes forward. An *unverifiable* behavior proof does not make the gate
red — the change is kept and the proof gap travels with it to the PR as a
needs-verification flag. A judge that produces no verdict (after one retry) is
absence of review, not rejection: conclude the task *flagged* for human review.
Append one entry per iteration:

```bash
pnpm --filter @carbon/harness exec tsx -e "import {appendLedger} from '@carbon/harness'; appendLedger('.ai/runs/<id>/ledger.jsonl', {iteration: <n>, change: '<summary>', gates: {<gate>: <bool>}, decision: '<keep|checkpoint|revert>', reason: '<why>', task: '<k/N: title>', at: new Date().toISOString()})"
```

(The harness has no clock — you supply `at`.)

### 3.5 Terminate?

All tasks concluded (disputed criteria excluded, unverifiable proofs and
judge-less tasks flagged) → Step 4. A task exhausts its attempts or the human
stops → stop and report honestly — **but never discard committed work**: the
checkpoints are already on the pushed branch; open the PR per Step 5, marked
*partial*, and name any rescue branches.

## Step 4: Post-build freshness audit

Before opening the PR:

1. List touched package/module dirs:
   `git diff --name-only origin/main...HEAD | grep -E '^(packages|apps/erp/app/modules)/' | cut -d/ -f1-2 | sort -u`
   (modules: cut to depth 5 for `apps/erp/app/modules/{name}`).
2. For each with an `AGENTS.md`, fix any reference your changes made stale —
   small scoped edits in the same branch.
3. New pitfall discovered? Append it to `.ai/lessons.md`
   (`Context → Problem → Rule → Applies to`).

## Step 5: Finish — land a gated PR

1. Final pass: run `/check-and-commit` on the branch state (biome + gates), so
   the PR goes up clean.
2. Open the PR with `gh pr create` — **never merge**. The body must include:
   - the design rationale (precedent copied; research cited),
   - per acceptance criterion: **which gate proves it and how** (test name,
     before/after screenshots, or CLI output),
   - a ledger summary (iterations, kept/reverted and why),
   - **open questions** (disputed criteria, assumptions made instead of asking).
3. If any proof was unverifiable, or the loop ended partial: open the PR as a
   **draft** with the `agent:needs-verification` label and a warning section
   stating exactly what a human must verify (and how) before merge. Flagged,
   never silently dropped — and never presented as fully proven.
4. Loop artifacts (`.ai/runs/<id>/` — binding, ledger, screenshots) are
   gitignored runtime and never committed to the product tree; the harness's
   `openPr` hosts screenshots for embedding.
5. Surface every design decision for the human to approve or improve — design
   is never shipped silently.

## Guardrails — non-negotiable

- A user-facing change without sufficient proof is never presented as *done* —
  it ships as a **draft PR flagged `agent:needs-verification`** naming the
  missing proof. Absence of proof is not disproof; discarding gate-green,
  judge-approved work because verification was impossible is a bug, not rigor.
- Questions belong to grooming, not the loop. Never stop mid-loop to ask about
  preference or ambiguity — choose the precedent-matching interpretation,
  record the assumption, surface it on the PR. Reserve BLOCKED for hard
  impossibilities (missing credentials, destructive/production actions,
  a premise the code flatly contradicts).
- Commit early, push often. Never discard uncommitted work with
  `git checkout -- .` / `git clean` / `git reset --hard` without first parking
  it on a commit that is pushed somewhere (the loop branch or a rescue branch).
- Never auto-merge; never run on `main`; never background or fan out — this is
  the supervised loop.
- If blocked, say BLOCKED and why — and still salvage kept iterations as a
  partial draft PR.

## Growing this

- New floor gate: append `{ id, cmd }` to `FLOOR_GATES` in
  `packages/harness/src/gates.ts` (ask first — it raises the bar for all builds).
- New binding field: extend the frontmatter + `parseBinding` in
  `packages/harness/src/binding.ts`.
