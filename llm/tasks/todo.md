# Carbon PLM — Pivot to Duro Model (Brainstorm)

## Context
Boss wants Carbon PLM to follow **Duro** (durolabs.co) functionality, not the broad Heliux-parity scope.
Repointing `docs/specs/carbon-plm-design.md` + `llm/research/plm.md` to Duro's leaner, opinionated,
AI-and-sourcing-forward, GitHub-PR-style-change-order model.

## Duro signal captured so far (direct fetches)
- Tagline: "A digital thread that just works"; "AI-native, API-first platform for modern hardware development".
- Two core objects: **Component** and **Product** (top-level sellable), both revisioned with nested sub-revisions, full history (timestamp + author).
- **Change Orders = the heart of revision mgmt**, "GitHub-inspired" PR-style: highlight changes (diffs) → review → approve; approval templates; impact analysis; **validation engine** blocks bad CAD/BOM release.
- **Status-driven revisioning**: promoting status (Design → Prototype → Production) sets the revision to the new status value; if status unchanged, revision auto-increments.
- **Sourcing module**: real-time distributor availability + pricing, AI part intelligence/selection, EOL alerts.
- **AI (Duro Design)**: part intelligence, natural-language search, predictive change-impact, metadata generation, embedded 3D viewers.
- Real-time **cost & mass rollups**; component **library + reuse** (where-used / usage count).
- CAD: SolidWorks, Onshape, Altium 365; **Duro Drive** = light PDM inside CAD. Low-code/YAML field+workflow+validation config. Slack alerts + Jira automation.
- Cuts QMS/requirements/compliance/MBOM — integrates Jama/Valispace/Intellect/Tulip/First Resonance instead.

## Plan
- [ ] Deep research Duro data model + API (agent a32daf... running). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] Deep research Duro features + AI/Duro Design (DONE). KEY: speed-first + opinionated defaults + no-consultant
      self-config (UI wizard / YAML / GraphQL) + API-first. AI scoped to DATA ANALYSIS not generative design
      (Corr on record): design validation, change-impact prediction (likely succeed/fail from history), metadata
      generation, AI sourcing intelligence surfaced to engineers, NLP search (Enterprise). Sourcing via Octopart
      (679+ distributors, live price/leadtime/EOL/RoHS). Real-time cost+leadtime rollups. GitHub-style change mgmt
      (approve/reject/close + Slack). Cut QMS/requirements/compliance/currency (partners: Intellect/Jama/Valispace).
      Top critiques: "just PDM not PLM", SolidWorks plugin instability, BOM import duplicate parts, weak variant mgmt.
- [x] Deep research Duro CAD/ERP/MES integrations + comparisons (DONE). KEY: every Duro ERP/MES integration
      (NetSuite SuiteApp, ION EBOM→MBOM-on-CO-approval, Epsilon3/Boltline/Tulip, supplier-part/cost/leadtime
      propagation) collapses to a FREE internal read for Carbon (shared DB) — no 90-day key expiry, no field
      mapping, no double-entry. Net-new moat to build: in-CAD plugins (esp. bi-dir Altium 365 ECAD auto-eBOM),
      distributor sourcing intelligence (DigiKey/Mouser/Arrow/Avnet/McMaster live price/leadtime/avail), AI
      (metadata gen, impact analysis, dedup, NLP search), immutable-PN + duplicate-validation reuse model.
- [ ] Fresh Carbon schema map for items/methods/suppliers/docs/onshape/app-skeleton (agent a94a9a... running). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] Update llm/research/plm.md with a Duro deep-dive section. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] Rewrite docs/specs/carbon-plm-design.md around the Duro model (Component/Product objects on Carbon items, status-driven revisions, PR-style change orders + validation engine, sourcing intelligence, AI layer, cost/mass rollups, CAD plugins, component reuse). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] Present the pivot to the user. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Customer signals (load-bearing — drive the MVP)
- Liam (Minimal): LIGHTWEIGHT PLM for ENGINEERING CHANGES, Duro-style, "would actually be awesome".
  - Build it "very similar to the QUALITY MODULE with actions, links to other things in carbon and a
    workflow to PROPOSE a change, APPROVE it, EXECUTE it, then ROLL it out."
  - Implementation traceability = trace implementation to a VERSION OF AN ITEM. Example:
    "remove items xyz / add items abc / Change implemented in item001 version 6."
    → changeOrderItem.affected → resulting item revision (pendingItemId released as v6); redline = remove/add lines.
- Heaviside (met today): high interest in PLM with ECO flow = create → release → peer review → approved,
  CONTROLLED OVER REVISION for BOM/BOP (Carbon makeMethod = materials BOM + operations BOP, both versioned),
  AND holding 2D DRAWINGS AS SINGLE SOURCE OF TRUTH for purchasing.
    → drawings pinned to released item revisions, surfaced to purchasing; document versioning net-new.
- Both validate: lead with the ECO workflow built on the quality-module pattern; sourcing/AI/CAD = follow-on.

## Re-run status (first attempts failed: schema map ECONNRESET, data-model timed out)
- [ ] Duro data model + AI architecture — agent a33443... running (timeboxed).
- [ ] Carbon schema map — agent ab0526... running (timeboxed).
- [x] PLM end-to-end + post-integration operation (DONE). KEY for single-DB Carbon: the EXPENSIVE integration
      machinery (query-before-insert dedup, idempotency keys, dead-letter queues, replay, correlation-IDs,
      ERP revision shadow-fields) is exactly what VANISHES when PLM/ERP/MES share one DB — ECO-release→ERP
      item/BOM update becomes a row-state flip, MBOM→MES a direct read, as-built→PLM a foreign key. Eliminates
      duplicate item masters, PLM/ERP revision mismatch, sync latency BY CONSTRUCTION. What you STILL must build
      even on one DB: (1) in-work/released wall (permission/state discipline), (2) effectivity engine + MRP
      cutover (use-up/rework/scrap; one DB stores effectivity, doesn't decide it), (3) ECR/ECO state machine +
      approval governance, (4) EBOM/MBOM/sourcing-BOM as distinct VIEWS over shared parts (not collapsed).
      AI-native = intelligence AT THE GATES: change-impact prediction before ECO approval, validation gating
      releases, sourcing at design time — cheaper with no integration boundary to reason across.

## Execution phase (ultracode: brainstorm→plan→execute-in-loop)
HARD CONSTRAINT from user: reuse EXISTING ERP components + the THREE-SECTION entity layout everywhere
(header w/ actions; LEFT = line items / product data / connected; MIDDLE = details; RIGHT = properties/other).
Do NOT invent components/layouts. Only ask when a needed thing/layout has NO precedent in the ERP.

- [ ] Ground in ERP conventions — Workflow wf_da983b84-c9d running (layout, quality-template, new-entity-recipe,
      shared-components+gap-analysis, forms/tx/revision-copy). Spawn subtasks to query the cache folder any time
      I need to learn something about the codebase. NEVER update the cache with plans or information about code
      that is not yet committed.
- [ ] Synthesize → write P1 implementation plan (task-by-task, exact files/components) to docs/specs/.
      Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER
      update the cache with plans or information about code that is not yet committed.
- [ ] Flag any Change-Order UI piece with NO ERP precedent (redline diff, validation banner, approval-type
      selector, approval/reviewer lists) and ASK the user about only those. Spawn subtasks to query the cache
      folder any time I need to learn something about the codebase. NEVER update the cache with plans or
      information about code that is not yet committed.
- [x] Ground in ERP conventions (workflow wf_da983b84-c9d done; 5 reports synthesized).
- [x] P1 plan written → docs/specs/carbon-plm-plan.md (clone quality module; reuse 3-section layout + components).
- [x] Decisions resolved: Q1 = PLM is a MODULE inside the ERP app (apps/erp/app/modules/plm + routes/x+/...);
      Q2 = redline diff = Duro-style GitHub unified diff (flat +/−/~ changed-lines list, reuse Grid).
- [x] A. migration WRITTEN + REVIEWED: packages/database/supabase/migrations/20260621143000_plm-change-orders.sql
      (7 tables, 6 enums, plm_* perms, ECO sequence; COMMIT/perm patterns verified vs quality-module.sql).
      A5 GATE still pending: USER must apply migration + run `pnpm db:types` before typecheck can pass.
      Note: priority reuses nonConformancePriority (cross-module); release promotes pending→Production,
      prior→Obsolete (tiered Prototype/Pre-Prod release deferred to a later phase).
- [x] A4. Edge fn `changeOrderTasks` case added to create/index.ts (clone nonConformanceTasks; plm_update; workflow.content→changeOrder.description when empty; reviewers seeded when any approvalRequirements + none exist).
- [ ] FIX-UP (after B finishes, before user runs db:types — migration not yet applied so still free):
      add a LABEL column to changeOrderActionTask + changeOrderApprovalTask (NCR has actionTypeId/approvalType;
      ours has none → seeded checklist tasks would be unlabeled). Add `name TEXT` (or actionTypeId to match
      whatever B's cloned ActionTasksList expects), set it in the edge fn from requiredActionIds[]/approvalRequirements[],
      and include in models/service. Do NOT edit migration while B is mid-read (race).
- [x] E1. Paths + nav wired: utils/path.ts (28 builders; routes folders x+/plm+ [list], x+/change-order+ [detail],
      x+/change-order-workflow+), hooks/useModules.tsx (PLM registered, LuGitPullRequestArrow), modules/plm/ui/
      useChangeOrdersSubmodules.tsx. _layout.tsx left for routes agent.
- [!] CONSTRAINT: node_modules NOT installed in this checkout → cannot run tsgo/lint here. Verification = code
      review + faithful clone; typecheck/browser deferred to USER (after pnpm install + db:types).
- [x] B. Models+service+server WRITTEN + REVIEWED. FIXED 2 issues: (1) double-copy bug in createPendingRevision
      (createRevision already deep-copies via get-method whose parts validator defaults all-true; removed the
      redundant copyItem + its import + stale comments); (2) added `name` label column to changeOrderActionTask +
      changeOrderApprovalTask (migration) and populated it in the edge fn from requiredActionIds/approvalRequirements.
- [x] D-a. Shell UI done (ChangeOrderStatus/Header/Properties/Form/Table under modules/plm/ui/ChangeOrder).
      INTEGRATION LOOSE ENDS to resolve in review: (1) Properties inline-edits POST to path.to.bulkUpdateChangeOrder
      — ensure C created that route (or add it); (2) Form requiredActions multi-select needs an options source
      (no config table) → seed default list ["Engineering Review","Update Drawings","Update BOM/BOP","Purchasing
      Review","Quality Review"] or make creatable; (3) header panel-toggle buttons omitted (drag still works) — minor;
      (4) Audit Log dropdown points to details (no audit route) — minor.
- [x] D-b. Workflow UI done (ChangeOrderTaskItem, ActionTasks/ApprovalTasks/Reviewers, ChangeOrderItems,
      RedlineDiff [keyed unified diff, Badge green/red/yellow], ValidationBanner). Posts to updateChangeOrderItem
      (intents add/delete/disposition) + changeOrderTaskStatus; needs loader to supply item.redline {current,pending}.
- [x] C. Routes WRITTEN (15 files): plm+ layout/index/list/config-lists, change-order+ new/$id(3-section)/details/
      status/release/task/reviewer. Release route gets Kysely db via ~/services/database.server getDatabaseClient().
      $id.details builds redlineByItemId from makeMethod→methodMaterial/methodOperation of itemId vs pendingItemId.
      MISMATCHES FOUND (UI posts to flat routes C didn't create): bulkUpdateChangeOrder=/change-order/update,
      updateChangeOrderItem=/change-order/item/update; C made orphan $id.affected-item.new/delete the UI never calls.
- [~] INTEGRATION FIX (agent a81b3f running): create update.tsx + item.update.tsx (add/delete/disposition; add
      changeOrderId hidden field to ChangeOrderItems add modal), delete orphans, source requiredActions defaults,
      verify status/release/task/reviewer field alignment.
- [ ] AFTER INT: E2 quality→CO link ("Create change order" on nonConformance, prefill sourceType/sourceId +
      new.tsx reads source params) [waits on INT—both touch new.tsx]; final integration review; write verification
      doc (pnpm install → apply migration → pnpm db:types → typecheck → browser). E3 Inngest notify = DEFERRED
      (no PLM notify infra; non-blocking).
      then E-late (quality→CO link + Inngest release fn) → integration review (route↔component wiring, since no
      typecheck here) → hand user: pnpm install + apply migration + pnpm db:types + typecheck + browser test.
      B. models+service (clone quality.*; +createPendingRevision via createRevision/copyItem; +releaseChangeOrder Kysely txn; +validation engine) →
      C. routes (clone issue+; three-section $id detail) →
      D. UI (clone quality ui; new RedlineDiff + ValidationBanner) →
      E. wiring (path/nav/permissions, quality→CO link, Inngest release fn, typecheck).
      Reuse components; only ask when a thing/layout has NO ERP precedent. Spawn subtasks to query the cache
      folder any time I need to learn something about the codebase. NEVER update the cache with plans or
      information about code that is not yet committed.

## DONE — Phase 1 ECO MVP code-complete (loop finished; awaiting user verification)
- All code written + integrated as a MODULE inside apps/erp. Status/handoff: docs/specs/carbon-plm-phase1-status.md.
- Migration (7 tables, 6 enums, plm_* perms, ECO seq) + edge-fn changeOrderTasks + models/service/server +
  12 UI components (incl. Duro-style RedlineDiff) + 16 routes + path/nav + quality→CO link.
- Bugs caught & fixed mid-build: double method-copy (BOM dup), missing task-label column, route/UI POST mismatches
  (added update.tsx + item.update.tsx, removed orphans, added changeOrderId to add modal), missing delete route.
- CANNOT verify here (no node_modules; can't rebuild DB). USER must: pnpm install → apply migration → pnpm db:types
  (sslmode=disable workaround) → pnpm typecheck → browser test. Minor polish items listed in status doc.
- LOOP RESUMED (user re-ran /loop). Adversarial review (5 agents) found 14 issues; fixed all real ones:
  * BLOCKER: enum/table name collision (changeOrderType) → renamed PG enum to changeOrderTypeEnum (migration +
    types.ts); migration would NOT have run otherwise.
  * MAJOR: RedlineDiff unknown[] props → exported Material/Operation/Method, typed+mapped getMethodSnapshot
    (also fixes blank redline labels: item.name→description).
  * MAJOR: description plain-string → generateHTML crash → guarded $id.details render (doc/string/empty).
  * MINOR: createPendingRevision revision collision → increment against ALL existing revisions of the readableId.
  * MINOR: useRealtime("changeOrder") had no publication → added ALTER publication supabase_realtime ADD TABLE.
  * Skipped: types.ts missing changeOrder* types (= the db:types gate, expected); getNextRevision ZZ overflow (harmless, matches existing code).
  Files edited: migration, plm/types.ts, RedlineDiff.tsx, $id.details.tsx, plm.service.ts. Verified consistent via grep.
- [x] Verification round 2: confirmed all 5 fixes correct + swept edge-fn/release/13 routes clean. Found 1 latent
      MAJOR in update.tsx (bulk-update could write null to NOT-NULL description/openDate) → FIXED (reject empty
      NOT-NULL fields; description falls back to {}).
- [x] Review converged (round1=14, round2=1, all fixed). Module review-clean.
- [x] REAL compiler verification done: `pnpm install` OK; `pnpm --filter erp typecheck` ran → 186 errors, ALL
      categorized as downstream of not-yet-run db:types (changeOrder* tables + enums + item.revisionStatus absent
      from generated types → ResultOne fallback + table-union + SelectQueryError). ZERO fixable-now PLM bugs.
      Only non-PLM error = pre-existing react-router typegen artifact in root.tsx (unmodified by me; run typegen).
      Files edited outside schema (IssueHeader/useModules/path.ts) = 0 errors. Cannot clear the rest without
      applying the migration (forbidden). Recorded in docs/specs/carbon-plm-phase1-status.md (Compiler verification).
- [x] USER APPLIED THE MIGRATION (2026-06-22). Then I ran: pnpm db:types (OK, no sslmode workaround needed —
      types.ts now has 207 changeOrder refs + revisionStatus + changeOrderTypeEnum) + react-router typegen (clears
      root.tsx artifact).
- [x] ERP TYPECHECK GREEN (tsgo --noEmit, 0 errors) after migration+db:types+typegen. All 186 prior errors were
      db-types-downstream, now resolved. PLM code has NO genuine type bugs — review fixes + edits hold under the compiler.
- [x] FULL-MONOREPO typecheck (round 1): 17/20 passed; ONLY error = mes root.tsx './+types/root' (react-router
      typegen artifact, NOT my change — I'd only run typegen for erp). 'PLM' module enum caused ZERO exhaustiveness
      errors anywhere. Ran `pnpm -r run typegen` (academy/starter/mes/erp all Done).
- [x] FULL-MONOREPO TYPECHECK GREEN ✅ — `pnpm typecheck` = 20/20 tasks pass, 0 errors (ERP+PLM, MES, academy, all
      packages). ERP-only typecheck also 0 errors. Phase 1 is type-verified repo-wide; PLM code needed no fixes
      beyond the review + db-types. Handoff doc updated to the green state.
- [x] LOOP DONE (genuinely finished the verifiable work). Dev server NOT running (ports 62377/3000/3600 all down),
      so the browser smoke test can't run without starting one — that's the only remaining (runtime) step, offered
      to the user. No code work left.

## Review
- Research consolidated into llm/research/plm.md (Duro direction: objects⇄Carbon mapping, status/revision/CPN/CO
  schema, post-integration ops, recommended approach). Note: original-branch files weren't on this branch's disk,
  so both docs written fresh.
- Spec rewritten at docs/specs/carbon-plm-design.md as Duro-style engineering-change-first PLM:
  - MVP = the Change Order built on the QUALITY-MODULE pattern (Liam): changeOrder + items + tasks + approvals +
    reviewers + workflow + validation; status Draft→In Review→Approved→Released (propose→approve→execute→roll out).
  - revisionStatus Design/Prototype/Production/Obsolete (Duro), gated, parent≥children; releaseControl off/warn/enforce.
  - Affected items → pendingItemId = implementation traceability ("implemented in item001 v6"); redline diff of
    BOM(methodMaterial)+BOP(methodOperation) via reused createRevision()/get-method copy.
  - 2D drawings as single source of truth for purchasing (Heaviside): documentVersion + itemDocument pinned to
    released revision.
  - Phasing: P1 ECO core; P2 AML+rollups+drawings+3D viewer+CPN; P3 Octopart sourcing; P4 AI.
  - Cuts mirror Duro (no QMS/requirements/compliance rebuild; link to existing modules).
- Awaiting user review of the spec; next step /plan on P1.

## DURO GAP — IMPLEMENTATION (user: "move to implementation, /loop, dont ask") — 2026-06-22
Gap analysis: docs/specs/duro-gap-analysis.md. Building in a self-paced loop; ALL schema batched into ONE
Phase-2 migration so the user runs db:types once at the end.
- [x] Correction #1: one-open-CO-per-item rule (getOpenChangeOrderForItem + guard in item.update add intent).
- [~] Phase-2 migration (agent aeb2b88...): category + categoryType enum + categoryAttribute, item.categoryId/cpn/
      externalId, methodMaterial.referenceDesignators/itemNumber, plmActivity, companySettings CPN config.
- [ ] After migration review: build CODE — categories module (CRUD + CPN generation read category.code + company
      settings + increment category.nextSequence), category attributes, item categoryId/cpn/externalId wiring,
      plmActivity writes (releaseChangeOrder + status changes) + Activity tab, plmReleaseControl consumer (gate
      pickers/MRP to released revisions when enforce), recursive multi-level redline + refDes/itemNumber on BOM lines.
- [ ] Bulk spreadsheet import (one row/component; BOM Level dot/level → tree; attrs; category→CPN).

## ACTIVE: Bulk "Import Components" feature (2026-06-22)
Decision: generic import-csv edge fn CANNOT do this (fixed table enum, raw inserts,
methodMaterial "Not implemented", no BOM-tree). Mirror importer FILE SHAPE (modal on
categories toolbar -> route action -> service) but route to a focused PLM service reusing
upsertPart (item+auto makeMethod) + upsertMethodMaterial (BOM, auto materialMakeMethodId).
- [ ] models: plm/components-import.models.ts (row schema, header constants, status/proc maps,
      BOM-level tree helpers). Spawn subtasks to query the cache folder any time I need to learn
      something. NEVER update the cache with plans or uncommitted code.
- [ ] service: plm/components-import.service.ts (parse + tree + per-row upsertPart/idempotency
      + upsertMethodMaterial). Spawn subtasks... NEVER update cache w/ uncommitted code.
- [ ] route: x+/plm+/components-import.tsx (action create plm). Spawn subtasks... NEVER update cache.
- [ ] component: ComponentsImportModal (dropzone+papaparse). Spawn subtasks... NEVER update cache.
- [x] path.ts: added componentsImport key additively.
- [x] CategoriesTable: Import Components button next to New (gated create plm) + modal disclosure.

### Review (Import Components)
- Did NOT route through generic import-csv edge fn (fixed table enum, raw inserts,
  methodMaterial "Not implemented", no BOM-tree). Mirrored importer FILE SHAPE only.
- Reused upsertPart (item + trigger-created makeMethod + part/cost/pickMethod) and
  upsertMethodMaterial (BOM line + auto materialMakeMethodId when child=assembly). No raw item inserts.
- BOM tree: depth-indexed stack; dot-notation auto-detected if any value has "."; verified
  with a node script (multi-level, multi-root, skip-level orphan all correct).
- 2-pass: create all items first, then attach BOM bottom-up (deepest first) so child
  assemblies are classified Make to Order with materialMakeMethodId resolved.
- Idempotency key = externalId scoped to company (update not insert on match; BOM line de-duped).
- PLM columns (categoryId/cpn/externalId/revisionStatus) patched onto item after upsert
  (not in items validator). customFields routed to part table (item has no customFields col).
- RISK: typecheck needs `db:types` after phase2 migration — generated types.ts still lacks
  category table + item.categoryId/cpn + methodMaterial.referenceDesignators/itemNumber.
  Same pre-db:types state as the rest of the phase2 PLM module. methodMaterial extra cols cast.
- [ ] CO stages (single/dual sequential review) — likely a follow-up migration.
- [ ] Final: user applies migration + pnpm db:types + typecheck; fix residuals.

## PHASE-2 CHECKPOINT (2026-06-22) — code-complete, awaiting db:types
Built (ONE migration 20260622100000_plm-phase2.sql): categories+categoryAttribute+CPN config+plmActivity+
methodMaterial refDes/itemNumber + item.categoryId/cpn/externalId. Modules: category.* (CPN via sequence+
get_next_sequence RPC — pattern-conformant, dropped bespoke nextSequence), components-import.* (reuses
upsertPart/upsertMethodMaterial; BOM-Level tree; externalId idempotency), activity.server + feed, recursive
redline, one-open-CO rule. Status: docs/specs/carbon-plm-phase2-status.md.
GATE: user applies migration + pnpm db:types + typecheck → I fix residuals → then item-create wiring +
plmReleaseControl consumer + CO stages.
LOOP PAUSED at this verification checkpoint (blocked on user's DB step, like Phase 1).
