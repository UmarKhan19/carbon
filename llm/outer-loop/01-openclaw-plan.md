# Deliverable 1 — The Outer Loop on OpenClaw

The outer loop runs on **OpenClaw as the runtime** (heartbeat, webhooks, cron, channels, SQLite state, sandbox) with a **headless Claude Code agent** doing all the reasoning, plus an **ephemeral builder**. It manufactures Bindings from GitHub issues, dispatches the inner loop, and shepherds the resulting PR through review — all under a dedicated machine user (`carbon-agent`) that **never merges**.

> **Agent runtime.** OpenClaw does *not* do the thinking. Each wake it invokes `claude -p --dangerously-skip-permissions "<outer-loop prompt>"` in the Carbon checkout — Claude Code is the agent for triage, binding synthesis, dispatch, grooming, and PR-feedback. This is the natural fit because the inner loop is *already* Claude Code (the harness shells out to `claude -p` for doer/judge/behavior), so it's Claude Code top to bottom with OpenClaw as the scheduler/sandbox around it. The box runs non-root, so the bypass-permissions flag works (Claude Code refuses it as root); the sandbox + scoped `carbon-agent` token are the guardrails. Full setup in [03-openclaw-box-setup.md](03-openclaw-box-setup.md).

---

## 1. Mental model

The inner loop is `Binding → gated PR`. So the outer loop owns everything *around* that:

```
              ┌─── OpenClaw runtime (in the tailnet) · each wake invokes `claude -p` as the agent ───────┐
 GitHub  ◀──▶ │  webhooks (outbound WS relay)   +   periodic heartbeat                                  │
 (truth)      │        │                                  │                                              │
              │        ▼                                  ▼                                              │
              │   wake → reconcile → [PR feedback? assigned? else groom] → act → report → reflect        │
              │                                   │ dispatch (judgment: synth Binding)                   │
              └───────────────────────────────────┼──────────────────────────────────────────────────────┘
                                                  ▼  shells into
              ┌──────────────────── Builder (Docker + Carbon repo, ephemeral) ────────────────────┐
              │  crbn new loop/<id> --base origin/main --yes                                        │
              │  crbn up --run 'pnpm --filter @carbon/harness loop <binding> --cwd .'   ◀─ inner loop│
              │  → reads outcome.json { state, prUrl, reason }                                       │
              └─────────────────────────────────────────────────────────────────────────────────────┘
```

The orchestrator is small, cheap, and always-on. The builder is heavy (it boots the full Carbon stack) and **ephemeral** — `crbn up --run` boots → runs the loop → tears the stack down per dispatch.

---

## 2. Why the orchestrator and builder are separate boxes

OpenClaw runs agents in Docker (one container per agent). But the inner loop needs `crbn up` — *itself* a full Docker-compose stack (Postgres, Redis, Supabase, edge runtime). Running that inside the OpenClaw sandbox is Docker-in-Docker: heavy and a security hole if you hand the sandbox the host Docker socket.

So **don't**. Two roles:

- **Orchestrator** = the OpenClaw runtime + the headless Claude Code agent it invokes each wake. Light, always-on. Heartbeat/webhooks + SQLite + GitHub I/O + channel reports. It *decides and dispatches*; it never builds.
- **Builder** = a worker with Docker + the Carbon repo. The orchestrator shells in to run one `crbn up --run '… loop …'` per dispatch. Stateless and ephemeral by design.

Bonus: if the orchestrator restarts, in-flight builds aren't killed, and it reconciles state from GitHub (below).

---

## 3. Triggers — webhooks (low latency) + heartbeat (durability)

Both in v1.

### Webhooks via an **outbound WebSocket relay** (works behind Tailscale)

The bot is Tailscale-locked: no public inbound. A normal inbound webhook can't reach it. Solution: an **egress-only** relay — the orchestrator opens an *outbound* WebSocket to GitHub and webhooks arrive over that connection. No listening port, no public DNS, no Funnel hole — pure egress, which Tailscale allows untouched.

- Mechanism: [`gr2m/github-webhook-relay`](https://github.com/gr2m/github-webhook-relay) / the `gh webhook forward` outbound-WS approach.
- Lowest-effort form, run inside the tailnet:
  ```
  gh webhook forward --repo crbnos/carbon \
    --events issues,pull_request_review,pull_request_review_comment \
    --url http://localhost:<port>
  ```
- Events we care about: **`issues`** (assigned/labeled), **`pull_request_review`** + **`pull_request_review_comment`** (review feedback on the bot's PRs).
- HMAC-verify payloads anyway (defense in depth), even though there's no public surface.

### Heartbeat (periodic)

OpenClaw's `HEARTBEAT.md` defines the periodic wake. It does **reconcile + groom + gap-recovery**: it catches anything the WebSocket missed during a disconnect (reconciling against GitHub directly), and it's what runs the auto-groomer when idle. The WebSocket gives latency; the heartbeat gives durability. They are complementary, not redundant.

> Known OpenClaw issue: cron/heartbeat may only fire after a manual message ([openclaw#14501](https://github.com/openclaw/openclaw/issues/14501)). Mitigated here because (a) webhooks are the primary driver and (b) a human assigning an issue *is* the manual nudge. Early operation is supervised anyway.

---

## 4. State lives in GitHub. Labels + assignment + PR are the source of truth.

No database. State machine encoded in GitHub primitives (all plain repo-scoped writes — **no `read:project`/`project` scope needed**; the Projects board stays a human view that GitHub's built-in workflows sync from labels/PR state).

| Primitive | Set by | Meaning |
|---|---|---|
| **Assignment to `carbon-agent`** | human | **build this** — the kickoff. Assigned issues = the work queue. |
| `agent:working` | builder | lease held (paired with the in-flight dispatch handle in SQLite) |
| `agent:needs-grooming` | groomer/human | candidate for the auto-groomer |
| `agent:groomed` | groomer | spec + acceptance criteria proposed; safe to assign |
| `agent:needs-decomposition` | builder/groomer | epic-sized; a breakdown was proposed, awaiting a human |
| `agent:blocked` | builder | loop returned blocked/error, or binding-synth refused; needs a human |

Lifecycle that isn't a label is native GitHub: PR with `Closes #N` → review → human merge → issue auto-closes. The audit trail is issue comments + PR history under the `carbon-agent` identity.

**The only non-GitHub state** is OpenClaw's per-agent SQLite (`agents/<id>/agent/openclaw-agent.sqlite`), holding *scratch only*: daily-budget counters, last-seen review-comment cursor, in-flight dispatch handles. Authoritative reconciliation always reads GitHub, never SQLite.

---

## 5. The wake loop (each webhook or heartbeat)

Decisions are single-threaded (one wake at a time — serializing the decision kills the races). **Build concurrency is a config knob `N`, default `1`.** Each concurrent build boots a full Carbon stack (Postgres/Redis/Supabase/edge) in its own worktree and eats RAM, so on today's box `N=1` (strictly serial builds); raise `N` only when the box grows. A build semaphore of size `N` in SQLite gates dispatch — never start build `N+1` while `N` are live.

```
on wake:
  1. reconcile leases
       for each `agent:working` issue assigned to carbon-agent:
         has open PR?      → it's in review (check for feedback in step 2)
         no PR, no live build? → crashed mid-build → drop `agent:working` (stays assigned) → re-pickable
  2. PR feedback?  (highest priority — finish in-flight before starting new)
       for each open carbon-agent PR with new, actionable, unresolved review comments since cursor:
         → re-enter the inner loop on that branch (§7)
  3. assigned & not done?
       pick the top assigned issue (by board order) → build (§6)
  4. else (idle)
       groom one un-groomed issue (§8)
  5. GC + report  (prune merged worktrees; post outcomes to the channel)
```

---

## 6. Build path (the autonomous loop)

When an issue is assigned:

1. **Binding synthesis (judgment, by the headless Claude Code agent)** — read the issue (title/body/comments) and emit a `Binding` (`kind`, `risk`, concrete testable `acceptance[]`). This is the agent's core judgment call and lives in the agent on the OpenClaw box, never in the repo.
   - **Refusal path:** if you can't write crisp acceptance criteria, or it smells epic-sized (`#942 Inventory Counts` is a whole module), don't dispatch. Apply `agent:needs-decomposition`, comment a proposed breakdown, and stop. Belt-and-suspenders against an epic slipping past the human's assign gesture.
2. **Take the lease** — apply `agent:working` (leave the human's assignment intact), record the dispatch handle in SQLite.
3. **Dispatch on the builder:**
   ```
   crbn new loop/<id> --base origin/main --yes
   crbn up --run 'pnpm --filter @carbon/harness loop <binding>.loop.md --cwd .'
   ```
4. **Read the outcome** from `llm/loops/<id>/outcome.json` (see deliverable 2 — structured, not stdout-scraped):
   - `shipped` → the harness already opened a gated PR with `Closes #<issue>`; comment the PR link on the issue, post to the channel.
   - `blocked` / `plateau` / `error` → apply `agent:blocked`, comment `outcome.reason`, drop the lease.

---

## 7. PR-feedback re-entry (the second loop)

A CodeRabbit/reviewer comment on a `carbon-agent` PR is just a new input on an existing task:

1. Collect actionable, unresolved review comments since the SQLite cursor (skip nits/approvals).
2. Synthesize a small feedback Binding whose `acceptance[]` = "resolve review thread: …".
3. Re-enter the inner loop **in the same worktree/branch**:
   ```
   crbn up --run 'pnpm --filter @carbon/harness loop <feedback>.loop.md --cwd <existing-worktree>'
   ```
   The loop makes new commits; PR-opening is idempotent (pushes to the existing PR — see deliverable 2 §C). Resolve the threads as addressed.
4. Cap rounds (≈3); then `agent:blocked` + escalate to a human via the channel.

---

## 8. Grooming — the idle default

Grooming is what makes this an *employee* rather than a queue worker. Two modes:

- **Triggered** (a *thin* issue was assigned): synthesize a spec, and since assignment is strong intent, proceed to build — unless it's epic-sized, in which case stop and propose a decomposition (`agent:needs-decomposition`).
- **Auto** (nothing assigned): walk the backlog, post a proposed spec + acceptance criteria as a comment, label `agent:groomed`. For epics, one lightweight "this is a theme, candidate breakdown:" comment + `agent:needs-decomposition`. **Never builds** (nothing is assigned) — it just makes the backlog assignable.

Keep auto-groom from being noisy/expensive (the board is stub-heavy):
- One issue per idle wake (rate-limited).
- Skip anything already `agent:groomed` or closed; only re-groom if the issue changed since.
- Lightweight epic pass, not a deep decomposition every wake.

---

## 9. Box memory management

Two senses, both real:

- **Physical (disk/RAM):** worktrees + Docker volumes + ledgers + screenshots pile up fast, and the box is RAM-bound. This requires an aggressive **resource janitor**, not best-effort cleanup:
  - **Build concurrency `N` (default 1).** A SQLite semaphore caps live builds. One stack at a time on today's box.
  - **Per-dispatch teardown.** `crbn up --run` already scopes the stack (boot→run→teardown), but `crbn down` **preserves volumes** — so the janitor must additionally prune the dispatch's Docker volumes after teardown, and kill any orphaned dev/browser (agent-browser/Chromium) processes.
  - **Worktree GC.** Remove the worktree once the dispatch finishes (the branch is pushed to origin — the local worktree is disposable). Use `crbn remove --prune`. For PR-feedback re-entry, recreate the worktree from the remote branch on demand rather than keeping it around.
  - **Scheduled Docker GC (each heartbeat).** `docker volume prune` / dangling-image prune, **scoped by project/name** (the Carbon compose project + `openclaw-sbx-*`) so nothing unrelated on the box is touched.
  - **Pre-flight watermark.** Before dispatching, check free disk/RAM; below threshold → run GC first, or refuse to dispatch and report (block, don't thrash).
  - **Crash reaping.** On restart, an `agent:working` issue with no open PR also means a dead worktree + maybe a half-up stack — reap both during reconcile.
  - The `crbn up --run` scoping is the load-bearing primitive here — it's the difference between a box that runs for weeks and one wedged by Tuesday — but volumes need the extra prune step (see deliverable 2 §F).
- **Agent (learned knowledge):** durable lessons that improve future triage/scheduling — "tasks touching DB migrations plateau often → bump their risk/effort," "reviewer X always wants tests → pre-include in acceptance." Lives in the agent's memory/skill docs (mirrors this repo's `.claude/rules/` + `lessons.md` convention) and feeds back into the synthesis/groomer prompts.

---

## 10. Safety rails (machine user with write access)

- **Never merges.** PR approval is the human gate, same as the inner loop.
- **Blast radius = the assignment gesture.** The builder physically only acts on assigned issues; the groomer only comments. It cannot start building anything a human didn't assign.
- **Budget:** per-task + daily `$` ceilings (SQLite counters). The inner loop already caps per-doer/judge/behavior turns and `$`.
- **Rate limits** on comments so it can't spam the board.
- **Kill switch:** unassign / pause the daemon.
- **Audit:** every external write is logged by GitHub under `carbon-agent` — clean attribution, which is exactly why a dedicated machine user beats committing as a human. (Move to a GitHub App later for per-repo scoped install.)
- **Credential hygiene:** the `carbon-agent` token lives in the orchestrator/builder auth store, never inside a worktree. Tailscale egress-only posture is preserved by the outbound-WS webhook design (§3).

---

## 11. Build order

1. **Dispatch + structured outcome**, hand-fed: assign one issue, orchestrator synthesizes a Binding, dispatches on the builder, reads `outcome.json`, comments the PR link. Proves the spine. (`#450 STEP import cross-origin headers` is an ideal first target — real bug, root cause already in the body.) *Depends on repo changes A–B.*
2. **The wake loop** — webhooks (outbound WS relay) + heartbeat, reconcile/lease, assign-to-build end to end.
3. **PR-feedback re-entry** — CodeRabbit/reviewer → re-dispatch on the same branch. *Depends on repo change C.*
4. **Groomer** — auto-groom idle, triggered-groom thin assignments, epic decomposition proposals.
5. **Box memory GC + budget rails + channel reporting + agent-memory reflection.**
