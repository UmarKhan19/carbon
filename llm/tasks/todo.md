# Consolidation Implementation

## Phase 1: Per-Company Financial Visibility — COMPLETE
- [x] Migration: `accountTreeBalancesByCompany` and `trialBalance` RPCs
- [x] Service functions, routes, UI components, sidebar

## Phase 2: Currency Translation — Exchange Rate CRUD COMPLETE
- [x] Migration: `exchangeRateHistory` table, populate `consolidatedRate` defaults, `translateTrialBalance` RPC
- [x] Service: exchange rate history CRUD
- [x] Routes: exchange-rates (list), exchange-rates.$currencyId (edit)
- [x] UI: ExchangeRatesTable, ExchangeRateForm (Drawer pattern)
- [x] Sidebar: Exchange Rates added under Configure

## Phase 2 Remaining: Report Translation — COMPLETE
- [x] **Step 1**: Add `consolidatedRate` to all account entries in `seed.data.ts`
- [x] **Step 2**: Add `translateCompanyBalances()` to `accounting.service.ts` + export
- [x] **Step 3**: Extend `Transaction` type with optional translation fields in `types.ts`
- [x] **Step 4**: Update report loaders (balance-sheet, trial-balance, income-statement)
- [x] **Step 5**: Add "Show Translated" toggle to `ReportFilters`
- [x] **Step 6**: Update `FinancialStatementTree` for dual-column rendering
- [x] **Step 7**: Update `TrialBalanceTable` for dual-column rendering

## Review
- [x] All accounts in seed data have correct `consolidatedRate`
- [x] CTA calculation is correct (assets - liabilities - equity)
- [x] Same-currency companies show no translation UI
- [x] Missing rates fall back to 1.0

## Files Modified (Phase 2 Report Translation)
- `packages/database/supabase/functions/lib/seed.data.ts` — added `consolidatedRate` to 96 accounts
- `apps/erp/app/modules/accounting/accounting.service.ts` — added `translateCompanyBalances()`, `parentCompanyId` to `getCompaniesInGroup`
- `apps/erp/app/modules/accounting/types.ts` — added `TranslatedBalance`, `TranslatedTransaction` types
- `apps/erp/app/routes/x+/accounting+/balance-sheet.tsx` — translation in loader, CTA on account 3200
- `apps/erp/app/routes/x+/accounting+/trial-balance.tsx` — translation in loader, dual columns
- `apps/erp/app/routes/x+/accounting+/income-statement.tsx` — translation in loader
- `apps/erp/app/modules/accounting/ui/Reports/ReportFilters.tsx` — "Show in {currency}" toggle
- `apps/erp/app/modules/accounting/ui/Reports/FinancialStatementTree.tsx` — dual-column with header row
- `apps/erp/app/modules/accounting/ui/Reports/TrialBalanceTable.tsx` — translated debit/credit columns
