# Sign-Aware Root Account Totals & Non-Editable Root Accounts

## Implementation

- [x] 1. Add `rootSignMultiplier()` and `applyRootSignCorrection()` helpers to `accounting.service.ts`
- [x] 2. Apply correction in `getFinancialStatementBalances()` (BS, IS, TB routes)
- [x] 3. Apply correction in `getChartOfAccounts()` (COA route)
- [x] 4. Apply correction in `getConsolidatedBalances()` (multi-company views)
- [x] 5. Hide Edit/Delete menu items for system accounts in `ChartOfAccountsTree.tsx`
- [x] 6. Add server guard in `charts.$accountId.tsx` action
- [x] 7. Add server guard in `charts.delete.$accountId.tsx` action
- [x] 8. Add `isSystem` column + DB trigger migration (`20260405000000_protect-root-accounts.sql`)
- [x] 9. Update seed data (`seed.data.ts`) with `isSystem: true` on root accounts
- [x] 10. Update reset migration VALUES to include `is_system` column
- [x] 11. Update `seed-dev.ts` INSERT to include `isSystem`

## Review
- [ ] Run `supabase db reset` to verify migration
- [ ] Verify BS root shows ~0 (Assets - Liabilities - Equity)
- [ ] Verify IS root shows Net Income (Revenue - Expenses)
- [ ] Verify root accounts have no Edit/Delete in COA tree menu
- [ ] Verify DB trigger prevents UPDATE/DELETE on system accounts
