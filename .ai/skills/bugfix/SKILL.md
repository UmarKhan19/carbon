---
name: bugfix
description: End-to-end bug-fix pipeline that orchestrates /root-cause, /debugging-difficult-bugs, /fix, /test, and /check-and-commit. At start it picks an autonomy mode (approval-before-each-phase vs fully autonomous) and a phase set (root-cause + fix are mandatory; runtime instrumentation is conditional on confidence, test is optional, commit runs only on explicit ask), auto-detected from the request and confirmed with the user when unclear. Keeps a structured run record at .ai/runs/{date}-{slug}.md. Use when fixing a bug, test failure, or unexpected behavior ("fix this bug", "why does X fail"). Do not use for building new features (use /feature). For a single watched item with explicit acceptance criteria, prefer /conductor.
---

# bugfix — end-to-end pipeline

Runs the bug-fix lifecycle by invoking the phase skills. Each phase's rules live
in its own skill; this skill only orchestrates — it chooses the autonomy mode,
selects which phases to run, drives them in order, and keeps the run record.

**Announce at start:** "Using the bugfix skill — {autonomy mode}, phases:
{selected}."

## The phases

| # | Phase | Skill | Artifact | Mandatory? | Hard stop |
|---|-------|-------|----------|-----------|-----------|
| 1 | Root cause | `/root-cause` | root-cause brief | **always** | 🛑 three-strikes architectural → surface to human |
| 2 | Runtime instrument | `/debugging-difficult-bugs` | log-backed cause | conditional | none |
| 3 | Fix | `/fix` | ready change + red→green regression test | **always** | 🛑 BLOCKED (2 failed fix attempts) → surface |
| 4 | Browser verify | `/test` | pass/fail + playbook | optional | user-facing flow must pass |
| 5 | Commit | `/check-and-commit` | conventional commit | **only on explicit ask** | gates must be green |

`/root-cause` and `/fix` are non-negotiable — the iron rule is *no fix without a
proven cause*, and the fix is the point. Everything else is opt-in.

## Step 0: Choose autonomy mode + phase set — always first

Write the run record (below) as you make these choices, then announce them.

### 0a. Autonomy mode

Detect from the request; ask only if neither is clear.

| Mode | Signals | Behavior |
|------|---------|----------|
| **Approval-per-phase** | "ask me", "step by step", "check with me", "gate each phase" | Pause before each phase, state what it will do in one line, wait for go. |
| **Fully autonomous** | "autonomously", "just fix it", "don't ask", "end to end" | Run unattended; auto-decide the conditional branches (instrument? test?) and record each choice. **The two 🛑 hard stops still surface** — architectural three-strikes and BLOCKED are not auto-resolvable. |

Default when ambiguous: **ask** — one question, the two options above.

### 0b. Phase set

Root-cause and fix always run. The rest are decided as follows — note some
branches resolve *after* root-cause, not upfront:

- **Runtime instrument (`/debugging-difficult-bugs`)** — a **runtime branch, decided
  after phase 1**: run root-cause first, read its Confidence line. Include when
  root-cause returns **MEDIUM/LOW** *and* the bug involves runtime state,
  ordering, caching, concurrency, streaming, or manual/UI reproduction. Skip when
  root-cause is **HIGH** or a stack trace / deterministic failing test already
  proves the cause.
- **Test (`/test`)** — include when the fix is user-facing or the proof is
  inherently visual (layout, spacing, animation). Skip for a pure-logic fix
  already covered by the `/fix` red→green regression test — log the skip
  ("browser test skipped — regression test covers it").
- **Commit (`/check-and-commit`)** — runs **only if the user explicitly asked to
  commit** (e.g. "fix and commit"). Otherwise the pipeline ends at fix (+ test)
  with a READY summary and stops; offer to commit, don't do it unprompted.

## Step 0c: Open the run record — the standardization artifact

Create `.ai/runs/{date}-{slug}.md` before phase 1. One canonical log of what was
diagnosed, decided, and proven — so the same bug handled by different engineers
produces comparable results.

```markdown
# Bugfix run: {title}

- Date: {date}            <!-- ask the user or use the injected currentDate; skills have no clock -->
- Mode: approval-per-phase | fully-autonomous
- Request: {the bug report, verbatim}
- Phase plan: root-cause [run] · instrument [run|skip — resolved after root-cause] · fix [run] · test [run|skip — why] · commit [run|skip — explicit ask?]

## Decisions            <!-- autonomous branch choices + any surfaced hard stop -->
- {branch/gate}: {decision} — {rationale} — {timestamp}

## Phase log
- root-cause: {confidence + brief summary}
- {phase}: {outcome + artifact path}

## Outcome
- {READY / committed SHA / PR link / BLOCKED + why}
```

Update it at each phase transition, when the instrument branch resolves, and on
any hard stop. Runtime lives in `.ai/runs/` (gitignored) — never in the product tree.

## Running the phases

Run the **selected** phases in order; skip the deselected ones. Announce each
transition in one line ("Phase 3: fix — cause confirmed HIGH, writing the test").

- **Approval mode:** before each phase, pause for the user's go.
- **Autonomous mode:** proceed between phases and auto-decide the instrument/test
  branches, recording each. But **stop and surface** at the two 🛑 hard stops —
  they need human judgment, not an auto-resolution.

The instrument decision is made live: after `/root-cause` outputs its brief, read
the Confidence line and branch per 0b before continuing.

## Entering mid-pipeline

Start at the first selected phase whose input is missing:

| You already have | Start at |
|------------------|----------|
| Nothing | Root cause |
| A proven root-cause brief | Fix (or Instrument if cause is MEDIUM/LOW + runtime) |
| An implemented fix, unverified | Test (or Commit if user asked) |

## Hard rules

- `/root-cause` and `/fix` always run — never skip diagnosis, never fix a guess.
- **Never commit unprompted.** `/check-and-commit` runs only on an explicit
  commit request; otherwise stop at READY and offer.
- The two 🛑 hard stops surface to the human **even in autonomous mode** —
  three-strikes-architectural (root-cause) and BLOCKED (fix). Record them; don't
  paper over them.
- Never present a guess as a finding — if root-cause can't reach a confident
  cause and no runtime path helps, stop and say so.
- Skipping a phase is a logged decision with a reason, not a silent omission.

## Alternative: the conductor

For a single tightly-scoped bug with explicit acceptance criteria that you want
to watch iterate to a gated PR, prefer `/conductor` — a supervised
doer→gate→judge loop instead of this pipeline.
