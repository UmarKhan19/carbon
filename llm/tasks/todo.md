# Phase 3: Intercompany Elimination — Implementation

## 1. Database Migration

- [x] Create migration `20260329120000_intercompany-tracking.sql` containing:
  - [x] `journalLine.intercompanyPartnerId` column + FK + index
  - [x] `customer.intercompanyCompanyId` column + FK + unique index
  - [x] `supplier.intercompanyCompanyId` column + FK + unique index
  - [x] `intercompanyTransaction` table + indexes + RLS
  - [x] `sync_intercompany_partners` trigger (auto-create IC records on company join)
  - [x] `sync_intercompany_partner_details` trigger (sync name/taxId changes)
  - [x] `cleanup_intercompany_partners` trigger (remove IC records on leave)
  - [x] `prevent_ic_record_deletion` trigger (block delete of IC customer/supplier)
  - [x] `matchIntercompanyTransactions` RPC
  - [x] `findLowestCommonParent` helper function (LCA for multi-tier hierarchies)
  - [x] `generateEliminationEntries` RPC (routes to correct elimination entity per LCA rule)

## 2. Edge Function Modifications

- [x] Modify `post-sales-invoice` — detect IC customer, use 1130, create IC transaction
- [x] Modify `post-purchase-invoice` — detect IC supplier, use 2020, create IC transaction

## 3. Backend (accounting.service.ts + accounting.models.ts)

- [x] Add IC service functions to `accounting.service.ts`
- [x] Add IC validators to `accounting.models.ts`

## 4. Routing & Navigation

- [x] Add intercompany paths to `path.ts`
- [x] Add "Intercompany" to accounting sidebar in `useAccountingSubmodules.tsx`

## 5. UI Routes

- [x] `intercompany.tsx` — list page with loader + transaction table + balance matrix
- [x] `intercompany.new.tsx` — generic IC transaction form
- [x] `intercompany.match.tsx` — action route for matching
- [x] `intercompany.eliminate.tsx` — action route for elimination

## 6. UI Components

- [x] `IntercompanyTransactionTable` — table with status badges
- [x] `IntercompanyTransactionForm` — generic IC transaction form
- [x] `IntercompanyBalanceMatrix` — who-owes-whom grid
- [x] `IntercompanyMatchingSummary` — stats summary

## 7. Type Generation

- [ ] Run type generation after migration to update Database types (requires DB rebuild)

## 8. Lowest Common Parent Rule

- [x] Add `findLowestCommonParent` SQL function for multi-tier hierarchy support
- [x] Update `generateEliminationEntries` to route eliminations per LCA rule
- [x] Update seed-company to name elimination entities "Elimination - [ParentName]"

## Review

- [x] Verify migration SQL is correct (fixed cleanup/prevent trigger interaction)
- [x] Verify edge function changes integrate cleanly
- [x] Verify routes follow existing patterns
- [x] LCA rule implemented for elimination entity routing
