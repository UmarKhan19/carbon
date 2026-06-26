# Deliverable 3 — Setup plan for the Claude running inside the OpenClaw box

**Audience:** you are Claude running *inside* the OpenClaw box that will become Carbon's autonomous "agentic employee" (the outer loop). This is a setup plan: adapt this OpenClaw installation's **basics** so it's suited to that role. You have no memory of the conversation that produced this — treat the Carbon repo docs as the spec and **verify every OpenClaw specific against this box's own `AGENTS.md` + docs**, because OpenClaw versions differ and the paths/commands below are from external research, not from your actual install.

## What this box is becoming

A persistent agent that: watches `crbnos/carbon` on GitHub, turns **assigned** issues into well-scoped work, dispatches the **conductor inner loop** to produce a **gated PR**, shepherds that PR through review feedback, and **grooms** the backlog when idle. It is the deterministic-shell-plus-narrow-judgment pattern one level up from the inner loop. It **never merges** and only acts on issues a human assigned to it.

Read these first (they are the full design — this plan only covers *box setup*):
- `llm/outer-loop/01-openclaw-plan.md` — the orchestrator/builder split, assign-to-build / idle-grooms, webhooks, the wake loop, safety rails.
- `llm/outer-loop/02-repo-changes.md` — the dispatch contract the harness exposes.
- `.claude/skills/conductor/SKILL.md` + `packages/harness/` — the inner loop you will invoke.

---

## Phase 0 — Discover the current setup (do this before changing anything)

Don't assume; look. Capture the real state:

- Read this box's **`AGENTS.md`** and any `docs/` for OpenClaw — note the real locations of: the agent dir, the shared/per-agent SQLite DBs, `HEARTBEAT.md`, hooks, cron, channels, and sandbox config.
- List agents and their config; identify (or plan to create) the agent that will hold this role.
- Inventory what's installed: `git`, `gh`, `node`, `pnpm`, `docker` (+ compose), the `claude` CLI (the inner loop shells out to `claude -p`), and `agent-browser` (the behavior gate drives it). Record versions.
- Check current automation: is the **heartbeat** firing autonomously, or does it need a nudge (known OpenClaw issue: cron/heartbeat may only fire after a manual message)? Check channels already configured.

Write findings to your durable memory so later phases build on facts, not guesses.

---

## Phase 1 — Identity & credentials (`carbon-agent`)

- Authenticate `gh` as the dedicated machine user **`carbon-agent`** with write to `crbnos/carbon`. Store the token in the agent's auth store — **never** inside a worktree or a committed file. (Long-term: migrate to a GitHub App with a per-repo install; a PAT is fine to start.)
- Set git identity for commits: `git config user.name "carbon-agent"` / `user.email <agent email>` so PR commits attribute cleanly to the bot, distinct from humans.
- Confirm: `gh auth status`, and that `gh pr view`/`gh issue list` work against `crbnos/carbon`.

## Phase 2 — Build environment readiness

The inner loop runs `crbn up --run '… harness loop …'`, which boots a full Docker-compose stack. Decide **where** that runs:

- **If builds run in this sandbox:** it needs Docker. OpenClaw sandboxes are Docker containers, so this is Docker-in-Docker (or a mounted host Docker socket) — confirm which your install supports and that `docker ps` works from where the loop will run. If neither is acceptable, provision a **separate builder host** the agent SSHes into and run `crbn up --run` there. (See `01-openclaw-plan.md` §2 — the orchestrator/builder split exists precisely because of this.)
- Clone `crbnos/carbon`, install the toolchain (`pnpm install`), and verify a cold `crbn up --run 'echo ok' --volumes` boots → runs → tears down (and prunes volumes).
- Install/verify **`claude` CLI** (inner-loop doer/judge/behavior) and **`agent-browser`** (behavior gate). The behavior gate reads `DEV_BYPASS_EMAIL` from the worktree's `.env.local` (which `crbn up` writes) — confirm it's present so UI verification can log in.

## Phase 3 — The agent's operating instructions

Encode the role into the agent's system prompt / `AGENTS.md` (whatever this OpenClaw uses as standing instructions). It must state:

- **Behavior:** issue assigned to `carbon-agent` → build it; nothing assigned → groom one backlog issue. Finish in-flight PR feedback before starting new builds. (Full wake order in `01-openclaw-plan.md` §5.)
- **Dispatch recipe** (the mechanical core — paste verbatim):
  ```
  git fetch origin main
  crbn new loop/<id> --base origin/main --yes        # prints the worktree path; cd into it
  # write the synthesized binding to llm/loops/runs/<id>/binding.loop.md
  crbn up --run 'pnpm --filter @carbon/harness loop <binding-path> --cwd .' --volumes
  # then read the result:
  cat llm/loops/runs/<id>/outcome.json   # { state, prUrl?, reason }
  ```
  On `shipped`: the harness opened a gated PR (with `Closes #<issue>` if the binding carried `issue`); comment the PR link on the issue, drop the `agent:working` label, report to the channel. On `blocked`/`plateau`/`error`: apply `agent:blocked`, comment `reason`, drop the lease.
- **Binding synthesis is your judgment, with a refusal path:** if you can't write crisp acceptance criteria, or the issue is epic-sized (a whole module), do NOT dispatch — apply `agent:needs-decomposition`, comment a proposed breakdown, stop.
- **Hard safety rails (non-negotiable):** never merge; only ever build issues assigned to you; respect a daily `$` budget; rate-limit comments; a kill switch (unassign / pause) must stop you. Every external write is auditable on GitHub.

## Phase 4 — `HEARTBEAT.md` (the wake loop)

Make the heartbeat body the tick from `01-openclaw-plan.md` §5, in order: **reconcile leases → PR feedback → assigned issue → else groom one → GC + report**. Keep build concurrency at `N` with a SQLite semaphore, **default `N=1`** (one full stack at a time on this box; raise only if the box grows). Reconcile reads GitHub (`agent:working` issues assigned to you: open PR? → in review; no PR + no live build? → drop the label, re-pickable).

## Phase 5 — Webhook ingestion (outbound WebSocket relay)

The box is Tailscale-locked (no public inbound), so use **egress-only** delivery — the bot only makes outbound connections:

- Run, as a long-lived process, an outbound-WebSocket relay (`gh webhook forward` mechanism / `gr2m/github-webhook-relay`):
  ```
  gh webhook forward --repo crbnos/carbon \
    --events issues,pull_request_review,pull_request_review_comment \
    --url http://localhost:<port>
  ```
- Wire its events into an OpenClaw **hook** so an assignment or a review comment wakes the agent immediately (don't wait for the next heartbeat). HMAC-verify payloads even though there's no public surface.
- Do **not** open a Tailscale Funnel / public port — that would undo the lockdown. Outbound WS preserves it. (Rationale in `01-openclaw-plan.md` §3.)

## Phase 6 — Cron

- A scheduled **Docker/worktree GC** + **`pnpm --filter @carbon/harness run gc`** to prune finished loop runs (`llm/loops/runs/`), and a **daily budget reset**.
- Because autonomous heartbeats can be flaky, add an external **heartbeat poke** (system cron or a scheduled GitHub Action that pings the agent) so the tick fires even if the internal scheduler stalls.

## Phase 7 — State & memory

- **Scratch state** in the agent's SQLite (or OpenClaw KV): daily-`$`-spent, last-seen review-comment cursor, in-flight dispatch handles, the build semaphore. Authoritative task state is always GitHub — SQLite is recoverable scratch.
- **Durable memory** — seed it with the load-bearing Carbon facts so synthesis/grooming are correct from day one: **pnpm, never npm**; **never merge**; the behavior gate is **mandatory** for UI changes (before/after screenshots) and the loop **blocks** if the stack can't boot; `agent:*` label meanings; that bindings live at `llm/loops/runs/<id>/`. Accumulate lessons over time (which areas plateau, reviewer preferences) and feed them back into prompts.

## Phase 8 — Channels (reporting)

Configure a reporting channel (Slack/Discord) for: `shipped PR #N`, `blocked: <reason>`, `needs-decomposition #N`, and PR-feedback escalations after the round cap. This is how the supervising human stays in the loop without watching the box.

## Phase 9 — Resource & safety config

- Build concurrency `N=1` (semaphore); per-dispatch teardown via `crbn up --run … --volumes`; scheduled `docker volume prune` / dangling-image prune **scoped by the Carbon compose project name + `openclaw-sbx-*`** so nothing unrelated is touched.
- Pre-flight disk/RAM watermark before dispatch — below threshold → GC first or refuse and report.
- Confirm the kill switch and budget ceilings actually halt dispatch.

## Phase 10 — Supervised smoke test (do this before going autonomous)

1. Assign **one small, well-specified issue** to `carbon-agent` (e.g. a real bug with a known root cause — see `#450` style).
2. Watch one full cycle: synthesize binding → `crbn new` → `crbn up --run … --volumes` → read `outcome.json` → gated PR with `Closes #<issue>` → PR link commented → `agent:working` cleared → channel report.
3. Post a review comment on that PR; confirm the agent re-enters on the same branch, lands a follow-up commit on the **same** PR (idempotent `openPr`), and resolves the thread.
4. Confirm GC ran and volumes/worktree were reclaimed.

Only after this passes end-to-end should the heartbeat run unattended — and even then, keep it supervised (a human watches the channel and approves every PR).

---

## Definition of done for box setup

- [ ] `gh` authed as `carbon-agent` (write to `crbnos/carbon`); git identity set; token outside worktrees.
- [ ] `crbn up --run 'echo ok' --volumes` boots → runs → tears down + prunes volumes; `claude` + `agent-browser` present; `DEV_BYPASS_EMAIL` available.
- [ ] Agent instructions encode: assign-to-build / idle-groom, the dispatch recipe, synthesis-with-refusal, and the hard safety rails (never merge, assigned-only, budget, kill switch).
- [ ] `HEARTBEAT.md` runs the wake loop; concurrency semaphore `N=1`.
- [ ] Outbound-WS webhook relay running and wired to a hook; no public ingress opened.
- [ ] Cron: GC + `harness run gc` + budget reset + external heartbeat poke.
- [ ] SQLite scratch + durable memory seeded with the Carbon facts.
- [ ] Reporting channel live.
- [ ] Supervised smoke test passed end-to-end (build + PR-feedback re-entry + GC).
