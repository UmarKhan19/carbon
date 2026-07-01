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

The entire `llm/` directory is **gitignored** — it holds only runtime state, never committed docs.

```
.ai/
├── outer-loop/
│   ├── agent-state.db      # outer-loop scratch (SQLite)
│   └── daily-notes/        # per-day operational logs
└── loops/
    └── runs/<id>/           # one loop run's ephemeral artifacts
        ├── binding.loop.md  # the binding this run was driven from
        ├── ledger.jsonl     # append-only per-iteration record
        ├── run.log.jsonl    # full event log
        ├── outcome.json     # final LoopOutcome (machine-readable result)
        └── screenshots/     # behavior-gate captures (hosted on loop-artifacts branch)
```


**Key exports from `layout.ts`:**
- `LOOPS_DIR`, `RUNS_DIR` — repo-relative roots
- `runDir(cwd, id)`, `bindingPath(cwd, id)`, `ledgerPath(cwd, id)`, `logPath(cwd, id)`, `outcomePath(cwd, id)`, `screenshotsDir(cwd, id)`, `hostedScreenshotPath(id, name)`

## Binding Format

Bindings live at `.ai/loops/runs/<id>/binding.loop.md`. The parser (`parseBinding` in `binding.ts`) **only reads YAML frontmatter** — markdown body after `---` is supplementary context only.

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
| `issue` | number? | GitHub issue number (PR body gets `Closes #<n>`) |

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
| `shipped` | green committed state, PR opened (or updated) |
| `blocked` | doer reported a blocker, or behavior gate can't boot the stack |
| `plateau` | `plateauAfter` consecutive iterations with no kept change |
| `error` | unexpected failure |

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
