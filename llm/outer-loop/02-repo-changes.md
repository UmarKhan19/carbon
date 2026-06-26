# Deliverable 2 — Changes in this repo

## Guiding principle

The repo stays a **deterministic, judgment-free dispatch primitive**. Everything that requires *judgment about GitHub* — reading an issue, synthesizing a Binding, deciding priority, parsing review feedback — lives in the OpenClaw orchestrator, **not here**. The repo's only job is to expose a clean, machine-readable, re-enterable contract: *given a Binding and a worktree, run the loop and report a structured result.*

This mirrors the inner loop's own split (deterministic harness, narrow model calls) and keeps the repo from growing a GitHub dependency.

### Explicitly OUT of scope for the repo (stays in OpenClaw)

- ❌ Reading a Binding *from* a GitHub issue / `gh issue view` parsing.
- ❌ A `crbn dispatch <issue-number>` command.
- ❌ Prioritization / "what to work on next."
- ❌ Webhook handling, labels, assignment logic.

The orchestrator already calls existing repo commands for worktree lifecycle (`crbn new … --base origin/main --yes`, `crbn up --run …`) — no repo change needed there.

---

## The change set

Grounded against the current code. Small and additive.

### 0. Codify the `llm/` layout + GC into the harness ✅ DONE (this branch)

The `llm/` tree was getting sloppy: path strings (`llm/loops/<id>/…`) hardcoded across four files, a fragile gitignore allow-list, docs and runtime interleaved, and no GC. Fixed:

- **`packages/harness/src/layout.ts`** — the single owner of every loop path. All runtime now lives under one gitignored root `llm/loops/runs/<id>/` (`binding.loop.md`, `ledger.jsonl`, `run.log.jsonl`, `outcome.json`, `screenshots/`). `run-loop.ts`, `pr.ts`, `behavior.ts` all import it; zero hardcoded path literals remain.
- **`packages/harness/src/runs.ts`** — `listRuns` / `readOutcome` / `pruneRuns` (+ `pnpm --filter @carbon/harness run gc`). The outer-loop janitor calls `pruneRuns` each heartbeat; **unfinished runs are never pruned**.
- **`.gitignore`** collapses to one line: `llm/loops/runs/`. Everything else under `llm/` is tracked docs by default.
- Docs synced: `llm/loops/README.md`, `.claude/skills/conductor/SKILL.md`.
- Tests: `src/runs.test.ts` (GC policy). Full suite green (26), typecheck + lint clean.

This change absorbed A & B (below) — `outcomePath` / `bindingPath` are just functions in `layout.ts`.

### A. Put `prUrl` in the outcome and write a structured `outcome.json` ⭐ (highest value)

**Why:** Today the PR URL is only emitted as a stray stdout log line (`{"event":"pr","url":…}`), and `LoopOutcome.prUrl` is declared but never populated. An external orchestrator must scrape stdout — fragile. Give it a file to read.

**Current:**
- `packages/harness/src/runner/types.ts` — `LoopOutcome { state, iterations, prUrl?, reason }` (`prUrl` never set).
- `packages/harness/src/scripts/run-loop.ts` — logs `{event:"pr", url}` separately; exit 0 only when `shipped`.

**✅ DONE (this branch).**
1. `run-loop.ts` sets `outcome.prUrl` after `openPr(...)`.
2. Writes the final outcome to `llm/loops/runs/<id>/outcome.json` via `layout.outcomePath`.

**Contract the orchestrator reads:**
```jsonc
// llm/loops/runs/<id>/outcome.json
{ "state": "shipped", "iterations": 3, "prUrl": "https://github.com/crbnos/carbon/pull/123", "reason": "all acceptance criteria met and provable" }
```

Done together with the layout codification (§0) — `outcomePath` is just one more function in `layout.ts`.

---

### B. Persist the Binding into the loop directory

**Why:** A run should be self-describing — re-entry (C) and post-hoc inspection need to know what the Binding was without the orchestrator keeping it externally.

**✅ DONE (this branch).** `run-loop.ts` writes the raw binding md to `llm/loops/runs/<id>/binding.loop.md` (`layout.bindingPath`) before running. (`llm/loops/runs/` is gitignored runtime — never enters the product tree.)

---

### C. Make PR-opening idempotent → unlocks re-entry for review feedback

**Why:** This is the one change that enables the PR-feedback loop. Today `openPr` unconditionally runs `gh pr create`, which **fails if a PR already exists** for the branch. For re-entry, the orchestrator re-runs the loop in the *same* worktree with feedback-derived acceptance criteria; PR-opening must then *update* the existing PR instead of erroring.

**Current** (`packages/harness/src/runner/pr.ts`, `openPr`):
```
git push -u origin HEAD
gh pr create --title … --body-file …     // errors if PR exists
```

**Change:** make it create-or-update:
```
git push -u origin HEAD
if gh pr view --json url  (a PR exists for HEAD)
   → return its URL (commits are already pushed; optionally refresh the body)
else
   → gh pr create … as today
```

With this, re-entry needs **no new command** — the orchestrator just runs the existing `loop` script again with `--cwd <existing-worktree>` and a feedback binding; new commits land on the open PR, and `appendLedger` continues the same `ledger.jsonl`. (Iteration numbering can continue from the existing ledger length; minor.)

**Size:** ~20 lines in `pr.ts`. **Risk:** low; preserves the fresh-PR path unchanged.

---

### D. Optional issue linkage so merge auto-closes the issue

**Why:** The OpenClaw state machine relies on "human merges PR → issue auto-closes → done." That only works if the PR body contains `Closes #<issue>`. The harness currently doesn't know the issue number.

**Change:** add an optional `issue` field to the Binding (and/or a `--closes <n>` flag on `run-loop.ts`); when present, `openPr` adds a `Closes #<n>` line to the PR body. Absent → unchanged behavior.

- `packages/harness/src/binding.ts` — optional `issue?: number` in `Binding` + parse it.
- `packages/harness/src/runner/pr.ts` — emit `Closes #<issue>` when set.

**Size:** ~10 lines. **Risk:** none (optional/back-compat).

---

### E. Docs + label definitions (trivia)

- Document the `agent:*` label set and the webhook event list (`issues`, `pull_request_review`, `pull_request_review_comment`) — a short note here and/or a `.github` labeler config so the labels exist in the repo.
- Note where the `carbon-agent` HMAC/webhook secret is configured (it lives with the orchestrator; the repo just documents the event contract).

**Size:** docs only. **Risk:** none.

---

### F. Teardown that prunes Docker volumes (resource janitor affordance)

**Why:** the box is RAM/disk-bound and builds are serial-ish (`N`, default 1), so resource hygiene is load-bearing. `crbn up --run` already scopes the stack (boot→run→teardown), but `crbn down` **explicitly preserves volumes** (`down.ts:32` "volumes preserved") — so a Docker-volume buildup accumulates across dispatches and `crbn` never reclaims it. Worktrees are already covered by `crbn remove --prune`; volumes are the gap.

**Change:** add a `--volumes` (a.k.a. `--clean`) flag to `crbn down` (and pass-through from `crbn up --run`) that runs `docker compose down -v` for the Carbon project + prunes the dispatch's named/anonymous volumes. **Scoped by compose project name** so nothing unrelated on the box is touched.

- `packages/dev/src/commands/down.ts` — optional volume removal.
- `packages/dev/src/commands/up.ts` — propagate the flag through the `--run` teardown `finally`.

**Size:** ~15 lines. **Risk:** low (opt-in flag; default behavior unchanged). The orchestrator can otherwise fall back to a scoped `docker volume prune` itself, but a first-class flag is cleaner and safer.

---

## Summary table

| # | Change | Files | Status | Risk | Unblocks |
|---|---|---|---|---|---|
| 0 | `llm/` layout + GC codified in harness | `layout.ts`, `runs.ts`, `scripts/prune-runs.ts`, `.gitignore`, docs | ✅ done | none | clean `llm/`; janitor GC; absorbs A & B |
| A | `prUrl` in outcome + `outcome.json` | `scripts/run-loop.ts`, `layout.ts` | ✅ done | none | reliable dispatch parsing (build step 1) |
| B | Persist binding to run dir | `scripts/run-loop.ts`, `layout.ts` | ✅ done | none | self-describing runs / re-entry |
| C | Idempotent PR open (create-or-update) | `runner/pr.ts` | ✅ done | low | **PR-feedback re-entry** (build step 3) |
| D | Optional `Closes #<issue>` linkage | `binding.ts`, `runner/pr.ts` | ✅ done | none | merge → auto-close → GitHub state machine |
| E | Label + webhook-event docs | `llm/outer-loop/`, `.github/` | pending | none | clarity |
| F | `crbn down --volumes` teardown | `dev/commands/down.ts`, `up.ts`, `main.ts` | ✅ done | low | box resource hygiene |

## Status

**0, A, B, C, D, F are landed.** Only **E** (label + webhook-event docs / `.github` labeler) remains, and it's documentation that pairs naturally with building the OpenClaw orchestrator.

- **C** — `openPr` now checks `gh pr view` and updates the existing PR (`gh pr edit`) instead of failing `gh pr create`, so re-running the loop in the same worktree (PR-feedback re-entry) just lands new commits on the open PR. Covered by `pr.test.ts`.
- **D** — `Binding` gained an optional numeric `issue`; when set, the PR body carries `Closes #<n>`. Covered by `binding.test.ts`.
- **F** — `crbn down --volumes` (and `crbn up --run --volumes`) prune the stack's Docker volumes on teardown via the existing `stopStack(…, withVolumes)`; default behavior unchanged.

No GitHub dependency enters the repo; the deterministic boundary holds.
