# Phase 3: Intercompany Elimination

## Goal

Identify, match, and eliminate intercompany transactions so that consolidated financials do not double-count internal activity. When Company A sells to Company B within the same group, the sale revenue, purchase expense, receivable, and payable must all be removed from the consolidated view.

This phase introduces IC transaction tagging at posting time, a matching engine, and automated elimination journal entry generation on the elimination entity.

**Standalone value:** Even before full consolidation, IC reconciliation reports are critical for multi-entity groups to ensure their intercompany accounts balance.

## Dependencies

- Phase 1 must be complete (per-company balance querying)
- The elimination entity company must exist (auto-created when first subsidiary is added — this logic already works in `seed-company/index.ts`)

## How IC Transactions Flow

```
Company A sells to Company B (both in same companyGroup)

                  Company A (Seller)                    Company B (Buyer)
                  ─────────────────                     ─────────────────
post-sales-invoice:                      post-purchase-invoice:
  DR 1130 IC Receivables  $100             DR 5020 Purchases        $100
  CR 4010 Sales           $100             CR 2020 IC Payables      $100

  journalLine.intercompanyPartnerId        journalLine.intercompanyPartnerId
    = companyB.id                            = companyA.id

                         Elimination Entity
                         ──────────────────
  generateEliminationEntries:
    DR 4010 Sales           $100    (eliminate A's revenue)
    CR 5020 Purchases       $100    (eliminate B's cost)
    DR 2020 IC Payables     $100    (eliminate B's payable)
    CR 1130 IC Receivables  $100    (eliminate A's receivable)
```

After consolidation: IC revenue, IC cost, IC receivable, and IC payable all net to zero.

## Database Changes

### 3a. Add IC Partner Tracking to Journal Lines

```sql
ALTER TABLE "journalLine" ADD COLUMN "intercompanyPartnerId" TEXT;

ALTER TABLE "journalLine" ADD CONSTRAINT "journalLine_intercompanyPartnerId_fkey"
  FOREIGN KEY ("intercompanyPartnerId") REFERENCES "company"("id") ON DELETE SET NULL;

CREATE INDEX "journalLine_intercompanyPartnerId_idx"
  ON "journalLine"("intercompanyPartnerId")
  WHERE "intercompanyPartnerId" IS NOT NULL;

COMMENT ON COLUMN "journalLine"."intercompanyPartnerId"
  IS 'The counterparty company within the same group for intercompany transactions';
```

### 3b. New Table: `intercompanyTransaction`

Tracks IC transaction pairs and their matching/elimination status.

```sql
CREATE TABLE "intercompanyTransaction" (
  "id" TEXT NOT NULL DEFAULT id('ict'),
  "companyGroupId" TEXT NOT NULL,
  "sourceCompanyId" TEXT NOT NULL,
  "targetCompanyId" TEXT NOT NULL,
  "sourceJournalLineId" TEXT NOT NULL,
  "targetJournalLineId" TEXT,
  "amount" NUMERIC(19, 4) NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "documentType" "journalLineDocumentType",
  "documentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Unmatched',
  "eliminationJournalId" INTEGER,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "intercompanyTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "intercompanyTransaction_companyGroupId_fkey"
    FOREIGN KEY ("companyGroupId") REFERENCES "companyGroup"("id") ON DELETE CASCADE,
  CONSTRAINT "intercompanyTransaction_sourceCompanyId_fkey"
    FOREIGN KEY ("sourceCompanyId") REFERENCES "company"("id"),
  CONSTRAINT "intercompanyTransaction_targetCompanyId_fkey"
    FOREIGN KEY ("targetCompanyId") REFERENCES "company"("id"),
  CONSTRAINT "intercompanyTransaction_sourceJournalLineId_fkey"
    FOREIGN KEY ("sourceJournalLineId") REFERENCES "journalLine"("id"),
  CONSTRAINT "intercompanyTransaction_targetJournalLineId_fkey"
    FOREIGN KEY ("targetJournalLineId") REFERENCES "journalLine"("id"),
  CONSTRAINT "intercompanyTransaction_eliminationJournalId_fkey"
    FOREIGN KEY ("eliminationJournalId") REFERENCES "journal"("id"),
  CONSTRAINT "intercompanyTransaction_status_check"
    CHECK ("status" IN ('Unmatched', 'Matched', 'Eliminated'))
);

CREATE INDEX "intercompanyTransaction_companyGroupId_idx"
  ON "intercompanyTransaction"("companyGroupId");
CREATE INDEX "intercompanyTransaction_status_idx"
  ON "intercompanyTransaction"("status", "companyGroupId");
CREATE INDEX "intercompanyTransaction_source_target_idx"
  ON "intercompanyTransaction"("sourceCompanyId", "targetCompanyId");

ALTER TABLE "intercompanyTransaction" ENABLE ROW LEVEL SECURITY;
```

**RLS:**

```sql
CREATE POLICY "intercompanyTransaction_select" ON "intercompanyTransaction"
  FOR SELECT USING (
    "companyGroupId" = ANY (SELECT "get_company_groups_for_employee"())
  );

CREATE POLICY "intercompanyTransaction_insert" ON "intercompanyTransaction"
  FOR INSERT WITH CHECK (
    "companyGroupId" = ANY (SELECT "get_company_groups_for_root_permission"('accounting_create'))
  );

CREATE POLICY "intercompanyTransaction_update" ON "intercompanyTransaction"
  FOR UPDATE USING (
    "companyGroupId" = ANY (SELECT "get_company_groups_for_root_permission"('accounting_update'))
  );
```

### 3c. New RPC: `matchIntercompanyTransactions`

```sql
CREATE OR REPLACE FUNCTION "matchIntercompanyTransactions" (
  p_company_group_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "sourceCompanyId" TEXT,
  "targetCompanyId" TEXT,
  "amount" NUMERIC(19, 4),
  "status" TEXT,
  "matchedWithId" TEXT
)
LANGUAGE "plpgsql"
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Match unmatched IC transactions:
  -- Source's receivable against target's payable for the same amount and partner
  WITH matches AS (
    SELECT
      src."id" AS "sourceId",
      tgt."id" AS "targetId"
    FROM "intercompanyTransaction" src
    INNER JOIN "intercompanyTransaction" tgt
      ON src."sourceCompanyId" = tgt."targetCompanyId"
      AND src."targetCompanyId" = tgt."sourceCompanyId"
      AND src."amount" = tgt."amount"
      AND src."companyGroupId" = tgt."companyGroupId"
    WHERE src."companyGroupId" = p_company_group_id
      AND src."status" = 'Unmatched'
      AND tgt."status" = 'Unmatched'
      AND src."sourceJournalLineId" < tgt."sourceJournalLineId"  -- prevent double-matching
  )
  UPDATE "intercompanyTransaction" ict
  SET
    "status" = 'Matched',
    "targetJournalLineId" = CASE
      WHEN ict."id" = m."sourceId" THEN (SELECT "sourceJournalLineId" FROM "intercompanyTransaction" WHERE "id" = m."targetId")
      ELSE (SELECT "sourceJournalLineId" FROM "intercompanyTransaction" WHERE "id" = m."sourceId")
    END,
    "updatedAt" = NOW()
  FROM matches m
  WHERE ict."id" IN (m."sourceId", m."targetId");

  -- Return current state
  RETURN QUERY
  SELECT
    ict."id",
    ict."sourceCompanyId",
    ict."targetCompanyId",
    ict."amount",
    ict."status",
    ict."targetJournalLineId" AS "matchedWithId"
  FROM "intercompanyTransaction" ict
  WHERE ict."companyGroupId" = p_company_group_id
  ORDER BY ict."createdAt" DESC;
END;
$$;
```

### 3d. New RPC: `generateEliminationEntries`

```sql
CREATE OR REPLACE FUNCTION "generateEliminationEntries" (
  p_company_group_id TEXT,
  p_user_id TEXT
)
RETURNS INTEGER  -- returns the elimination journal.id
LANGUAGE "plpgsql"
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_elimination_company_id TEXT;
  v_journal_id INTEGER;
  v_period_id TEXT;
BEGIN
  -- Find the elimination entity
  SELECT c."id" INTO v_elimination_company_id
  FROM "company" c
  WHERE c."companyGroupId" = p_company_group_id
    AND c."isEliminationEntity" = true
  LIMIT 1;

  IF v_elimination_company_id IS NULL THEN
    RAISE EXCEPTION 'No elimination entity found for company group %', p_company_group_id;
  END IF;

  -- Get active accounting period for elimination entity
  SELECT "id" INTO v_period_id
  FROM "accountingPeriod"
  WHERE "companyId" = v_elimination_company_id
    AND "status" = 'Active'
  LIMIT 1;

  -- Create elimination journal
  INSERT INTO "journal" ("description", "accountingPeriodId", "companyId", "postingDate")
  VALUES ('Intercompany Elimination Entries', v_period_id, v_elimination_company_id, CURRENT_DATE)
  RETURNING "id" INTO v_journal_id;

  -- For each matched IC transaction, generate reversing entries
  INSERT INTO "journalLine" (
    "journalId", "accountNumber", "description", "amount",
    "documentType", "journalLineReference",
    "companyId", "companyGroupId"
  )
  SELECT
    v_journal_id,
    jl."accountNumber",
    'IC Elimination: ' || jl."description",
    -jl."amount",  -- reverse the original entry
    jl."documentType",
    'ic-elim-' || ict."id",
    v_elimination_company_id,
    p_company_group_id
  FROM "intercompanyTransaction" ict
  INNER JOIN "journalLine" jl ON jl."id" = ict."sourceJournalLineId"
  WHERE ict."companyGroupId" = p_company_group_id
    AND ict."status" = 'Matched';

  -- Also reverse the matched counterpart entries
  INSERT INTO "journalLine" (
    "journalId", "accountNumber", "description", "amount",
    "documentType", "journalLineReference",
    "companyId", "companyGroupId"
  )
  SELECT
    v_journal_id,
    jl."accountNumber",
    'IC Elimination: ' || jl."description",
    -jl."amount",
    jl."documentType",
    'ic-elim-' || ict."id",
    v_elimination_company_id,
    p_company_group_id
  FROM "intercompanyTransaction" ict
  INNER JOIN "journalLine" jl ON jl."id" = ict."targetJournalLineId"
  WHERE ict."companyGroupId" = p_company_group_id
    AND ict."status" = 'Matched'
    AND ict."targetJournalLineId" IS NOT NULL;

  -- Update IC transactions to Eliminated
  UPDATE "intercompanyTransaction"
  SET "status" = 'Eliminated',
      "eliminationJournalId" = v_journal_id,
      "updatedAt" = NOW()
  WHERE "companyGroupId" = p_company_group_id
    AND "status" = 'Matched';

  RETURN v_journal_id;
END;
$$;
```

### Migration

Single migration file: `YYYYMMDDHHMMSS_intercompany-tracking.sql`

Contains: `journalLine.intercompanyPartnerId` column, `intercompanyTransaction` table with RLS, both RPCs.

## Edge Function Modifications

### Detecting Intercompany Transactions

The key question: how does a posting function know that a customer/supplier belongs to a sibling company?

**Approach:** When posting, check if the customer or supplier has a linked company within the same `companyGroupId`. This requires a way to link customers/suppliers to companies.

**Option A (recommended):** Add a `companyId` field to `customer` and `supplier` tables that optionally links them to a sibling company. When this field is set, the posting function knows it's an IC transaction.

**Option B:** Use a lookup table `intercompanyPartner` that maps customer/supplier IDs to company IDs within the group.

### Modify `post-sales-invoice` (`packages/database/supabase/functions/post-sales-invoice/index.ts`)

When the customer is linked to a sibling company:

1. Use account **1130** (IC Receivables) instead of **1110** (Accounts Receivable) for the AR entry
2. Set `intercompanyPartnerId` on the IC journal lines
3. Insert a row in `intercompanyTransaction` with `status = 'Unmatched'`

```typescript
// Detect IC transaction
const isIntercompany = customer.companyId
  && customer.companyId !== companyId
  && customer.companyGroupId === companyGroupId;

if (isIntercompany) {
  // Use IC Receivables instead of regular AR
  journalLineInserts.push({
    accountNumber: "1130",  // IC Receivables
    intercompanyPartnerId: customer.companyId,
    // ... rest of journal line
  });

  // Create IC transaction record
  await trx.insertInto("intercompanyTransaction").values({
    companyGroupId,
    sourceCompanyId: companyId,
    targetCompanyId: customer.companyId,
    sourceJournalLineId: journalLineId,
    amount: invoiceTotal,
    currencyCode: invoice.currencyCode,
    documentType: "Invoice",
    documentId: invoice.id,
    status: "Unmatched",
  }).execute();
}
```

### Modify `post-purchase-invoice` (`packages/database/supabase/functions/post-purchase-invoice/index.ts`)

Mirror of the sales side:

1. Use account **2020** (IC Payables) instead of default AP for the payable entry
2. Set `intercompanyPartnerId` on the IC journal lines
3. Insert a row in `intercompanyTransaction` with `status = 'Unmatched'`

## Backend / Service Layer

### New File: `apps/erp/app/modules/accounting/intercompany.service.ts`

```typescript
export async function getIntercompanyTransactions(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args: { status?: string }
)

export async function runIntercompanyMatching(
  client: SupabaseClient<Database>,
  companyGroupId: string
)

export async function generateEliminations(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  userId: string
)

export async function getEliminationJournal(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  journalId: number
)

export async function getIntercompanyBalance(
  client: SupabaseClient<Database>,
  companyGroupId: string
)
// Returns a matrix of IC balances: company A owes company B $X
```

## UI

### New Routes

| Route file | URL path | Purpose |
|---|---|---|
| `routes/x+/accounting+/intercompany.tsx` | `/x/accounting/intercompany` | IC transaction list with status |
| `routes/x+/accounting+/intercompany.match.tsx` | (action route) | Trigger matching |
| `routes/x+/accounting+/intercompany.eliminate.tsx` | (action route) | Generate elimination entries |

### Sidebar

Add under "Manage" group:

```typescript
{ name: "Intercompany", to: path.to.intercompany }
```

### New Components

| Component | Location | Purpose |
|---|---|---|
| `IntercompanyTransactionTable` | `modules/accounting/ui/Intercompany/IntercompanyTransactionTable.tsx` | Table with status badges (Unmatched/Matched/Eliminated) |
| `IntercompanyBalanceMatrix` | `modules/accounting/ui/Intercompany/IntercompanyBalanceMatrix.tsx` | Grid showing who owes whom |
| `IntercompanyMatchingSummary` | `modules/accounting/ui/Intercompany/IntercompanyMatchingSummary.tsx` | Summary stats: X matched, Y unmatched, Z eliminated |

### UI Behavior

1. **Transaction list:** Shows all IC transactions with filters for status. Columns: source company, target company, amount, currency, document, status badge, matched date.

2. **"Run Matching" button:** Calls the matching RPC. Refreshes the table. Shows a toast with results ("12 transactions matched, 3 unmatched").

3. **"Generate Eliminations" button:** Only enabled when all transactions are Matched (or user confirms proceeding with unmatched). Calls the elimination RPC. Shows the resulting elimination journal.

4. **Balance matrix:** A grid where rows and columns are companies. Cell (A, B) shows how much A owes B. Diagonal is zero. Net should be zero after elimination.

## Data Flow

```
Company A posts sales invoice to Company B
    |
    v
post-sales-invoice detects IC (customer.companyId in same group)
    |
    v
Posts to 1130 (IC Receivables) instead of 1110
Sets intercompanyPartnerId = companyB.id
Creates intercompanyTransaction (status: Unmatched)
    |
    v
Company B posts purchase invoice from Company A
    |
    v
post-purchase-invoice detects IC (supplier.companyId in same group)
    |
    v
Posts to 2020 (IC Payables) instead of default AP
Sets intercompanyPartnerId = companyA.id
Creates intercompanyTransaction (status: Unmatched)
    |
    v
Finance user opens Intercompany page, clicks "Run Matching"
    |
    v
matchIntercompanyTransactions RPC:
  - Finds A's receivable and B's payable for same amount/partner
  - Updates both to status: Matched
    |
    v
Finance user clicks "Generate Eliminations"
    |
    v
generateEliminationEntries RPC:
  - Creates journal on elimination entity
  - Reverses all matched IC entries
  - Updates status: Eliminated
    |
    v
Elimination entries visible in COA when filtering to elimination entity
Consolidated view (Phase 4) nets IC accounts to zero
```

## Acceptance Criteria

- [ ] Posting functions detect IC transactions when customer/supplier is linked to a sibling company
- [ ] IC transactions use accounts 1130/2020 instead of regular AR/AP
- [ ] `intercompanyPartnerId` is set on IC journal lines
- [ ] `intercompanyTransaction` rows created on posting
- [ ] Matching algorithm correctly pairs receivables with payables
- [ ] Unmatched transactions are surfaced with clear status in the UI
- [ ] Balance matrix shows correct IC balances between companies
- [ ] Elimination journal entries are generated on the elimination entity
- [ ] Elimination entries reverse the original IC entries (debit becomes credit and vice versa)
- [ ] After elimination, IC account balances net to zero in the consolidated view
- [ ] All elimination entries are immutable (append-only journal)
- [ ] Only users with `accounting_create` permission can trigger matching/elimination
- [ ] Partial matching is supported (some matched, some unmatched)
