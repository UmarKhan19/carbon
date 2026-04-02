# Journal Entries — Implementation Plan (V1)

## Overview

Add a Manual Journal Entries submodule under Accounting > Manage. Users create journal entries with debit/credit lines that must balance to zero. On posting, lines are written to the existing immutable `journal`/`journalLine` tables. Entries support dimension tagging and reversals.

## Design Decisions

- **Separate tables**: `journalEntry` (header) + `journalEntryLine` (lines) are draft-editable. Posting writes to the existing `journal`/`journalLine` GL tables and locks the entry.
- **Company from session**: The logged-in company is used automatically — no subsidiary picker in the UI.
- **Document type**: Optional Postgres enum on the header for categorization/filtering. Not required.
- **Posting = immutable**: Once posted, the journal entry cannot be edited. Changes require a reversing entry + new JE.
- **Dimensions**: Lines can be tagged with accounting dimensions via the existing `journalLineDimension` pattern (applied when posting to GL).

## Scope

### V1 (this plan)
- Journal entry CRUD (header + lines)
- Debit/credit balance enforcement (UI + DB check constraint on post)
- Optional document type enum
- Dimension tagging per line
- Status workflow: Draft -> Posted
- Posting action (writes to `journal`/`journalLine`)
- One-click reversal (creates new JE with flipped amounts in next open period)
- List view with filtering/sorting
- Sidebar navigation entry

### V2 (future)
- Recurring journal entries / templates
- Approval workflows
- Allocation support (split lines across dimensions)
- Excel copy/paste import
- Auto-balance button

---

## Implementation Steps

### Step 1: Database Migration

Create migration file in `packages/database/supabase/migrations/`.

#### Enum

```sql
CREATE TYPE "journalEntryType" AS ENUM (
  'Accrual',
  'Correction',
  'Reclassification',
  'Depreciation',
  'Other'
);

CREATE TYPE "journalEntryStatus" AS ENUM (
  'Draft',
  'Posted'
);
```

#### Tables

```sql
CREATE TABLE "journalEntry" (
  "id" TEXT NOT NULL DEFAULT id('je'),
  "journalEntryId" TEXT NOT NULL,          -- human-readable sequence number (JE-0001)
  "companyId" TEXT NOT NULL REFERENCES "company"("id"),
  "companyGroupId" TEXT NOT NULL,
  "description" TEXT,
  "postingDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  "accountingPeriodId" TEXT REFERENCES "accountingPeriod"("id"),
  "entryType" "journalEntryType",          -- optional categorization
  "status" "journalEntryStatus" NOT NULL DEFAULT 'Draft',
  "journalId" INTEGER REFERENCES "journal"("id"),  -- set on post, links to GL
  "reversalOfId" TEXT REFERENCES "journalEntry"("id"),  -- if this is a reversal
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "journalEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journalEntry_journalEntryId_companyId_key" UNIQUE ("journalEntryId", "companyId")
);

CREATE TABLE "journalEntryLine" (
  "id" TEXT NOT NULL DEFAULT id('jel'),
  "journalEntryId" TEXT NOT NULL REFERENCES "journalEntry"("id") ON DELETE CASCADE,
  "accountNumber" TEXT NOT NULL,
  "companyGroupId" TEXT NOT NULL,
  "description" TEXT,
  "debit" NUMERIC(19,4) NOT NULL DEFAULT 0,
  "credit" NUMERIC(19,4) NOT NULL DEFAULT 0,
  "dimensionValues" JSONB,                 -- {dimensionId: valueId} for draft storage
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "journalEntryLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journalEntryLine_accountNumber_fkey"
    FOREIGN KEY ("accountNumber", "companyGroupId")
    REFERENCES "account"("number", "companyGroupId"),
  CONSTRAINT "journalEntryLine_debit_credit_check"
    CHECK ("debit" >= 0 AND "credit" >= 0),
  CONSTRAINT "journalEntryLine_debit_or_credit_check"
    CHECK (NOT ("debit" > 0 AND "credit" > 0))  -- cannot have both on one line
);
```

#### Indexes

```sql
CREATE INDEX "journalEntry_companyId_idx" ON "journalEntry" ("companyId");
CREATE INDEX "journalEntry_status_idx" ON "journalEntry" ("status", "companyId");
CREATE INDEX "journalEntry_postingDate_idx" ON "journalEntry" ("postingDate", "companyId");
CREATE INDEX "journalEntryLine_journalEntryId_idx" ON "journalEntryLine" ("journalEntryId");
```

#### RLS Policies

Follow existing pattern — SELECT/INSERT/UPDATE/DELETE gated on `accounting_view`, `accounting_create`, `accounting_update`, `accounting_delete` permissions. `journalEntryLine` inherits access through its parent.

#### View

```sql
CREATE OR REPLACE VIEW "journalEntries" AS
  SELECT
    je.*,
    COALESCE(SUM(jel."debit"), 0) AS "totalDebits",
    COALESCE(SUM(jel."credit"), 0) AS "totalCredits",
    COUNT(jel."id") AS "lineCount"
  FROM "journalEntry" je
  LEFT JOIN "journalEntryLine" jel ON jel."journalEntryId" = je."id"
  GROUP BY je."id";
```

---

### Step 2: Models & Validators

Add to `apps/erp/app/modules/accounting/accounting.models.ts`:

```typescript
export const journalEntryTypes = [
  "Accrual",
  "Correction",
  "Reclassification",
  "Depreciation",
  "Other"
] as const;

export const journalEntryStatuses = [
  "Draft",
  "Posted"
] as const;

export const journalEntryValidator = z.object({
  id: zfd.text(z.string().optional()),
  description: z.string().optional(),
  postingDate: z.string().min(1, { message: "Posting date is required" }),
  entryType: z.enum(journalEntryTypes).optional(),
});

export const journalEntryLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  journalEntryId: zfd.text(z.string().optional()),
  accountNumber: z.string().min(1, { message: "Account is required" }),
  description: z.string().optional(),
  debit: zfd.numeric(z.number().min(0)),
  credit: zfd.numeric(z.number().min(0)),
}).refine(
  (data) => !(data.debit > 0 && data.credit > 0),
  { message: "A line cannot have both debit and credit", path: ["credit"] }
).refine(
  (data) => data.debit > 0 || data.credit > 0,
  { message: "Either debit or credit is required", path: ["debit"] }
);
```

---

### Step 3: Service Functions

Add to `apps/erp/app/modules/accounting/accounting.service.ts`:

```
getJournalEntries(client, companyId, filters)     -- list from "journalEntries" view
getJournalEntry(client, journalEntryId)            -- single with lines
upsertJournalEntry(client, data)                   -- create or update header (Draft only)
deleteJournalEntry(client, journalEntryId)         -- delete Draft only
upsertJournalEntryLine(client, data)               -- create or update line
deleteJournalEntryLine(client, lineId)             -- delete line
postJournalEntry(client, journalEntryId, userId)   -- validate balance, write to journal/journalLine, set status=Posted
reverseJournalEntry(client, journalEntryId, userId) -- create new JE with flipped amounts
```

#### Post Logic (pseudocode)

```
1. Fetch journalEntry + lines
2. Assert status === 'Draft'
3. Assert SUM(debit) === SUM(credit) and > 0
4. Assert posting period is open
5. Insert into "journal" (header) -> get journalId
6. For each line:
   a. Insert into "journalLine" with amount = debit - credit
   b. Insert into "journalLineDimension" for each dimension value
7. Update journalEntry: status='Posted', journalId, postedAt, postedBy
```

#### Reverse Logic (pseudocode)

```
1. Fetch original posted journalEntry + lines
2. Create new journalEntry with reversalOfId = original.id, next open period
3. Copy lines with debit/credit swapped
4. Return new Draft JE (user can review and post)
```

---

### Step 4: Types

Add to `apps/erp/app/modules/accounting/types.ts`:

```typescript
export type JournalEntry = ...;       // from getJournalEntry return
export type JournalEntryListItem = ...; // from getJournalEntries return  
export type JournalEntryLine = ...;   // line type
```

---

### Step 5: Path Definitions

In `apps/erp/app/utils/path.ts`, the path `accountingJournals` already exists. Add:

```typescript
journalEntry: (id: string) => `${x}/accounting/journals/${id}`,
newJournalEntry: `${x}/accounting/journals/new`,
deleteJournalEntry: (id: string) => `${x}/accounting/journals/delete/${id}`,
```

---

### Step 6: Routes

Create routes in `apps/erp/app/routes/x+/accounting+/`:

| File | Purpose |
|------|---------|
| `journals.tsx` | List view — loads journalEntries with filters, renders table + `<Outlet />` |
| `journals.new.tsx` | Create form — drawer/modal with header fields, redirects to detail on save |
| `journals.$journalEntryId.tsx` | Detail view — header + line list + summary (debit/credit totals) |
| `journals.$journalEntryId.new.tsx` | Add line — action route for creating a line |
| `journals.$journalEntryId.$lineId.tsx` | Edit line — form for updating a line |
| `journals.$journalEntryId.$lineId.delete.tsx` | Delete line — action route |
| `journals.$journalEntryId.post.tsx` | Post action — validates balance, writes to GL |
| `journals.$journalEntryId.reverse.tsx` | Reverse action — creates reversed copy |
| `journals.$journalEntryId.delete.tsx` | Delete draft — only for Draft status |

---

### Step 7: UI Components

Create in `apps/erp/app/modules/accounting/ui/JournalEntries/`:

| Component | Description |
|-----------|-------------|
| `JournalEntryTable.tsx` | List table with columns: ID, date, description, type, status, total, line count. Filter by status. |
| `JournalEntryForm.tsx` | Header form (drawer): posting date, description, entry type. Used for new + edit. |
| `JournalEntryDetail.tsx` | Detail view: header info + line items list + debit/credit summary bar |
| `JournalEntryLineForm.tsx` | Line form (drawer/modal): account picker, debit or credit amount, description, dimension selectors |
| `JournalEntrySummary.tsx` | Footer bar showing total debits, total credits, difference. Visual warning when unbalanced. |
| `index.ts` | Barrel export |

**Key UX details:**
- Summary bar always visible showing `Total Debits | Total Credits | Difference`
- Difference highlighted red when non-zero, green when balanced
- Post button disabled when unbalanced or no lines
- Account picker filtered to non-group accounts in the company group
- Debit/credit fields: when user enters debit, credit clears (and vice versa)
- Posted entries show read-only view with "Reverse" action button
- Line form includes dimension selectors for each active dimension

---

### Step 8: Sidebar Navigation

In `useAccountingSubmodules.tsx`, uncomment/add the Journals entry in the Manage group:

```typescript
{
  name: "Journal Entries",
  to: path.to.accountingJournals,
  role: "employee",
  icon: <LuBookOpen />
}
```

---

### Step 9: Update Exports

In `apps/erp/app/modules/accounting/index.ts`, export new validators, service functions, and types.

---

## File Change Summary

| Area | Files |
|------|-------|
| **Migration** | `packages/database/supabase/migrations/YYYYMMDD_journal-entries.sql` (1 new) |
| **Models** | `accounting.models.ts` (modify) |
| **Service** | `accounting.service.ts` (modify) |
| **Types** | `types.ts` (modify) |
| **Paths** | `path.ts` (modify) |
| **Routes** | `routes/x+/accounting+/journals*.tsx` (9 new) |
| **UI** | `modules/accounting/ui/JournalEntries/` (6 new) |
| **Nav** | `useAccountingSubmodules.tsx` (modify) |
| **Exports** | `index.ts` (modify) |
| **DB Types** | `packages/database/src/types.ts` (regenerated after migration) |

## Open Questions for V2

- Recurring JE templates and scheduling
- Approval workflow integration (extend existing `approvalRequest` system)
- Allocation rules (split one line across dimensions/subsidiaries)
- Excel paste import for bulk line entry
- Auto-balance button (add clearing line automatically)
- Period-close checklist integration
