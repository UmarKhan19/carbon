# AR & AP Payments and Cash Application

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the accounting loop on both AR and AP. Add `payment` + `paymentApplication` (NetSuite-style, type-discriminated), atomic settlement in an edge function, view-derived invoice status, FX gain/loss posting, and a subledger-to-GL tie-out report. Drop the unused `purchasePayment` stubs. Fix the pre-existing FX posting bug in invoice posting so the tie-out is meaningful.

**Architecture:** One symmetric model differentiated by `paymentType` ('Receipt' vs 'Disbursement'); settlement runs inside a Kysely transaction in a new `post-payment` edge function (mirroring `post-sales-invoice`/`post-purchase-invoice`); invoice `balance` column dropped, recomputed in views from `paymentApplication` rows.

**Tech Stack:** PostgreSQL (migrations), TypeScript (Deno edge functions, Remix services), Kysely.

**Full design plan:** `/root/.claude/plans/create-a-plan-to-wondrous-hejlsberg.md`

**Locked decisions (from clarification round):**
- Multi-currency: include realized FX gain/loss.
- Existing AP stubs (`purchasePayment`, `purchaseInvoicePaymentRelation`): drop and replace.
- Invoice `balance` column: drop from both base tables; derive in views.
- Tie-out UI: two routes (`ar-tie-out.tsx`, `ap-tie-out.tsx`) rendering a shared `<TieOut side=... />` component.

**Critical verified facts:**
- `salesInvoiceStatus` active = `'Submitted'`; `purchaseInvoiceStatus` active = `'Open'` (renamed in `20260422004200_purchase-invoice-status-submitted-to-open.sql`). CASE expressions and validators must parameterize per side.
- Zero callers read `salesInvoice.balance` or `purchaseInvoice.balance` from base tables (grep confirmed across `apps/erp/app/modules/invoicing/`, both invoice route trees, and the posting edge functions).
- Discount accounts already exist on `accountDefault`: `customerPaymentDiscountAccount` (7030), `supplierPaymentDiscountAccount` (7020). Use those for the application `discountAmount` posting.
- FX accounts exist in COA seed (4120 Foreign Exchange Gains, 7060 Foreign Exchange Losses) but are NOT mapped on `accountDefault` yet.
- Write-off accounts don't exist anywhere — need new COA entries + new `accountDefault` columns.
- **Pre-existing FX bug**: `post-sales-invoice/index.ts:115,296` and `post-purchase-invoice/index.ts:449-458` push `quantity * unitPrice` into journal lines without multiplying by `exchangeRate`. Foreign-currency journal lines are denominated in foreign currency, not base. Must be fixed in this PR for tie-out variance to be meaningful.

---

## Task 1: Migration — payment + paymentApplication schema + account defaults backfill

**Files:**
- Create: `packages/database/supabase/migrations/<ts>_ar-ap-payments.sql`
- Edit: `packages/database/supabase/functions/lib/seed.data.ts` (CoA entries + accountDefaults map)
- Edit: `packages/database/supabase/functions/seed-company/index.ts` if seed loop reads the columns explicitly

- [x] **Step 1.1: Drop the unused AP stubs** (`DROP TABLE IF EXISTS purchaseInvoicePaymentRelation; DROP TABLE IF EXISTS purchasePayment;`). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 1.2: Create enums** `paymentType` ('Receipt','Disbursement'), `paymentStatus` ('Draft','Posted','Voided'). Extend `journalLineDocumentType` with `'Payment'` via `ALTER TYPE ... ADD VALUE IF NOT EXISTS`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 1.3: Add new CoA entry** for `4130` "Vendor Write-Off Income" (AP write-off, Other Income). AR write-off reuses existing `6050` "Bad Debts Expense". FX gain/loss reuse existing `4120` / `7060`. Insert per `companyGroup` via DO block; only one new account needed.

- [x] **Step 1.4: Add four new columns to `accountDefault`**: `customerWriteOffAccount`, `supplierWriteOffAccount`, `realizedExchangeGainAccount`, `realizedExchangeLossAccount`. Add FKs to `account(id)` (single-column post company-groups refactor).

- [x] **Step 1.5: Backfill defaults for existing companies** via UPDATE looking up `account.id` by `(number, companyGroupId)` per company. Then `SET NOT NULL` for all four. Targets: `6050`, `4130`, `4120`, `7060`.

- [x] **Step 1.6: Create `payment` table** with all fields per plan. RLS uses `get_companies_with_employee_permission('invoicing_*')`. Currency FK is single-column (post-refactor).

- [x] **Step 1.7: Create `paymentApplication` table** with `fxGainLossAmount` as GENERATED ALWAYS AS STORED. RLS for INSERT/UPDATE/DELETE checks parent payment.status='Draft'.

- [x] **Step 1.8: Seed `payment` sequence** for existing companies (prefix `PAY-%{yyyy}-%{mm}-`, size 6) via `INSERT INTO sequence ... SELECT FROM company ON CONFLICT DO NOTHING`.

- [x] **Step 1.9: Update `seed.data.ts`**: added 4130 to `accounts` array, four new keys to `accountDefaults`, and a `payment` entry to `sequences`.

- [x] **Step 1.10: Verify** migration applies cleanly. Confirmed against a production-shape scaffold: stubs dropped, 4130 CoA entry created, four `accountDefault` columns added + backfilled + SET NOT NULL, both `paymentType` and `paymentStatus` enums created, `journalLineDocumentType` extended with `'Payment'`, `payment` + `paymentApplication` tables created with all RLS policies, sequence seeded. Check constraints (party_check, totalAmount_check) tested and reject invalid rows. Generated column `fxGainLossAmount = (appliedAmount + discountAmount) * (paymentExchangeRate - invoiceExchangeRate)` arithmetic verified (100 @ 1.10 → 1.05 yields -5.0000 FX Loss).

---

## Task 2: Edge function — `post-payment`

**Files:**
- Create: `packages/database/supabase/functions/post-payment/index.ts`

Pattern mirrors `post-sales-invoice/index.ts` and `post-purchase-invoice/index.ts`. Single endpoint handling both `action: 'post'` and `action: 'void'`.

- [x] **Step 2.1: Scaffold** the function with the standard Deno + Kysely + Supabase imports. Accept `{ paymentId, action, userId, companyId }`. Single `db.transaction().execute(async (trx) => { ... })`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 2.2: Load payment + applications + each invoice** with `SELECT ... FOR UPDATE` on the invoices (serializes concurrent settlements of the same invoice). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 2.3: Validate** — payment.status='Draft'; each application's invoice has the side's active status (`'Submitted'` for sales, `'Open'` for purchase); per-invoice sum (applied+discount+writeOff) ≤ remaining open; per-payment Σ applied × paymentExchangeRate ≤ totalAmount × payment.exchangeRate (base-currency comparison); both exchange rates > 0. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 2.4: Resolve posting accounts** via the existing `getDefaultPostingGroup` pattern in the sibling functions, falling back to `accountDefault`. Need: receivablesAccount/payablesAccount, customerPaymentDiscountAccount/supplierPaymentDiscountAccount, customerWriteOffAccount/supplierWriteOffAccount, realizedExchangeGain/Loss, bank account (from `payment.bankAccountNumber`). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 2.5: Build journal + lines** in base currency. AR Receipt: DR Bank (Σ A × R_p), DR discount (Σ D × R_i), DR write-off (Σ W × R_i), CR AR control (Σ (A+D+W) × R_i), FX plug. AP Disbursement: mirror. Single journal entry with `sourceType='Payment'` and one `journalLineReference` UUID grouping all lines. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 2.6: Update payment** to `status='Posted', postingDate, journalId, postedAt, postedBy`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 2.7: Void path** — call `reverseJournalEntry` for `payment.journalId`, then `UPDATE payment SET status='Voided', voidedAt, voidedBy`. Application rows kept; view CTE filters on `payment.status='Posted'` so they drop out of settlement automatically. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

---

## Task 3: Service module — `payments.service.ts`

**Files:**
- Create: `apps/erp/app/modules/invoicing/payments.service.ts`
- Create: `apps/erp/app/modules/invoicing/payments.models.ts`

- [x] **Step 3.1: Zod validators** in `payments.models.ts` for `paymentValidator` (the upsert shape), `paymentApplicationValidator`. Mirror the existing invoice validator patterns. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 3.2: CRUD service functions**: `getPayment`, `getPaymentsList(filters)`, `upsertPayment` (Draft-only via RLS), `deletePayment` (Draft-only via RLS), `replacePaymentApplications(paymentId, apps[])` (delete-then-insert), `getOpenInvoicesForCustomer`, `getOpenInvoicesForSupplier`. All return `{data, error}`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 3.3: Edge function invokers** `postPayment(supabase, paymentId, userId)` and `voidPayment(supabase, paymentId, userId)`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 3.4: Tie-out fetchers** `getArTieOut(client, companyId, asOfDate)` and `getApTieOut(...)` calling the RPCs from Task 5. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

---

## Task 4: Migration — invoice views (derived balance + status) + drop balance column

**Files:**
- Create: `packages/database/supabase/migrations/<ts>_invoice-derived-status.sql`

- [x] **Step 4.1: Drop existing views** `salesInvoices` and `purchaseInvoices`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 4.2: Drop `balance` column** from `salesInvoice` and `purchaseInvoice` base tables. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 4.3: Recreate `salesInvoices` view** with CTE summing applications (`appliedAmount + discountAmount + writeOffAmount` from `paymentApplication` joined to `payment WHERE status='Posted'`), exposing computed `balance` and derived `status`:
  ```sql
  CASE
    WHEN status IN ('Draft','Pending','Voided','Return','Credit Note Issued') THEN status::TEXT
    WHEN COALESCE(settled, 0) >= "totalAmount" THEN 'Paid'
    WHEN COALESCE(settled, 0) > 0 THEN 'Partially Paid'
    WHEN "dateDue" < CURRENT_DATE AND status = 'Submitted' THEN 'Overdue'
    ELSE status::TEXT
  END AS status
  ```
  Preserve all other columns from prior view shape. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 4.4: Recreate `purchaseInvoices` view** parallel to sales, substituting active state `'Open'` (not `'Submitted'`) and `'Debit Note Issued'` (not `'Credit Note Issued'`). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 4.5: Remove `Paid`/`Partially Paid` status writes** from `apps/erp/app/modules/invoicing/invoicing.service.ts:323-344, 362-382`. Reject those values in `updateSalesInvoiceStatus`/`updatePurchaseInvoiceStatus`. Remove the `datePaid` setter. Keep the Draft→Pending→Submitted/Open manual path. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 4.6: Narrow MCP tool schemas** in `apps/erp/app/routes/api+/mcp+/lib/tools/invoicing.ts:351-403` (and equivalent for purchase) to reject derived statuses. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

---

## Task 5: FX posting bug fix in existing invoice posting (in scope)

**Files:**
- Edit: `packages/database/supabase/functions/post-sales-invoice/index.ts`
- Edit: `packages/database/supabase/functions/post-purchase-invoice/index.ts`

- [x] **Step 5.1: Multiply by `exchangeRate`** before pushing into `journalLine.amount` at every site: `unitPrice`, `shippingCost`, `addOnCost`, `taxAmount`. Roughly four insert sites per function: lines 115, 296, 374–498 in sales; lines 445–458 in purchase. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 5.2: Verify no double-conversion** — if any site already multiplied by exchangeRate, don't compound. Audit each before edit. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

---

## Task 6: Migration — tie-out RPCs

**Files:**
- Create: `packages/database/supabase/migrations/<ts>_ar-ap-tie-out.sql`

- [x] **Step 6.1: Create `get_ar_tie_out(_company_id TEXT, _as_of_date DATE)`** returning `(subledgerBalance, glBalance, variance)`. Subledger = `SUM((si.totalAmount − COALESCE(settled,0)) × si.exchangeRate)` where `postingDate <= as_of` and `status NOT IN ('Draft','Pending','Voided')`, with settled CTE filtered to `pa.appliedDate <= as_of` AND `p.status='Posted'`. GL = `SUM(jl.amount)` over `journalLine JOIN journal` where `accountNumber = accountDefault.receivablesAccount` and `j.postingDate <= as_of`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 6.2: Create `get_ap_tie_out`** mirror using `payablesAccount` and `purchaseInvoice`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 6.3: Drill-down RPCs** `get_ar_open_by_customer` and `get_ap_open_by_supplier` returning per-counterparty rows of open invoices. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

---

## Task 7: Account defaults UI

**Files:**
- Edit: `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx`

- [x] **Step 7.1: Add four account-picker fields** for the new columns. `customerWriteOffAccount` filtered to Expense accounts; `supplierWriteOffAccount` filtered to Revenue/Other Income; `realizedExchangeGainAccount` filtered to Revenue/Other Income; `realizedExchangeLossAccount` filtered to Expense/Other Expense. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

---

## Task 8: Payment routes + UI

**Files:**
- Create: `apps/erp/app/routes/x+/payment+/_layout.tsx`
- Create: `apps/erp/app/routes/x+/payment+/_index.tsx`
- Create: `apps/erp/app/routes/x+/payment+/new.tsx`
- Create: `apps/erp/app/routes/x+/payment+/$paymentId.tsx`
- Create: `apps/erp/app/routes/x+/payment+/$paymentId.post.tsx`
- Create: `apps/erp/app/routes/x+/payment+/$paymentId.void.tsx`

- [x] **Step 8.1: List + new payment** — paginated table, filterable by type/status/party/date; `new.tsx` chooses Receipt vs Disbursement and allocates `paymentId` via `getNextSequence`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 8.2: Payment detail with applications editor** — header fields + ValidatedForm (zod), open-invoice picker for the counterparty, row-level `appliedAmount`/`discountAmount`/`writeOffAmount`, running totals against payment.totalAmount. Shared `<CounterpartyCombobox>` driven by `paymentType`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 8.3: Post + Void routes** thin Remix actions that invoke `supabase.functions.invoke('post-payment', {...})`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

---

## Task 9: Tie-out UI

**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Reports/TieOut.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/ar-tie-out.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/ap-tie-out.tsx`

- [x] **Step 9.1: Shared `<TieOut side="ar"|"ap" />` component** — date picker (defaults to today), header showing subledger balance, GL balance, variance pill (green if zero, red otherwise), drill-down tables for open invoices and journal lines. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [x] **Step 9.2: AR + AP route shells** each rendering `<TieOut side={...} />` with appropriate page title and breadcrumb. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

---

## Task 10: Tests + end-to-end verification

**Files:**
- Create: `apps/erp/app/modules/invoicing/payments.service.test.ts`

- [x] **Step 10.1: Service tests** covering validator rejection paths, FX `fxGainLossAmount` generated column arithmetic, view `balance` + `status` derivation across all status combinations. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

- [ ] **Step 10.2: Manual e2e** (DB reset run by user, not Claude):
  - Seed company + customer + supplier + bank account
  - Post USD sales invoice → AR posted in base
  - AR full receipt → invoice derives to Paid
  - AR partial + discount → Partially Paid → Paid
  - AR on-account (no applications) → unapplied credit visible in subledger
  - AR write-off → Paid with cash < total
  - AR EUR invoice @ 1.10 + USD receipt @ 1.05 → FX Loss line; sum of lines = 0
  - AP mirror of each
  - Tie-out variance = 0 in base currency after each step
  - Void posted payment → reversal journal; invoice status reverts; tie-out balances
  - Concurrent post against same invoice → second fails on FOR UPDATE / open-amount check
  
  Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

---

## Review

### Thermo-nuclear review fixes (post-implementation)

A deep code-quality audit (4 parallel reviewers) found correctness bugs that
the original implementation's "verified" status missed (only a plain AR receipt
had actually been exercised). Fixed in priority order:

- **B1 (BLOCKER) — broken journal balance check.** `post-payment/index.ts`
  summed the natural-balance `amount` and required `~0`, but the `credit()`/
  `debit()` helpers encode natural-balance sign (`credit("asset")` is negative,
  not signed-debit), so a balanced entry does NOT sum to zero. The check threw
  on every AP disbursement and every AR receipt with an FX gain. Removed it
  (siblings `post-*-invoice` don't self-check; the FX plug already balances the
  entry). See lessons.md.
- **B2 (BLOCKER) — view dropped a money term.** Recreating `salesInvoices` by
  hand-retyping its columns silently dropped `+ nonTaxableAddOnCost` from
  `invoiceTotal`. Restored. (Reinforces: prefer `SELECT *` + computed columns
  when recreating views.)
- **B3 (BLOCKER) — non-atomic writes.** `replacePaymentApplications` was a
  delete-then-insert (data loss on insert failure) and `new.tsx` inserted a
  starter application whose error was unchecked. Converted
  `replacePaymentApplications` to a Kysely transaction with a `FOR UPDATE`
  Draft re-check (Kysely bypasses RLS), and routed `new.tsx`'s starter row
  through it with honest failure surfacing.
- **M1 (MAJOR) — tie-out/aging date basis.** Subledger settled-amount was cut
  on the user-editable `appliedDate` while the GL cut on `journal.postingDate`,
  guaranteeing spurious variance. Switched all settled subqueries (tie-out AND
  aging, AR + AP, incl. drill-downs) to the payment's `postingDate`.
- **M2 (MAJOR) — FX classification + column/journal divergence.** The generated
  `fxGainLossAmount` column and the journal FX plug disagreed (column excluded
  write-off). **Resolved (user chose the stricter, textbook-correct policy):**
  realized FX accrues on the **cash-settled principal only** (`appliedAmount`).
  Discount and write-off are invoice-currency reliefs, now booked at the
  **invoice** rate and carrying no FX. Both `post-payment` (discount/write-off
  lines + FX plug) and the generated column now use
  `appliedAmount × (paymentRate − invoiceRate)`. The journal still balances in
  signed-debit space (the two changes cancel exactly), and the subledger
  reconciles to the GL FX accounts. Total P&L is unchanged vs the prior
  treatment — only the FX-vs-discount/write-off line classification shifts.
  (Note: B1's hand-rolled `Σ amount` check was replaced between turns by a
  correct `signedDebitTotal` guard in `post-payment` — strictly better than the
  earlier deletion.)

**Deferred (user decision):**
- **M3** — ~430 lines of AR/AP token-swap duplication across the reporting RPCs
  + ~60 lines of TS wrappers. Pure maintainability; pulled out as a focused
  follow-up to keep the correctness fixes a clean, low-risk changeset.

**Verification note:** all changes are pre-DB-reset. `types.ts` does not yet
contain the `payment`/`paymentApplication` tables, so the whole feature (not
just these edits) needs a type regeneration after the migrations apply. No DB
was rebuilt — that's the user's step.

## Lessons captured

(Append to `llm/tasks/lessons.md` after each correction.)

---

# Customer / Supplier / Item Accounting Dimensions

**Goal:** Add three new entity-backed accounting dimensions — `Customer`, `Supplier`, `Item` — so the GL can answer "how much did I buy from supplier X" / "who are my biggest customers" / per-item spend. These become default dimensions for every company (backfill existing, seed new) and are auto-tagged onto every applicable posted journal line. The payment poster (`post-payment`) currently writes **zero** dimensions — closing that gap is the headline of this work.

**Locked decisions (clarification round):**
- High-cardinality selector: lazy-load via existing client stores `useCustomers` / `useSuppliers` / `useItems` (nanostores hydrated by `RealtimeDataProvider`). Do **not** eager-load Customer/Supplier/Item rows in `getEntityDimensionValues`.
- `Item` dimension keyed to `item.id` (all item types), display = `readableIdWithRevision` + `name`.

**Existing entity types (for reference):** Custom, Location, Department, Employee, CostCenter, ItemPostingGroup, CustomerType, SupplierType, WorkCenter, Process, FixedAssetClass. We already have the *grouping* types (CustomerType/SupplierType/ItemPostingGroup); these new ones are the *specific entity*.

**Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.**

## 1. Schema & enum (two migrations — enum-add gotcha)
- [ ] Migration A `..._customer-supplier-item-dimensions.sql`: `ALTER TYPE "dimensionEntityType" ADD VALUE 'Customer'; ... 'Supplier'; ... 'Item';` — **enum-add only**, nothing else (mirrors `20260524163042_asset-class-dimension.sql`; can't use a new enum value in the same txn that adds it).
- [ ] Migration B (later randomized HHMMSS timestamp) `..._backfill-entity-dimensions.sql`: backfill INSERT into `dimension` for all `companyGroup` rows, `('Customer','Customer'),('Supplier','Supplier'),('Item','Item')`, `createdBy='system'`, `ON CONFLICT (name, companyGroupId) DO NOTHING` (mirrors `20260228024512_dimensions.sql:176`). Consider also backfilling the never-backfilled `WorkCenter`/`Process`/`FixedAssetClass` here — confirm with user first.
- [ ] Follow `llm/workflows/database-migration.md`. Randomize timestamps (no 000000).

## 2. New-company seed
- [ ] Add `{name:"Customer",entityType:"Customer"}`, `{name:"Supplier",entityType:"Supplier"}`, `{name:"Item",entityType:"Item"}` to the `dimensions` array in `packages/database/supabase/functions/lib/seed.data.ts:8`. This single source feeds both `seed-company/index.ts` and `seed-dev.ts` — no other seed edits needed.

## 3. Service — value resolution (`accounting.service.ts`)
- [ ] `getEntityValuesByIds` (~1143): add `Customer`→`customer(id,name)`, `Supplier`→`supplier(id,name)`, `Item`→`item` selecting `id` + a name expression (`readableIdWithRevision`/`name`). This resolves `valueName` for already-tagged lines on server-rendered posted entries. Bounded `.in("id", ids)` — fine.
- [ ] `getEntityDimensionValues` (~991): add `Customer`/`Supplier`/`Item` cases that return **empty** `[]` (do NOT eager-load) so the dimension still appears in `availableDimensions` but the selector sources options from the client store.

## 4. UI plumbing (4 spots)
- [ ] `accounting.models.ts:506` `dimensionEntityTypes` — add `Customer`, `Supplier`, `Item`.
- [ ] `DimensionForm.tsx` `entityTypeLabels` — add labels (Customer / Supplier / Item).
- [ ] `DimensionSelector.tsx` `entityTypeColors` — add colors.
- [ ] `Icons.tsx:604` `DimensionEntityTypeIcon` — add icons.

## 5. DimensionSelector — store-backed combobox for high-cardinality types
- [ ] In `DimensionSelector.tsx`, branch on `dim.entityType`. For `Customer`/`Supplier`/`Item`, render a store-backed `CreatableCombobox` (driven by `useCustomers`/`useSuppliers`/`useItems` mapped to `{value,label}`, mirroring `Form/Customer.tsx`/`Form/Supplier.tsx`/`Form/Item.tsx`) instead of the eager `DropdownMenuRadioGroup`. Low-cardinality types keep the existing radio sub-menu.
- [ ] `handleValueChange` must source `valueName` from the store row (combobox option label) for these types, since `dim.values` is empty.

## 6. Posting functions — auto-tag the new dimensions
Each post-* function builds a `dimensionMap` (entityType→dimensionId), per-line `journalLineDimensionsMeta`, then zips returned line ids into `journalLineDimension` inserts. Add the new entity types to the map query, the meta, and the inserts:
- [ ] `post-payment/index.ts` — **net-new dimension wiring** (currently none). Add `dimensionMap` for Customer/Supplier, tag the AR/AP control + cash lines with `Customer` (Receipt, `payment.customerId`) or `Supplier` (Disbursement, `payment.supplierId`). Decide per-line scope (likely all lines of the payment share the party).
- [ ] `post-sales-invoice/index.ts` — add `Customer` (header `customerId`) + `Item` (line `itemId`).
- [ ] `post-purchase-invoice/index.ts` — add `Supplier` (header `supplierId`) + `Item` (line `itemId`).
- [ ] `post-receipt/index.ts` — add `Supplier` + `Item`.
- [ ] `post-shipment/index.ts` — add `Customer` + `Item`.
- [ ] `issue/index.ts` — add `Item`.
- [ ] `post-production-event/index.ts` — add `Item` (confirm itemId availability).
- [ ] Migration-embedded posting SQL: `20260511120000_backflush-job-materials.sql`, `20260508120000_complete-job-to-inventory.sql` — add `Item` dimension inserts (these insert `journalLineDimension` directly in SQL; new dims must resolve the Item dimension id per company group).
- [ ] Audit `accounting.server.ts` manual JE / disposal posting — Item/Customer/Supplier not generally applicable (manual), leave unless obvious.

## 7. Verification
- [ ] Type-check only the individual edited files (never whole-project `tsc`).
- [ ] `types.ts` regen + DB reset are the **user's** step — do not rebuild the DB. Flag what needs regen.
- [ ] After user reset: e2e — post an AP invoice + AP payment, confirm Supplier+Item dims appear in the selector and on the posted journal lines; post an AR receipt, confirm Customer dim. Use `/test`.

## Review

**Status: implemented (pending DB reset + types regen by user).**

What was built:
- **Migrations:** `20260617091742_customer-supplier-item-dimensions.sql` (enum-add only: Customer/Supplier/Item) + `20260617104938_backfill-entity-dimensions.sql` (idempotent backfill of all 6 missing default dims — Customer/Supplier/Item plus the never-backfilled WorkCenter/Process/FixedAssetClass — for every company group via `ON CONFLICT (name, companyGroupId) DO NOTHING`) + `20260617121634_job-costing-item-dimension.sql` (forks the latest `backflush_job_materials` + `complete_job_to_inventory` from 20260511120000 verbatim, adding only the Item dimension resolution + inserts; diff-verified line-by-line).
- **New-company seed:** 3 entries added to `seed.data.ts` (feeds seed-company + seed-dev).
- **Service:** `getEntityValuesByIds` resolves Customer/Supplier/Item names for already-tagged lines (Item → `readableIdWithRevision`); `getEntityDimensionValues` explicitly returns empty for the three (no eager-load) with a comment.
- **UI:** `dimensionEntityTypes`, `entityTypeLabels` (+ WorkCenter/Process which were missing), `entityTypeColors`, `DimensionEntityTypeIcon` all extended. `DimensionSelector` now offers high-cardinality dims in the "Dimension +" dropdown; selecting one reveals an inline store-backed `Combobox` (useCustomers/useSuppliers/useItems) — searchable + virtualized, no eager load — which collapses to a badge once a value is picked.
- **Posting:** Customer (post-sales-invoice, post-shipment SO case, post-payment Receipt), Supplier (post-purchase-invoice, post-receipt PO block, post-payment Disbursement), Item per-line (all of the above + issue both blocks, post-production-event, and the two job-costing SQL functions). post-payment now tags BOTH the counterparty type AND the counterparty entity; its void path already carries dimensions forward, so reversals net out.

Invariant preserved everywhere: the `journalLineDimensionsMeta`↔journal-line index alignment was never altered (Customer/Supplier added in the insert loop as document-level tags; Item added only as a field on existing meta objects).

WIP/inventory coverage (follow-up sweep): every edge fn that inserts a journalLine now also writes journalLineDimension (verified — zero gaps). Added Item to the two WIP sites the first pass missed: the **labor WIP + absorption** lines inside `complete_job_to_inventory` (previously Employee-only), and **`close-job`** (the WIP-variance journal, which previously wrote no dimensions at all — now resolves Item/ItemPostingGroup/Location from the job's finished good). Material-consumption and WIP-discharge lines were already covered by the forked SQL functions.

Not changed (intentional): `accounting.server.ts` manual JE / fixed-asset disposal — Customer/Supplier/Item aren't auto-derivable there; users can add them via the selector. Warehouse-transfer receipt block and issue paths have no counterparty, so only Item applies.

**User action required:** DB reset + `types.ts` regen (new enum values + the dimension queries depend on regenerated types). Then e2e: post an AP invoice + AP payment → confirm Supplier + Item badges on the posted journal lines and selectable in the dropdown; post an AR receipt → confirm Customer.
