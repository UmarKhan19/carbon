# Consolidation Implementation

## Phase 1: Per-Company Financial Visibility — COMPLETE
- [x] Migration: `accountTreeBalancesByCompany` and `trialBalance` RPCs
- [x] Service functions, routes, UI components, sidebar

## Phase 2: Currency Translation — COMPLETE
- [x] Migration: `exchangeRateHistory` table, `exchangeRateType` enum, populate `consolidatedRate` defaults, `translateTrialBalance` RPC
- [x] Service: currency-translation.service.ts (CRUD for exchange rate history)
- [x] Models: currency-translation.models.ts (validator, types)
- [x] Routes: exchange-rates (list), exchange-rates.new, exchange-rates.$rateId, exchange-rates.delete.$rateId
- [x] UI: ExchangeRatesTable (standard Table component), ExchangeRateForm (Drawer pattern)
- [x] Sidebar: Exchange Rates added under Configure
- [ ] TODO (future): Enhance report pages with translated column toggle for foreign subsidiaries

## Files Created (Phase 2)
- `packages/database/supabase/migrations/20260315000002_exchange-rate-history.sql`
- `apps/erp/app/modules/accounting/currency-translation.service.ts`
- `apps/erp/app/modules/accounting/currency-translation.models.ts`
- `apps/erp/app/modules/accounting/ui/ExchangeRates/index.ts`
- `apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRatesTable.tsx`
- `apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRateForm.tsx`
- `apps/erp/app/routes/x+/accounting+/exchange-rates.tsx`
- `apps/erp/app/routes/x+/accounting+/exchange-rates.new.tsx`
- `apps/erp/app/routes/x+/accounting+/exchange-rates.$rateId.tsx`
- `apps/erp/app/routes/x+/accounting+/exchange-rates.delete.$rateId.tsx`

## Files Modified (Phase 2)
- `apps/erp/app/utils/path.ts` — added exchange rate paths
- `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` — added Exchange Rates to sidebar

## Review
