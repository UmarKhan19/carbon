# Loop System — Bindings, Runs, and the Conductor

The conductor loop drives a **Binding** (a scoped work item) through iterative doer → gates → judge cycles to produce a gated PR. All loop infrastructure lives in `@carbon/harness` (`packages/harness/`).

## Architecture

```
outer-loop (OpenClaw cron → Claude Code headless)
  └─ synthesizes a Binding from an assigned issue
  └─ dispatches: crbn up --minimal --run 'pnpm --filter @carbon/harness loop <binding> --cwd <worktree>' --volumes
       └─ harness runLoop (pure function, side effects via deps)
            ├─ doer   (claude -p) — makes changes in the worktree
            ├─ floor gates — lint, conformance, clobbers
            ├─ per-package typecheck — only touched packages
            ├─ behavior gate — UI verification (unit test > visual > CLI proof)
            ├─ correctness gate — doer's testCommand
            ├─ judge  (claude -p) — binary decomposition of acceptance criteria
            └─ keep / revert → next iteration or terminate
```

**Design docs:**
- `.ai/docs/outer-loop.md` — orchestrator architecture, wake loop, safety
- `.ai/skills/conductor/SKILL.md` — the inner-loop skill (what Claude Code follows during a build)

## Runtime Layout

Loop runtime state lives under `.ai/runs/<id>/` (`RUNS_DIR` in `layout.ts`). Per-run **directories** are gitignored (`.ai/runs/*/`); the committed markdown run logs from the plan/execute skills (`.ai/runs/*.md`) share the same root and stay tracked. Run dirs don't exist in a fresh checkout — `run-loop.ts` creates them when a loop executes.

```
.ai/runs/<id>/               # one loop run's ephemeral artifacts — GITIGNORED
├── binding.loop.md          # the binding this run was driven from
├── ledger.jsonl             # append-only per-iteration record
├── run.log.jsonl            # full event log
├── outcome.json             # final LoopOutcome (machine-readable result)
└── screenshots/             # behavior-gate captures (hosted on loop-artifacts branch)
```

Outer-loop scratch (`agent-state.db`, daily notes) lives on the OpenClaw box, not in this repo.


**Key exports from `layout.ts`:**
- `RUNS_DIR` — repo-relative root for run artifacts
- `runDir(cwd, id)`, `bindingPath(cwd, id)`, `ledgerPath(cwd, id)`, `logPath(cwd, id)`, `outcomePath(cwd, id)`, `screenshotsDir(cwd, id)`, `hostedScreenshotPath(id, name)`

## Binding Format

Bindings live at `.ai/runs/<id>/binding.loop.md`. The parser (`parseBinding` in `binding.ts`) reads the YAML frontmatter for structured fields; the **markdown body after the frontmatter is captured as `notes`** — grooming context (resolved questions, repro steps, test-data hints) that is injected into the doer, judge, and behavior-gate prompts. Put everything the loop needs to not ask questions there.

```markdown
---
id: bug-reorder-align
kind: bug
title: Reorder button misaligns on short rows
risk: low
acceptance:
  - Reorder button vertically centers in the row at <640px
  - No new console errors on the line-items page
---

Freeform notes / context for the loop (optional).
```

| Field | Type | Values |
|-------|------|--------|
| `id` | string | unique identifier for the run |
| `kind` | enum | `bug` · `feature` · `usability` · `copy` |
| `title` | string | concise description |
| `risk` | enum | `low` · `med` · `high` (⚠️ `med`, not `medium`) |
| `acceptance` | string[] | concrete, testable criteria (contiguous `- item` lines) |
| `issue` | number? | GitHub issue number (PR body gets `Closes #<n>`; `Related to #<n>` on partial PRs) |
| `notes` | string? | markdown body — grooming context fed to doer/judge/behavior prompts |

**Validation:** `parseBinding` requires `id` and a valid `kind`. Risk defaults to `"low"` if absent. Acceptance must be inside the frontmatter block as contiguous `- item` lines — a blank line or another key ends the list.

## Floor Gates

Every dirty iteration runs these before the judge sees the change:

| Gate | Command |
|------|---------|
| `lint` | `pnpm exec biome check` |
| `conformance` | `pnpm --filter @carbon/checks test` |
| `clobbers` | `pnpm --filter @carbon/checks clobbers` |

Plus **per-package typecheck** for each package the doer touched.

## Runner Configuration

`DEFAULT_CONFIG` in `runner/types.ts`:

| Setting | Value | Notes |
|---------|-------|-------|
| `plateauAfter` | 2 | consecutive no-progress iterations before stopping |
| `maxIterations` | 8 | hard ceiling on total iterations |
| `doerMaxTurns` | 60 | |
| `doerMaxBudgetUsd` | $5 | |
| `judgeMaxTurns` | 20 | |
| `judgeMaxBudgetUsd` | $2 | |
| `behaviorMaxTurns` | 300 | raised from 40 in #961 |
| `behaviorMaxBudgetUsd` | $15 | raised from $3 in #961 |

## Terminal States

`LoopOutcome.state` is one of:

| State | Meaning |
|-------|---------|
| `shipped` | green committed state, PR opened (or updated) — possibly flagged `unverified` |
| `blocked` | doer reported a hard blocker (impossibility, never a question of preference) |
| `plateau` | `plateauAfter` consecutive iterations with no kept change |
| `error` | unexpected failure |

`LoopOutcome` also carries:

- **`unverified?: string[]`** — proof gaps on kept work: the behavior gate could not verify **either way** (missing test data it couldn't construct, capped session, stack down). Absence of proof is *not* disproof — the work still ships, as a **draft PR** labeled `agent:needs-verification` whose body names exactly what a human must verify. Only a gate that *reached the state and saw the change not work* (`verdict: "failed"`) reverts the iteration.
- **`questions?: string[]`** — product questions raised mid-loop: acceptance criteria the judge *disputed* (wrong premise / needs a product decision — excluded from `unmet` so the loop doesn't churn on them) plus assumptions the doer made instead of blocking. The outer loop posts these back to the issue so grooming resolves them before any re-dispatch.
- **`prUrl?`** — set for shipped runs *and* for **salvage PRs**: when a run ends `plateau`/`blocked` but kept (gate-green, judge-approved) commits exist, `run-loop` still opens a draft PR marked `[partial]` (`Related to #<n>`, never `Closes`) instead of letting the worktree GC discard paid-for work.

The outer loop reads `outcome.json` to decide next steps (report, label, escalate).

## GC

Prune finished runs with:

```bash
pnpm --filter @carbon/harness run gc -- [--cwd <dir>] [--keep-last <n>] [--max-age-days <n>]
```

`pruneRuns`, `listRuns`, and `readOutcome` are exported from `@carbon/harness` for the outer-loop janitor. **Unfinished runs (no `outcome.json`) are never pruned** — they may be in flight.

## Harness Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `loop` | `pnpm --filter @carbon/harness run loop <binding-path> [--cwd <worktree>] [--no-pr]` | run one loop to a gated PR |
| `gates` | `pnpm --filter @carbon/harness run gates` | run floor gates only |
| `gc` | `pnpm --filter @carbon/harness run gc [--cwd <dir>] [--keep-last <n>] [--max-age-days <n>]` | prune finished runs |
