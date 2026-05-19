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

(Populated after implementation completes.)

## Lessons captured

(Append to `llm/tasks/lessons.md` after each correction.)
