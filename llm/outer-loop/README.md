# Outer Loop — the agentic-employee intake brain

Carbon's "agentic employee" is **two loops**:

- **Inner loop** (`/conductor` skill + `@carbon/harness` + `@carbon/checks`) — already built. A pure-ish function: given a **Binding** (one well-scoped work item), iterate doer→gate→judge→keep/revert until the acceptance criteria are met, and land a **gated PR**. Never merges.
- **Outer loop** (this design — runs on **OpenClaw**, not in this repo) — everything that *manufactures* well-scoped Bindings and *reacts* to what comes back: it watches GitHub, decides what to work on, dispatches the inner loop, and shepherds the resulting PR through review feedback.

The inner loop's contract is the entire seam between them:

```
Binding { id, kind, title, risk, acceptance[] }
   ──(crbn up --run 'harness loop')──▶  outcome.json { state, prUrl, reason } + a gated PR
```

## The one-sentence interface

**Assign a GitHub issue to `carbon-agent` → it builds it. Assign nothing → it grooms the backlog so there's good work ready to assign.**

## Deliverables

1. **[01-openclaw-plan.md](01-openclaw-plan.md)** — the outer loop itself, implemented on OpenClaw. The orchestrator/builder split, the assign-to-build / idle-grooms behavior, egress-only webhooks (so it works behind Tailscale), GitHub-as-state-store, the wake loop, safety rails, and a build order.
2. **[02-repo-changes.md](02-repo-changes.md)** — the small, specific set of changes *this repo* needs to expose a clean headless dispatch contract for an external orchestrator. (Deliberately minimal: all GitHub/judgment logic stays in OpenClaw; the repo stays deterministic.)

## Design principles carried over from the inner loop

- **Deterministic spine, narrow judgment calls.** The inner loop made the harness a deterministic state machine and invoked the model only for doer/judge/behavior. The outer loop mirrors this one level up: a deterministic shell (GitHub state, leases, budget, audit, the human gate) that invokes the agent only for judgment (triage, prioritize, scope, react to feedback).
- **Never auto-merge.** The terminal artifact is always a gated PR awaiting a human, at both loop levels.
- **GitHub is the source of truth**, not a private database. Labels + assignment + PR state encode everything durable; the bot keeps only scratch (cursor/budget) locally.
