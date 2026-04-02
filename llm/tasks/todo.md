# Phase 4: Consolidated Financial Statements (Simplified)

Consolidation is now built into the existing report pages via multi-company
selection. No separate consolidation submodule, no persisted entity.

## Remove

- [x] Drop `consolidationRun`, `consolidationRunDetail` tables and `executeConsolidation` RPC
- [x] Remove all consolidation service functions, types, validators
- [x] Remove all consolidation UI components and routes
- [x] Remove consolidation from sidebar nav and path helpers
- [x] Remove old snippet file

## Build

- [x] Multi-select `CompanySelector` (checkboxes in popover)
- [x] Update `ReportFilters` to support multi-company (hides translation toggle, shows "Showing in {currency}")
- [x] `getConsolidatedBalances` service function — translates each company to parent currency, sums
- [x] Auto-include elimination entities (walks ancestor chain, includes elim entities at each level)
- [x] Update balance-sheet, income-statement, trial-balance loaders for multi-company
- [x] URL param: `?companies=id1,id2` (defaults to current company)

## Remaining

- [ ] Regenerate database types after running migration
- [ ] Test multi-company consolidation with elimination entities
- [ ] Test single-company mode still works unchanged
