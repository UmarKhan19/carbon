# Accounting Implementation Meta Spec — the DAG to Public-Company Readiness

> Status: active (program definition — stays open until the exit criteria pass)
> Author: Claude (with Brad Barbin)
> Date: 2026-07-04
> Tracking issue: [crbnos/carbon#1060](https://github.com/crbnos/carbon/issues/1060)
> Companions: audit `.ai/specs/2026-07-03-public-company-readiness.md` · roadmap `.ai/plans/2026-07-03-public-company-readiness-roadmap.md` · research `.ai/research/public-company-compliance.md`

## Purpose

This is the **program contract for autonomous execution**: implement every existing accounting spec and everything else required for Carbon to pass a compliance audit as the accounting system of a public company operating in multiple countries. The unit of work is a **GitHub issue** (#1030–#1059); this spec defines the DAG between them, the execution protocol an agent follows for each, and the exit criteria for the whole program. Issues reference the detailed specs; where a workstream has no spec yet, its issue says so and the agent writes one first (creating more specs as needed is expected and encouraged — new spec ⇒ new changelog entry here).

Binding rules:
- **The issues are the binding.** An issue's body + its referenced specs define the work. If this spec and an issue disagree, fix the disagreement before building (comment on the issue).
- **The DAG is authoritative here.** An issue is *ready* when all its hard dependencies are closed. Do not start a non-ready issue.
- **Humans stay in the loop at spec gates only.** Open questions are resolved by @barbinbrad in issue comments before a spec is written (per `.ai/skills/spec-writing/SKILL.md` — interview first, document second). Everything else is autonomous.

## Exit criteria — "we would pass the audit"

The program is complete when all of the following hold (expanded form in the roadmap's Definition of full readiness):

1. **ICFR controls**: period close enforced at the DB for every writer; posted records immutable everywhere with reversal/void-only correction and the audited Repair channel; document approvals live on JEs/payments/purchase invoices/memos with system-enforced no-self-approval; always-on, synchronous, append-only audit trail (≥7-year accounting retention) covering all accounting + permission tables; gapless numbering from the cutover epoch; access-review and SoD reports produce auditor-ready CSVs; the JE population export reconciles opening→closing trial balance for any fiscal year.
2. **Financial statements**: BS/IS/TB/SCF/GL-detail, Posted-only, comparatives, consolidated across mixed currencies with real (warned) rates and posted, rolled-forward CTA; budget-vs-actual; drill-down to journal lines everywhere; CSV/PDF exports.
3. **GAAP subsystems**: deferred revenue + deposits + POC with rollforwards; lease subledger; standard cost + revaluation + LCNRV + landed cost; impairment/CIP/component assets; prepaid/recurring/auto-reversing engines; at least one adjustment book proving multi-GAAP; segment-tagged statements with server-enforced dimensions.
4. **Multi-country statutory**: tax determination/posting/returns per registration; e-invoicing live via Avalara for at least one clearance market with the state machine proven; FEC + one SAF-T flavor validating; statutory COA mapping; WORM retention + legal hold.
5. **Ecosystem**: TB API, JE export/import APIs (import approval- and period-aware), close webhooks — documented.
6. **Cutover**: accounting always-on; `accountingEnabled` flag deleted; ≥2 companies migrated through the activation runbook with tying opening balances.
7. *(Company program, outside agent scope but gating the audit itself)*: SOC 1 Type II underway per roadmap §∥.

## The DAG

Waves are a scheduling convenience; the truth is the edge list. `⚠ spec-first` = the issue requires writing a spec (with the Brad interview) before building.

| Issue | Workstream | Spec status | Hard deps | Soft deps / coordination |
|---|---|---|---|---|
| [#1030](https://github.com/crbnos/carbon/issues/1030) | FX convention normalization | spec exists — **3 open questions to resolve in-issue first** | — | ship as one coordinated PR |
| [#1031](https://github.com/crbnos/carbon/issues/1031) | Period close + posted-record immutability + **NetSuite-style close checklist** | spec + plan exist (two delta banners; plan Addendum Tasks 17–20) | — | land before #1036 (shared `post-*` surface); seeds the checklist registration surface downstream close tasks use |
| [#1032](https://github.com/crbnos/carbon/issues/1032) | Document approvals + SoD reporting | spec exists — `/plan` next | — | **highest priority** |
| [#1033](https://github.com/crbnos/carbon/issues/1033) | ITGC hardening | ⚠ spec-first (auth portions) | — | SOC 2 evidence depends on it |
| [#1034](https://github.com/crbnos/carbon/issues/1034) | Bank reconciliation Phase 1 | spec + plan exist (delta banner) | #1030 | |
| [#1035](https://github.com/crbnos/carbon/issues/1035) | Financial reporting package | spec + plan exist (delta banner) | #1031 | |
| [#1036](https://github.com/crbnos/carbon/issues/1036) | Tax Phase 1 | spec exists — `/plan` next | #1030 | after #1031 (posting triggers) |
| [#1037](https://github.com/crbnos/carbon/issues/1037) | Budgeting Phase 1 | spec + plan exist | #1031 | |
| [#1038](https://github.com/crbnos/carbon/issues/1038) | Gapless numbering + legal series | ⚠ spec-first | #1031 | coordinate with #1047 |
| [#1039](https://github.com/crbnos/carbon/issues/1039) | Close automation (depreciation, accruals, recurring) | ⚠ spec-first | #1031 | |
| [#1040](https://github.com/crbnos/carbon/issues/1040) | Inventory valuation completeness | ⚠ spec-first | #1031 | IAS 2 reversal waits for #1052 |
| [#1041](https://github.com/crbnos/carbon/issues/1041) | Fixed assets completeness | ⚠ spec-first | #1031 | |
| [#1042](https://github.com/crbnos/carbon/issues/1042) | Plaid bank feeds + cash position | spec exists — `/plan` next | #1034 | |
| [#1043](https://github.com/crbnos/carbon/issues/1043) | Tax Phase 2 (returns, settlement) | spec exists | #1036, #1031 | |
| [#1044](https://github.com/crbnos/carbon/issues/1044) | Tax Phase 3 (Avalara, Xero mapping) | spec exists | #1036 | foundation for #1054 |
| [#1045](https://github.com/crbnos/carbon/issues/1045) | Budgeting Phases 2–3 | spec + plan exist | #1037, #1035 | |
| [#1046](https://github.com/crbnos/carbon/issues/1046) | Bank rec Phases 3–4 | spec exists | #1034 | |
| [#1047](https://github.com/crbnos/carbon/issues/1047) | Record integrity, audit hardening, JE export, book seed | ⚠ spec-first | #1031, #1032, #1034 | `audit.config.ts` ask lives in the spec |
| [#1048](https://github.com/crbnos/carbon/issues/1048) | Revenue recognition v1 | ⚠ spec-first — **contract-validation TODO first** | #1031, #1036 | |
| [#1049](https://github.com/crbnos/carbon/issues/1049) | Segments + dimension enforcement | ⚠ spec-first | #1035 | |
| [#1050](https://github.com/crbnos/carbon/issues/1050) | FX + consolidation completeness | ⚠ spec-first | #1031, #1034, #1035 | |
| [#1051](https://github.com/crbnos/carbon/issues/1051) | Master-data controls + vendor bank details | ⚠ spec-first | #1032, #1047 | prereq for any payment execution |
| [#1052](https://github.com/crbnos/carbon/issues/1052) | Multi-book adjustment books | ⚠ spec-first | #1047 | |
| [#1053](https://github.com/crbnos/carbon/issues/1053) | Statutory exports (FEC, SAF-T, GoBD, statutory COA, retention) | ⚠ spec-first | #1047, #1038, #1036 | |
| [#1054](https://github.com/crbnos/carbon/issues/1054) | E-invoicing framework (Avalara first-class) | ⚠ spec-first | #1036, #1038, #1044 | **France mandate Sept 2026** |
| [#1055](https://github.com/crbnos/carbon/issues/1055) | Withholding, ECSL/Intrastat, MTD | ⚠ spec-first | #1043 | |
| [#1056](https://github.com/crbnos/carbon/issues/1056) | Lease subledger (842/IFRS 16) | ⚠ spec-first | #1052 | US-GAAP-only start possible after #1047 |
| [#1057](https://github.com/crbnos/carbon/issues/1057) | Cutover tooling + flag retirement | ⚠ spec-first | #1031, #1036, #1047, #1038 | gates GA / always-on |
| [#1058](https://github.com/crbnos/carbon/issues/1058) | Intercompany maturity | ⚠ spec-first | #1050 | |
| [#1059](https://github.com/crbnos/carbon/issues/1059) | Integration surface (TB/JE APIs, JE import, webhooks) | ⚠ spec-first | #1032, #1047 | |

Rendered graph: see [#1060](https://github.com/crbnos/carbon/issues/1060) (mermaid).

**Critical path to "controls pass" (the two MW findings):** #1031 → #1047, with #1032 in parallel. **Critical path to always-on accounting:** #1031/#1030 → #1036 → (#1038, #1047) → #1057. **First external deadline:** #1054 (France, Sept 2026) via #1036 → #1044.

## Execution protocol (per issue — the agent contract)

1. **Pick** the highest-priority *ready* issue (all hard deps closed). Priority order when several are ready: #1032 first (standing instruction), then critical-path issues, then wave order.
2. **Spec gate**: if the issue is ⚠ spec-first, run `/spec-writing` — fieldwork, then post the open questions as an issue comment tagging @barbinbrad, **wait for answers**, then write the spec with resolutions baked in and commit it. If the issue references a spec with unresolved questions (#1030), resolve them the same way before building.
3. **Plan**: run `/plan` from the finalized spec → `.ai/plans/{date}-{slug}.md`.
4. **Build** on a feature branch (`feature/{slug}`), following the plan; migrations idempotent, randomized HHMMSS timestamps, never backdated (`.ai/lessons.md`); `pnpm run generate:types` after schema changes before typechecking; scoped typecheck (`pnpm exec turbo run typecheck --filter=<pkg>`), lint, tests.
5. **Verify**: every acceptance criterion in the spec and every definition-of-done box in the issue, with evidence (command output, screenshots for UI) posted to the issue. Never claim done without running the verification.
6. **PR**: one PR per issue, linking the issue (`Closes #NNNN`) and the spec (`Tracking spec:` line). Follow `.ai/skills/check-and-commit/SKILL.md` before committing.
7. **Close-out**: on merge — check the issue off in #1060; tick the roadmap checkbox; update the spec's changelog (and move to `implemented/` when fully done); if the work changed any assumption in this meta spec or the DAG, update this file in the same PR.
8. **New specs as needed**: any discovery that meets the spec-writing triggers (new module, 3+ files, data-model change) gets its own spec under the standard flow and, if it's a new unit of work, a new issue wired into the DAG here.

Coordination rules: issues sharing the `post-*` edge-function surface (#1030, #1031, #1036, #1047) must rebase on each other's merged state — do not run two of them concurrently. The six Phase-∅ specs carry ⚠ delta banners on their plans; apply the deltas before executing. **Close-checklist registration**: #1031 ships the persisted checklist (`periodCloseTaskDefinition`/`periodCloseTask`, 9 seeded tasks); any later workstream that adds a period-end activity (#1039 depreciation/accruals, #1042/#1046 bank rec completeness, #1048 revenue recognition, #1050 FX revaluation + consolidated rates) delivers its close integration by **registering a task definition** (with an auto-check where the state is computable) — never by inventing a parallel checklist mechanism.

## Out of scope for agents

SOC 1/SOC 2/ISO 27001 evidence programs, auditor selection, PITR/DR contracts, and country software certifications (Portugal AT, France PDP) are company-program items (roadmap §∥) — agents support them (e.g., #1033's controls) but cannot complete them.

## Changelog

- 2026-07-04: Period-closing scope expanded at user direction to include the NetSuite-style persisted close checklist (#1031 row updated; issues #1031/#1039/#1048/#1050 bodies updated). New coordination rule: downstream period-end workstreams integrate by registering `periodCloseTaskDefinition` rows, never by building parallel checklist mechanisms. DAG unchanged (no new nodes or edges).
- 2026-07-04: Created. 30 workstream issues (#1030–#1059) + tracking issue #1060 opened; DAG defined; execution protocol set. All program-level open questions were resolved 2026-07-03/04 (see the readiness spec); per-workstream questions resolve in-issue at each spec gate.
