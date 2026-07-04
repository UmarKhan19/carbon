# @carbon/harness

AI agent harness — binding parsing, gate execution, the conductor loop, ledger, worktree management, and PR creation.

## Always

- **Parse bindings from `.loop.md` frontmatter** — `parseBinding(md)` extracts `id`, `kind`, `risk`, `title`, `acceptance[]`, and optional `issue` number
- **Run floor gates before accepting changes** — `FLOOR_GATES` (lint, conformance, clobbers) are the minimum quality bar; the loop reverts on gate failure
- **Append to the JSONL ledger after every iteration** — `appendLedger(path, entry)` records iteration, change, gates, decision (keep/revert), reason, timestamp, and any `unverified`/`questions`/`assumptions`
- **Distinguish disproof from absence of proof** — a behavior gate that reached the state and saw the change fail reverts the iteration; a gate that could not verify either way (`unverified`) keeps judge-approved work and ships it as a draft PR labeled `agent:needs-verification`
- **Never discard kept work** — non-shipped outcomes (plateau/blocked) with kept commits still open a `[partial]` salvage draft PR via `run-loop`
- **Never merge from the harness** — the loop ships PRs; merging is the human gate

## Ask First

- Adding new `FLOOR_GATES` (extends the CI quality bar for all agent builds)
- Changing the `runLoop` terminal-state machine (keep/revert/shipped logic)
- Modifying prompt templates in `runner/prompts.ts`

## Never

- Run the loop on `main` — it only operates in worktrees on feature branches
- Skip gates — even if the doer claims the change is trivial
- Merge PRs from harness code — PR approval is always the human gate

## Validation Commands

```bash
pnpm --filter @carbon/harness test     # vitest — unit tests
pnpm --filter @carbon/harness gates    # run floor gates
pnpm --filter @carbon/harness loop     # run the conductor loop (needs a binding)
pnpm --filter @carbon/harness gc       # prune old run directories
```

## Key Patterns

- **Binding**: `src/binding.ts` — YAML-ish frontmatter parser; `LoopKind = "bug" | "feature" | "usability" | "copy"`; the markdown body is captured as `notes` (grooming context injected into all three prompts)
- **Gates**: `src/gates.ts` — `FLOOR_GATES[]` + `runGates(gates, exec)` → `GateResult[]`
- **Loop**: `src/runner/loop.ts` — `runLoop(binding, config, deps)` drives one work item through doer → behavior → judge → gates → keep/revert; collects `unverified` (proof gaps on kept work) and `questions` (judge-disputed criteria + doer assumptions) onto `LoopOutcome`
- **Behavior verdicts**: `src/runner/behavior.ts` — three-way `passed | failed | unverified`; stack-down, capped sessions, and unbuildable test data are `unverified`, never `failed`
- **Ledger**: `src/ledger.ts` — append-only JSONL log of iteration outcomes
- **PR**: `src/runner/pr.ts` — `openPr(binding, ledgerPath, shell, cwd, flags)`; `Closes #<issue>` when binding has `issue` (`Related to` on partial PRs); `flags.unverified`/`flags.partial` → draft + `agent:needs-verification` label
- **Shell**: `src/runner/shell.ts` — `sq()` for safe quoting; `src/runner/claude.ts` — headless Claude invocation

## Cross-References

- `packages/checks/` — `@carbon/checks test` and `clobbers` are floor gates
- `.ai/skills/conductor/SKILL.md` — the conductor skill that this harness implements
- `.ai/docs/outer-loop.md` — outer-loop design docs
- `packages/dev/` — `crbn up --run` for booting stacks in CI/headless
