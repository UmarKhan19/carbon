# Loop-Driven Development — Design Spec

**Status:** Design (brainstorming output). Not yet an implementation plan.
**Branch:** `feat/loops`
**Date:** 2026-06-24

---

## 1. Problem

Carbon's work arrives as four streams of wildly different shape — bugs (small, verifiable), usability tweaks (small, taste-based), Slack/Discord feedback (raw, high-volume), and big features (finishing accounting, AS9100D QMS, a BYOC Terraform/k8s pipeline; multi-phase, like `llm/plans/consolidation/` already is). There is no reliable way to turn that chaos into shipped work without it becoming overwhelming.

This spec covers the **execution layer**: a reusable system that binds to a single work item and grinds it to a gated PR, scaling from a one-line bug to a 9-phase feature. (Intake/triage — collecting and prioritizing the four streams — is a deliberately separate, later spec.)

## 2. The constraint that drives everything

The target runtime is **autonomous overnight loops on a production ERP, every result a PR behind CI + human review, never auto-merged.** For that to be safe, the only question that matters is: *can a loop trust its own "done"?*

Today it cannot. There are ~13 test files across the whole monorepo, so a loop can produce a change that type-checks, lints, builds, and looks fine in the UI while silently corrupting financials or leaking tenant data. **The gate is the product.** This system invests in the verification substrate first and treats orchestration as the easy, partly-built part.

## 3. The spine: anchor to concrete proven artifacts, never to abstractions

One principle unifies the whole system, on both the generation and verification sides:

> **Generate and verify by anchoring to concrete, proven artifacts — never to abstract rules or concepts.**

It manifests as three seeded, compounding libraries:

| Library | Domain | Seeded from | Compounds via |
|---|---|---|---|
| **Invariant net** | Data correctness | **Content signals, not filenames** — the live schema's constraints, the 152 migrations that add `CHECK/NOT NULL/UNIQUE/FK` to existing tables, and the ~30 data-repair migration bodies. Each is a *candidate*, validated before it joins the net. | Every future prod bug → one new permanent invariant |
| **Exemplar registry** | UI consistency | The repo's **best existing screens** (the canonical example of each UI archetype) | Every UI that passes all gates → a candidate exemplar |
| **Domain-pattern library** | Feature / domain logic | Competitor ERPs and point solutions, surfaced via the **`research` skill** — how the industry actually does accounting, RMAs, costing, etc. | Every researched feature → a reusable domain-pattern note |

All three reject "design/verify from rules" in favor of "anchor to a proven concrete artifact." The invariant net is the safety floor; the exemplar registry is the UI-consistency floor; **research is the domain-correctness floor — mandatory for ERP-domain features so domain logic is never invented from concepts.**

**Critical qualifier: "proven" means *current*, not merely *present*.** The repo is stratified across eras, so any artifact in it may be a fossil — and frequency actively misleads (the deprecated RLS pattern outnumbers the current one 95→69 files; `NUMERIC(x,y)` survives in 80 files). Anchoring is therefore by **recency + transition events + executable conformance**, never by majority vote or static documentation (which rots — cf. the abandoned `llm/cache`). See §5.7. **The spine keeps *itself* current and correct — as version-controlled, CI-run, human-ratified code rather than a knowledge base; see §5.8, the system's existential mechanism.**

## 4. Architecture: one conductor, declarative bindings

The cycle is fixed and reusable; everything that varies (gates, depth, precedent, risk) is **data in the binding**.

### 4.1 The binding (one file per work item)

```yaml
# llm/loops/<id>.loop.md
id: bug-1234
kind: bug                    # bug | feature | usability | copy
title: "Reorder button misaligns on short rows"
source: linear:CAR-1234      # or slack thread url, or manual
acceptance:                  # each criterion is compiled into a runnable gate
  - "Reorder button vertically centers in the row at <640px"
precedent:                   # required for UI work; cited by the doer
  - apps/erp/app/routes/.../sales+/quotes   # archetype: list-row actions
risk: low                    # low/med → auto-to-PR; high → plan-only + human stop
budget: { iterations: 6 }
# gates: optional override; defaults are derived from `kind`
```

### 4.2 The conductor cycle

```
bind item
compile-acceptance → gates[]            # each criterion → strongest runnable gate
crbn checkout -b loop/<id>; crbn up     # own isolated stack (postgres/supabase/inngest/redis)
repeat until all gates green | budget exhausted | plateau:
   PROPOSER(s)   smallest change toward the weakest-covered criterion
                 (UI: retrieve-then-mirror the cited precedent — §5.2)
                 (feature/domain: research-then-design — §5.5)
   HARNESS       deterministic floor: per-package typecheck + lint + build
   ORACLE        run compiled gates: tests + browser playbooks + invariants
   JUDGE         adversarial + calibrated verdict on what's left (taste, refute "done")
   DECIDE        keep iff every gate improves/green, else revert; ledger.append
finish → knowledge-sync (curated docs + glossary via carbon-docs; codegen artifacts auto via scripts/pre-commit)
       → self-review → open GATED PR (never merge); PR body cites which gate proves each criterion
```

`compile-acceptance` is the heart: a binding is **not done** until every acceptance criterion has a compiled, green gate of the strongest available type (executable test > browser playbook > data invariant > judge rubric).

### 4.3 The adaptive gate ladder (by `kind`)

| `kind` | Gate ladder (cheapest → dearest; loop iterates until all green) |
|---|---|
| **bug** | floor → correctness (TDD) → invariant net → knowledge-sync* → judge |
| **feature** | floor → correctness → behavior → invariant net → domain-conformance → knowledge-sync → judge — *per phase* |
| **usability** | floor → behavior (agent-browser) → precedent-conformance → knowledge-sync* → judge |
| **copy** | floor → precedent-conformance → knowledge-sync* → judge |

- **floor** — per-package `typecheck + lint + build` **+ conformance** (rejects deprecated patterns — old RLS, `NUMERIC(x,y)`, …; §5.7); dodges the whole-project `tsc` OOM. Always on for code.
- **correctness** — failing-test-first; manufactures the signal the ~13 test files don't provide.
- **behavior** — agent-browser driving the app on the loop's own `crbn` stack.
- **invariant net** — the global safety net; runs on *every* loop regardless of kind (see §5.1).
- **precedent-conformance** — the UI consistency gate (see §5.2).
- **domain-conformance** — for ERP-domain features, the judge verifies the design matches the researched industry pattern, not an invented one (see §5.5).
- **knowledge-sync** — curated docs + glossary are in sync with the change (see §5.6). `*` = conditional: only fires when the change touches user-facing behavior, an entity, or a defined term.
- **judge** — a *different* agent than the doer; adversarial + calibrated.

### 4.4 bug ↔ feature is recursion (depth is data, not different code)

A `feature` binding compiles into a **phase graph**; each phase is a **child loop** with its own compiled gates; PRs stack (via `pr-splitter`). A bug is a single ~1–3 iteration loop. A 9-phase feature (the shape `consolidation/` already has) is one parent binding spawning 9 child loops → 9 stacked gated PRs. Same typed contract at every depth.

## 5. The verification substrate (the high-value core)

### 5.1 Invariant net — global safety net

A library of **runnable assertions** over the database that must hold after *any* change. Its job is specifically the invariants **Postgres can't already enforce** — cross-table, aggregate, and temporal — since single-column/row constraints are already guaranteed by the schema.

**Candidate generation (content signals, never filenames).** Filename conventions like `fix-` are untrustworthy: of 758 migrations, the `fix` filename matches both pure UI/view noise *and* misses ~418 migrations whose bodies add constraints or repair data. Mine instead, in descending order of trust:
1. **Live schema constraints** — every `CHECK/NOT NULL/UNIQUE/FK` Postgres currently enforces is an already-guaranteed invariant; this defines what's *covered* so we don't duplicate it.
2. **Constraint-adding migrations on existing tables** (152) — each is a *declared* invariant; the act of adding it proves the data was previously violable.
3. **Data-repair migration bodies** (~30) + one-off `fix-*.sql` scripts + domain rules already written in `.claude/rules/` and `lessons.md` — a repair that was **never subsequently locked in by a constraint** points exactly at an unguarded gap that needs a net invariant.

**Trust comes from validation, not mining.** Every mined item is only a *candidate*. It joins the net only after it (a) compiles to something runnable, (b) holds against real `main`/prod data, and (c) gets a **human sign-off**. A noisy source is acceptable because the validation gate filters it; a weak heuristic treated as trusted is not.

Illustrative targets (cross-cutting, Postgres can't enforce these), grounded in existing `.claude/rules/`:
- **Accounting:** every posted journal entry nets to zero; periods balance; eliminations net at the LCA entity.
- **Inventory:** quantity movements conserve; no disallowed negative on-hand; no duplicate quantity rows.
- **Integrity (where no constraint guards it):** no orphan FKs on hot tables; every tracked entity has a `readableId`.
- **Tenancy:** a query as company A returns zero company-B rows (RLS).
- **Traceability:** the genealogy graph stays acyclic.

- Runs on **every** loop. A change that violates an invariant is **auto-reverted**.
- Lives as runnable code (proposed home: a dedicated `packages/invariants` workspace) so **CI (`check.yml`) can run it too** — defense in depth, not just a loop gate.
- Compounds: every future prod bug becomes one new permanent invariant.

### 5.2 Exemplar registry + UI consistency (three layers)

1. **Substrate — exemplar registry:** a curated `archetype → canonical reference path` map (list view → quotes route, entity detail → item detail drawer, form → known-good form, …). Entries are **recency-validated live pointers** — path + transition commit + "validated-against-HEAD @sha" stamp — pointing at the *newest* canonical screen, never the most common (§5.7); not static snapshots. Replaces rule/concept docs as the *primary* UI reference; `conventions-ui.md` / `make-interfaces-feel-better` become *secondary polish applied after the clone*. Self-compounding.
2. **Doer protocol — retrieve-then-mirror:** before proposing any UI, the doer identifies the archetype → retrieves the closest exemplar(s) → clones layout/components/structure → adapts minimally → **cites the precedent path** in the binding/ledger. No precedent cited ⇒ the loop cannot proceed.
3. **Gate — precedent-conformance oracle** (kept mechanical):
   - **Novelty detector** — flags net-new patterns in the UI diff: bespoke components where a `@carbon/react` one exists, raw className/CSS soup, layout scaffolding absent from the cited exemplar.
   - **Reuse ratio** — fraction built from existing components vs. invented; low reuse fails.
   - **Precedent structural diff** — does the new screen resemble the exemplar it claims to copy?
   - **Judge backstop** — "does this belong next to its precedent in Carbon?"

### 5.3 Calibrated adversarial judge

An isolated subagent that tries to **refute** "done," and is **calibrated**: it predicts gain/risk, the ledger records the realized outcome, and the rubric tunes over time. Hard items escalate to a **tournament** (N proposers, judge keeps the best, reverts the rest).

### 5.4 Structured ledger (learning memory, not a log)

A typed run-store (`llm/loops/<id>/ledger.jsonl`) read by the conductor, the judge, *and future loops*. Records each iteration's change + gate verdicts + keep/revert + reason. Powers: plateau detection, the PR rationale, judge calibration, and **cross-run learning** (remember dead ends so loops don't re-walk them). Distilled lessons graduate into `.claude/rules/` and `llm/tasks/lessons.md`.

### 5.5 Industry precedent — research-grounded feature design (mandatory for ERP-domain work)

For `kind: feature` touching ERP domain logic (accounting, RMAs, costing, inventory valuation, tax, revenue recognition, etc.), the doer's **first** step is the `research` skill — surveying how competitor ERPs and point solutions actually implement the feature. This is non-negotiable for domain work: an RMA flow or a rev-rec rule *invented from concepts* will be subtly wrong in ways no typecheck or invariant catches.

- The research output **grounds the acceptance criteria** (which then compile into gates) and becomes the rubric for the **domain-conformance** gate — the judge verifies the design conforms to a recognized industry pattern rather than an invention.
- Research findings accumulate into the **domain-pattern library** (durable notes under `llm/research/` / `.claude/rules/`), so the next feature in that area starts from the proven pattern, not a blank page.
- This is the "research-then-design" doer protocol — the external/industry twin of UI's internal "retrieve-then-mirror."

### 5.6 Knowledge-sync — curated docs & glossary (definition-of-done, not optional)

A change isn't done until the **curated** knowledge layer is back in sync. Two distinct tracks:

- **Codegen-synced (automatic):** swagger/API docs, MCP tools, DB types — already regenerated by `scripts/` + the pre-commit hook. The loop simply lets codegen run; nothing curated to do.
- **Curated (must be driven + gated):** the docs-site Guide, conceptual pages, and the **glossary** require grounded authoring — exactly the `carbon-docs` skill's "grounded-in-source + build-verification" workflow and the `keep-sources-in-sync` rule. The **knowledge-sync** gate fires when the change touches user-facing behavior, an entity, or a defined term, and fails if the corresponding curated docs/glossary weren't updated (mechanical detection of the trigger) and well-authored (judge-backed).

### 5.7 Conformance net + freshness discipline (standards drift)

Standards drift and the codebase is a stratified mix of eras, so naive "read the code and copy it" copies fossils — and frequency points at the *wrong* answer (deprecated RLS in 95 files vs current in 69; `NUMERIC(x,y)` in 80 files). Static written knowledge rots the same way (the abandoned `llm/cache`, the ignored `lessons.md` RLS note). Three rules keep every anchor current:

1. **Recency, not frequency.** The current standard is what the *newest* code does — established by git time and transition events — never by majority vote.

2. **Encode the deprecated pattern as a failing gate; don't document the new one.** A prose "use bare `NUMERIC`" rots and is ignored; a check that *fails* on `NUMERIC(x,y)` runs every loop and makes copying the fossil impossible. This is the **conformance net** — the code-standard sibling of the invariant net: executable checks that reject deprecated patterns, run on every code-touching loop, **seeded from transition events** (the refactor commit/migration that flipped a standard names both the new canonical form *and* the old form to forbid), human-ratified, compounding. Same spine as invariants — *executable beats prose; the moment-of-change is the signal.*

3. **Live validated pointers, never snapshots.** Exemplars and domain patterns are stored as pointers to the current canonical file + transition commit + "validated-against-HEAD @sha" stamp, cheaply re-checked — not prose that drifts out of sync.

Because standards keep moving, a standing **drift-detection loop** (scheduled) compares the newest commits against the encoded conformance gates and exemplar pointers; divergence is surfaced for human ratification, which forbids the now-old form, repoints the exemplar, and re-stamps freshness. "The standard changed again" becomes a first-class recurring event — the actual antidote to `llm/cache`-style rot.

### 5.8 Governing the spine — staying current and correct over time

The spine is load-bearing for everything, so its own currency and correctness are the system's existential question. These are **two different problems**:

- **Currency** (consistency with HEAD) is *mechanical*.
- **Correctness** (consistency with intent) is *social + scored* — CI alone can't provide it; a mis-specified invariant can be perfectly current yet still wrong.

**Root stance — the spine is code, not a knowledge base.** This is the entire reason it won't become `llm/cache`. That cache rotted because it was prose in a folder: ambient, unowned, un-runnable, and it *lies quietly* when stale. The spine is the opposite — executable artifacts and live pointers, version-controlled, PR-reviewed, CI-tested, with provenance in git. No novel trust mechanism is invented; it is held to exactly the bar we already trust for source.

**Currency — rot breaks loudly.** Because every anchor is executable or pointer-backed, staleness announces itself: an invariant throws when a referenced column is renamed; a conformance gate matching zero files is self-evidently suspect; an exemplar pointer to a deleted file fails. **The entire spine runs against HEAD in CI on every commit** — a green run *is* the freshness guarantee. No human writes a "still valid" stamp; a test asserts it. (Prose can't do this; code can — the crux of why `llm/cache` rotted and the spine won't.)

**Correctness — detect → propose → ratify → compile.** Machines detect drift/gaps/contradictions (cheap, constant); humans are the authority on what the standard should be (rare, necessary). So loops open a **PR proposing** a spine change → a human **ratifies** (the only trust gate) → ratification **compiles into a new executable artifact**. Agents never silently mutate the spine. No infinite regress ("who validates the validator?") — the buck stops at human review, identical to all other code. The owner's job is *ratification, not authoring or detection.*

**Staying honest over time:**
- **Scored entries (calibration).** Each gate tracks true-positives (caught a real issue) vs false-positives (blocked a legit change). High-FP → mis-specified → flag to fix/relax. Never-fires in N commits → prune candidate, or already covered by a schema constraint. The spine earns its place by outcomes.
- **Bounded growth.** A standing prune/consolidate pass (template: the `consolidate-memory` skill) retires redundant/superseded entries so the spine stays *small and load-bearing* — never a wall of stale text. This is the specific failure that killed `llm/cache`.
- **Contradiction check.** CI asserts the libraries are mutually consistent — e.g. every exemplar must itself pass the conformance gates; invariants don't conflict.

**Self-maintained by the machinery it powers.** The drift loop, harvest-from-prod-bug loop, and ratify-flipped-standard loop are themselves loops built from the same doer/checker/ledger primitives. **The spine is the system's first and permanent customer:** if the loops can't keep their own spine honest, they can't be trusted downstream — a forcing function and a continuous proof-of-life. A named owner (or rotation) is the root of trust.

## 6. Typed contracts everywhere

Every skill — doer or checker — returns **structured output, not prose**. Checker: `{verdict, score, failures[], evidence[], nextStep}`. Doer: `{change, filesTouched, criteriaAddressed[], precedentCited, risk}`. The conductor gates on data and never parses paragraphs. This is why existing skills must be *improved* — they were built to be read by a human.

## 7. Runtime (overnight, autonomous, gated)

- A nightly `schedule` routine selects top-N `ready` bindings by priority/risk → spawns each loop in its own `crbn` worktree (own full stack) → runs to a gated PR → tears down. Bounded concurrency and per-loop budgets.
- **Risk policy is declarative** (a small policy file). High-risk classes — DB migrations, accounting, infra/IaC — run **research + plan only and stop for a human**; they never self-execute. Everything else runs auto-to-PR.
- Every result lands as a PR behind `check.yml` + human review. Nothing auto-merges.

## 8. New vs. improved skills

| Invent (loop-native, don't exist) | Improve (exist, but human-facing) |
|---|---|
| `loop` conductor | `execute` / `feature` → emit typed change records, checkpoint per criterion |
| `compile-acceptance` (criterion → gate) | `test` / `smoke-test` → record replayable playbooks into the oracle; typed verdicts |
| `invariant-oracle` (library + runner) | `plan` → output a typed phase graph with per-phase acceptance |
| `judge` (adversarial, calibrated, tournament) | `self-review` / `verify` → become the judge's callable rubric, structured output |
| `ledger` (structured run-store + recall) | `ui` / `forms` → retrieve-then-mirror, cite precedent |
| `exemplar-registry` + precedent-conformance gate | `research` → mandatory first step for ERP-domain features; typed domain-pattern output that grounds acceptance + the domain-conformance rubric |
| | `carbon-docs` → loop-native knowledge-sync; typed detection of which curated docs/glossary entries a diff affects |

## 9. The milestone ladder (build order — each independently valuable and abortable)

The smart path is verification-first, history-seeded, regression-proven, crawl→walk→run.

- **M1 — Invariant net, seeded + validated.** Generate candidate invariants from content signals (live schema constraints → constraint-adding migration bodies → data-repair bodies + domain rules), focusing on what Postgres can't enforce; compile each to a runnable assertion; run against real `main`/prod data; **human-review each candidate before it joins the net.**
  - *Value standalone:* a data-integrity audit of the ERP. *Go/no-go:* candidates are correctly specified — they pass on known-good data, or surface real latent corruption — and survive human sign-off. Filename heuristics are explicitly **not** the mining mechanism.
- **M2 — Thin conductor + ledger + one supervised loop.** Minimal cycle, binding format, structured ledger; run a single **supervised** loop on a **safe, reversible** item (copy or an isolated bug with a clean invariant).
  - *Go/no-go:* the loop opens a correct, gated PR for a real item with a human watching.
- **M3 — Regression-replay (the autonomy gate).** Replay a known past bug as a change inside a `crbn` worktree; confirm the oracle **catches it and reverts**.
  - *Go/no-go:* if the loop can't catch a bug we already know about, we do **not** go autonomous.
- **M4 — Autonomous overnight on low-risk classes.** Nightly routine, `crbn` worktree fan-out, declarative risk policy, gated PRs; restricted to low-risk reversible work. Widen the risk envelope only as the ledger shows gates holding.
- **M5 — Deepen pillars on evidence.** `compile-acceptance`, calibrated/tournament judge, exemplar registry + precedent-conformance gate, cross-run learning — built in the order real runs expose friction, not speculatively.

Parallel tracks run a few milestones behind the data track:
- **UI track** — exemplar registry → retrieve-then-mirror → precedent-conformance gate; doer protocol ~M2, full gate ~M5.
- **Domain track** — mandatory `research` → domain-pattern library → domain-conformance gate; enters when the first ERP-domain *feature* loop runs (≈M4–M5).
- **Knowledge-sync track** — `carbon-docs`-driven curated docs + glossary gate; enters ≈M4 (codegen sync is already automatic and needs no new work).
- **Conformance track** — the standards/anti-pattern net (sibling to the invariant net): seed conformance gates from transition events, encode deprecated patterns (old RLS, `NUMERIC(x,y)`, …) as failing checks. Pairs with M1 (both are executable checks from transition events); the standing drift-detection loop enters ≈M4.
- **Spine-governance track (§5.8)** — from M1, the spine runs against HEAD in CI (currency is mechanical). The detect→propose→ratify→compile maintenance loop, entry scoring/calibration, and the prune/consolidate pass enter ≈M4–M5; the spine is the system's first permanent customer. Names an owner (root of trust for ratification).

## 10. Non-goals (YAGNI)

- Intake/triage of the four streams — separate later spec.
- Auto-merge — never; always human review.
- Speculative pre-building of tournament/calibration/cross-run learning before runs demand them (M5 is evidence-gated).
- Replacing the existing rule/convention docs — they survive as *secondary polish*, demoted below precedent.

## 11. Open questions / risks

- **Home of the invariant package** — dedicated `packages/invariants` vs. co-located under `packages/database`. Leaning dedicated so CI and the oracle share it.
- **Binding source of truth** — `llm/loops/` markdown queue now; later dogfood Carbon's own issue module or Linear/Jira (decided in the intake spec).
- **Invariant runtime cost** — running the full net per iteration may be slow; likely needs scoping (run-affected-subset per iteration, full net pre-PR).
- **Judge calibration cold-start** — early judging is uncalibrated; mitigated by M2–M4 supervision before trusting it overnight.
- **Playbook flakiness** — agent-browser gates are slower/flakier; behavior gate is layered, not the floor.
- **Conformance tooling & recency signal** — where conformance gates live (biome custom rules for TS, a SQL linter / grep-AST pass for migrations) and the cheapest reliable recency ranking (git blame/log date vs. explicit transition-event detection). Also: drift-loop cadence.
- **Spine governance (§5.8)** — who is the named owner / ratification root; where per-entry provenance + scoring (true/false-positive counts, last-validated) is stored (frontmatter on each entry vs. a sidecar store); cadence of the maintenance + prune loops.
