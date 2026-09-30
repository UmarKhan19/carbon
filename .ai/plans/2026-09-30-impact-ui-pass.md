# Change Notice Impact: conservative UI pass

## Design brief

Embedded operational workspace; ERP compact Table is the current-exposure exemplar (JobMaterialsTable, JobOperationsTable, ChangeNoticesTable). CustomerHeader supplies the header facts strip. ProductionPlanningOrderDrawer supplies the small embedded record table. InventoryCountHistory supplies restrained history hierarchy, not its event semantics.

Reuse existing Carbon primitives and existing writer/drawer/task components. No shared API extensions. Native Table selection cannot enforce per-row eligibility, so preserve local ID selection, all-data reconciliation, stale blockers and exact pure predicates. Reset the Table on ordered visible identity changes because native expansion is index-keyed. Local natural-height containment lets the page remain the vertical scroll owner.

Capabilities: inspect current target/source/conclusion/freshness/tasks; select only eligible current rows; retain hidden selections and block stale selections; review a bulk operation; expand current/stored facts and provenance; assess/reassess/resolve through existing forms; inspect history; manage existing linked tasks through their existing writers. Historical, source-deleted and unavailable records remain inspectable and retain permitted cleanup controls. Browser interactions will open/inspect/cancel only; no writes, refresh reconciliation or fixture changes.

One compact header with authoritative PO/Job/Material counts, To assess and coverage health. One source-coverage Alert for incomplete domains; independent task-coverage warning retained. Cancelled explains assessment lock; Done adds no duplicate banner. Current exposure is a scan table; details are expanded. Non-empty historical/unavailable collections are secondary. No raw protocol IDs in visible labels. Pane-aware facts, readable drawer identities and ICU plural labels.

## Plan

- [x] Verify branch, expected HEAD, pinned ancestor and clean worktree.
- [x] Read Carbon design/rules/lessons and actual siblings/API/semantics.
- [ ] Replace header/coverage presentation; inspect focused diff.
- [ ] Compose current Table and secondary collections; preserve selection/gates and all real writers.
- [ ] Simplify drawer/history/task presentation and pane-aware facts; add focused presentation regressions.
- [ ] Inventory message changes before any catalog edits; apply only owned ERP messages.
- [ ] Browser review at 1440, 1024, 390, Draft/Done/Cancelled; Carbon mandatory self-review; maximum two evidence-based fix passes.
- [ ] Stop app and verify processes terminated before scoped validation.
- [ ] Focused Impact UI tests, memory-bounded ERP typecheck, changed-file Biome, narrow Lingui and diff hygiene.
- [ ] Inspect explicit staging and normal-hook changes; one local commit, no push.

## Boundaries

UI only. No route/service/model/authz/schema/data/MCP/backup/shared primitive changes. Existing operation-view drift stays untouched. Startup, if needed: `NODE_OPTIONS=--max-old-space-size=4096 crbn up --no-portless --no-regen`. No lint/typecheck/build with the app running. Hook performs broad extraction/staging: inspect all resulting catalogs and stop on unrelated churn rather than include it or bypass hooks.
