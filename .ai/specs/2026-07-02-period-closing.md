# Accounting Period Closing

> Status: in-progress
> Author: Claude (with Brad Barbin)
> Date: 2026-07-02
> Research notes: `.ai/research/period-closing.md`

## TLDR

Carbon already has an `accountingPeriod` table with `closedAt`/`closedBy` columns and a single close gate buried in `getOrCreateAccountingPeriod`, but no way to close a period from the UI, no soft-close stage, and several posting paths (notably manual journal entries) that never check the period at all. This spec introduces a first-class period close lifecycle — **Open → Locked → Closed** — modeled on NetSuite's period statuses and SAP's authorization-group posting intervals: *Locked* is a soft close where only accounting users can post adjustments (operational postings from receipts, shipments, and invoices are blocked), and *Closed* is a hard close enforced by a database trigger that no posting path can bypass. Periods gain explicit `fiscalYear`/`periodNumber` identity generated from `fiscalYearSettings`, closes are sequential (like NetSuite), a computed close-readiness checklist surfaces blockers (draft journals, unposted receipts, negative inventory, unmatched intercompany) before closing, and year-end stays implicit — Carbon's virtual Net Income / retained-earnings computation means no closing entries are ever posted, which is self-healing by construction (the same property SAP achieves with re-runnable balance carryforward).

## Problem Statement

There is no way to close an accounting period in Carbon. Concretely:

- A controller finishes the June close, runs the June income statement for the board — and a week later a warehouse user posts a backdated receipt into June. The statements silently change. Nothing in the product prevents this.
- The `accountingPeriod` table has `closedAt`/`closedBy` columns ([20230705033432_ledgers.sql:32-50](packages/database/supabase/migrations/20230705033432_ledgers.sql)) and `getOrCreateAccountingPeriod` refuses to post into a period where `closedAt` is set ([accounting.service.ts:517-523](apps/erp/app/modules/accounting/accounting.service.ts)) — but **nothing ever sets `closedAt`**. The gate is dead code.
- `postJournalEntry` ([accounting.service.ts:1896-1959](apps/erp/app/modules/accounting/accounting.service.ts)) validates balance but never checks the period, so manual journal entries bypass even the dead gate.
- Periods are created lazily one month at a time with no fiscal-year identity (`fiscalYear`, `periodNumber`), so there is no way to render "FY2026 · Period 6" or enforce sequential close.
- The `status` enum (`Inactive`/`Active`) tracks "which period is current," which is a different axis from open/closed and is derivable from the date anyway.

Every serious ERP treats period close as a core control: SAP gates postings per account type and user group via posting period variants (OB52), NetSuite walks a dependency-ordered close checklist ending in a hard close, D365 locks per-module per-period. Carbon needs the same control, sized for a mid-market manufacturer.

## Proposed Solution

### Lifecycle: Open → Locked → Closed

A new `periodCloseStatus` enum and `closeStatus` column on `accountingPeriod`:

| Status | Operational postings (receipts, shipments, invoices, adjustments, backflush) | Accounting postings (manual JE, depreciation, eliminations, FX) | Who can transition |
|--------|------|------|------|
| **Open** | ✅ allowed | ✅ allowed | — |
| **Locked** | ❌ blocked | ✅ allowed (requires `update: accounting`) | Lock/unlock: `update: accounting` |
| **Closed** | ❌ blocked | ❌ blocked (DB trigger backstop) | Close: `update: accounting`; Reopen: see Open Questions |

This two-stage close is the elegant core of the design. It captures the essence of NetSuite's "Lock A/R → Lock A/P → Lock All → Close" progression and SAP's interval-1 authorization group ("only the close team may post during close") with **one column and one rule**, instead of a per-subledger flag matrix. Per-subledger locks (AR/AP/Inventory independently) can be layered on later without schema churn if real customers need them.

The mapping of "operational vs accounting" posting is by journal `sourceType`: manual journal entries, `Asset Depreciation`, `Asset Disposal`, intercompany eliminations, and FX revaluation are *accounting* sources; everything driven by documents (receipt, shipment, invoice, payment, inventory adjustment, backflush) is *operational*.

### Sequential close, ordered reopen

- A period can only be **Closed** if every earlier period in the company is Closed (NetSuite rule). This guarantees an unbroken audit boundary.
- A period can only be **reopened** if every later period is Open — i.e., you unwind the boundary from the most recent close backwards, never punching a hole in the middle.
- **Locking** is not sequential — a controller may lock June for close prep while May is still being tidied.

### Fiscal-year identity and period generation

Add `fiscalYear INT` and `periodNumber INT` to `accountingPeriod`, and a `createFiscalYearPeriods` service that generates the 12 monthly periods for a fiscal year from `fiscalYearSettings.startMonth`. The existing lazy auto-create in `getOrCreateAccountingPeriod` remains as a fallback but now stamps `fiscalYear`/`periodNumber` so lazily-created and generated periods are indistinguishable.

The `Active`/`Inactive` status column is left in place but deprecated: "current period" is derivable from `startDate <= today <= endDate`, and the toggle logic in `getOrCreateAccountingPeriod` is removed once nothing reads it (verified below in Open Questions).

### Enforcement: one choke point + a database backstop

1. **Service layer (the choke point).** `getOrCreateAccountingPeriod` gains a posting-context parameter: `getOrCreateAccountingPeriod(client, companyId, date, source: "operational" | "accounting")`. It enforces the matrix above and returns the existing `{data, error}` shape. Every posting path already calls it (post-receipt, post-shipment, post-purchase-invoice, payments, backflush) or must be made to (`postJournalEntry` — the known gap; also `postDepreciationRun`, `postDisposal` in `accounting.server.ts`).
2. **Database trigger (the backstop).** A `BEFORE INSERT OR UPDATE` trigger on `journal` raises an exception when the row's `accountingPeriodId` (or the period containing `postingDate`) has `closeStatus = 'Closed'`. Edge functions, Inngest jobs with the service-role key, and any future code path all hit this regardless of whether they remembered to call the service gate. Locked-period nuance (who is posting) stays at the service layer where user identity is known; the trigger only enforces the hard invariant *nothing posts into a Closed period*.
3. **Reversal symmetry.** `reverseJournalEntry` must date the reversing entry in the *current open period*, never back into the closed source period (standard SAP/NetSuite behavior for reversals across a close boundary).

### Close-readiness checklist (computed, not persisted)

NetSuite's close checklist is a persisted task-workflow engine; that is deliberately **out of scope for v1**. Instead, a `getPeriodCloseReadiness(client, companyId, periodId)` service computes the manufacturing-relevant checks on demand and the close drawer renders them:

| Check | Severity |
|-------|----------|
| Draft journal entries with `postingDate` in the period | Blocker |
| Unposted receipts/shipments/invoices dated in the period (pending `post-transaction` queue items) | Blocker |
| Draft depreciation runs covering the period | Warning |
| Negative on-hand inventory quantities | Warning |
| Unmatched `intercompanyTransaction` rows involving this company for the period | Warning |
| Trial balance out of balance for the period (sanity check) | Blocker |

Blockers prevent Close (not Lock). Warnings require an explicit "close anyway" confirmation. This gives the NetSuite checklist's *value* (you can't close on top of half-posted work) without building a task engine.

### Year-end: implicit, no closing entries

Carbon already computes Net Income virtually (`NET_INCOME_ACCOUNT_ID`, never posted) — the NetSuite model, and the one this spec keeps. Closing period 12 of a fiscal year **is** the year-end close; retained earnings roll-forward happens at report time and is self-healing if a prior year is ever reopened and adjusted (the property SAP needs re-runnable FAGLGVTR carryforward to achieve). No "Close Income Statement" batch job (Business Central) and no closing journals. If materialized carryforward is ever needed for report performance, it can be added later without changing this model.

### Audit trail

Every transition (Lock, Unlock, Close, Reopen) is recorded via the existing audit log system (`.ai/rules/audit-log-system.md`) with user, timestamp, and prior status. `closedAt`/`closedBy` (existing columns) hold the latest close; `lockedAt`/`lockedBy` are added for symmetry. Reopen clears `closedAt`/`closedBy` (history lives in the audit log).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Status model | New `closeStatus` column (`periodCloseStatus` enum: `Open`/`Locked`/`Closed`), NOT new values on `accountingPeriodStatus` | Open/closed is a different axis from the existing Active/Inactive "current period" toggle; Postgres enums can't remove values, so overloading is irreversible. Enum uses capitalized display-friendly values per convention. |
| Soft close granularity | Single `Locked` status gating by posting source (operational vs accounting), not per-subledger AR/AP/Inventory flags | One column captures SAP's interval-1 authorization group and most of NetSuite's staged locks; per-subledger flags can be layered on later. Simplicity first. |
| Hard-close enforcement | DB trigger on `journal` + service-layer gate | Posting happens from edge functions, Inngest service-role jobs, and app services — only a trigger catches all of them. Locked semantics stay in the service layer where the user is known. |
| Year-end | Implicit (virtual retained earnings, no closing entries) | Carbon already computes Net Income virtually; matches NetSuite; self-healing on prior-year reopen. |
| Close ordering | Sequential close, reverse-sequential reopen, non-sequential lock | NetSuite rule; guarantees a contiguous closed boundary with no holes. |
| Checklist | Computed readiness checks (RPC/service), not persisted task workflow | Task engine is the expensive 20%; computed checks deliver the control value. Persisted checklists deferred. |
| Multi-tenancy | Existing `accountingPeriod` keeps its legacy single-column PK (`xid()`); no new tables in v1 | Altering the PK of a referenced table is high-risk churn for zero behavior gain; all new columns are on the existing table. No new tables ⇒ heuristic satisfied by inheritance. |
| Service shape | `lockAccountingPeriod` / `closeAccountingPeriod` / `reopenAccountingPeriod` / `getPeriodCloseReadiness` in `accounting.service.ts`, `(client, companyId, ...)` → `{data, error}`, never throw | `.ai/rules/conventions-services.md`; one module service file, no new files. |
| RLS | `accountingPeriod` UPDATE policy requires `accounting_update`; status transitions additionally validated in service (sequential rules can't be expressed in RLS cleanly) | Matches existing permission-based policy pattern. |
| Permission for close/lock | `update: "accounting"` via `requirePermissions` | Matches fiscal-year-settings and journal-posting precedent; a dedicated close permission is an Open Question. |
| Form pattern | `ValidatedForm` + zod validator + route actions with `intent` field | Matches `settings+/accounting.tsx` precedent. |
| Reversals across close boundary | Reversing entry posts to current open period | SAP/NetSuite standard; preserves closed-period immutability. |
| Backward compatibility | `getOrCreateAccountingPeriod` keeps its signature with a new optional `source` param defaulting to `"operational"` | All existing callers become safely gated by default; accounting paths opt in to the looser rule explicitly. |

## Data Model Changes

One idempotent migration (`pnpm db:migrate:new period-close-lifecycle`, randomized HHMMSS), then `pnpm run generate:types`:

```sql
-- New enum for the close lifecycle (separate axis from Active/Inactive)
DO $$ BEGIN
  CREATE TYPE "periodCloseStatus" AS ENUM ('Open', 'Locked', 'Closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "accountingPeriod"
  ADD COLUMN IF NOT EXISTS "closeStatus" "periodCloseStatus" NOT NULL DEFAULT 'Open',
  ADD COLUMN IF NOT EXISTS "fiscalYear" INTEGER,
  ADD COLUMN IF NOT EXISTS "periodNumber" INTEGER,
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "lockedBy" TEXT REFERENCES "user"("id") ON DELETE RESTRICT;

-- Backfill closeStatus from the (never-populated, but be safe) closedAt column
UPDATE "accountingPeriod" SET "closeStatus" = 'Closed'
WHERE "closedAt" IS NOT NULL AND "closeStatus" = 'Open';

-- Backfill fiscalYear/periodNumber from fiscalYearSettings.startMonth
-- (calendar math in migration; COALESCE to calendar year/month when settings missing)

CREATE UNIQUE INDEX IF NOT EXISTS "accountingPeriod_company_fy_period_idx"
  ON "accountingPeriod" ("companyId", "fiscalYear", "periodNumber");

-- Hard backstop: nothing posts into a Closed period
CREATE OR REPLACE FUNCTION check_accounting_period_open() RETURNS TRIGGER AS $$
DECLARE period_status "periodCloseStatus";
BEGIN
  SELECT "closeStatus" INTO period_status
  FROM "accountingPeriod"
  WHERE ("id" = NEW."accountingPeriodId")
     OR (NEW."accountingPeriodId" IS NULL
         AND "companyId" = NEW."companyId"
         AND NEW."postingDate" BETWEEN "startDate" AND "endDate");
  IF period_status = 'Closed' THEN
    RAISE EXCEPTION 'Accounting period is closed for posting date %', NEW."postingDate";
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "journal_check_period_open" ON "journal";
CREATE TRIGGER "journal_check_period_open"
  BEFORE INSERT OR UPDATE OF "postingDate", "accountingPeriodId" ON "journal"
  FOR EACH ROW EXECUTE FUNCTION check_accounting_period_open();
```

Notes:
- No views select from `accountingPeriod` today (verify during implementation; if any do, DROP/recreate with `SELECT *`).
- `closedAt`/`closedBy` columns are reused as-is; the existing `closedAt` check in `getOrCreateAccountingPeriod` is replaced by `closeStatus` checks.
- The trigger intentionally does **not** distinguish Locked — that requires knowing the actor, which lives in the service layer.

## API / Service Changes

All in `apps/erp/app/modules/accounting/accounting.service.ts` (+ zod in `accounting.models.ts`):

```ts
// Extended gate — all existing callers default to "operational" and become stricter
getOrCreateAccountingPeriod(client, companyId, date, source: "operational" | "accounting" = "operational")
// → { data: periodId, error } ; error when closeStatus === 'Closed',
//   or closeStatus === 'Locked' && source === 'operational'

// Lifecycle transitions (validate sequential rules, stamp lockedAt/By, closedAt/By, write audit log)
lockAccountingPeriod(client, { periodId, companyId, userId })
unlockAccountingPeriod(client, { periodId, companyId, userId })
closeAccountingPeriod(client, { periodId, companyId, userId })   // requires earlier periods Closed + no blockers
reopenAccountingPeriod(client, { periodId, companyId, userId })  // requires later periods Open

// Generation + queries
createFiscalYearPeriods(client, { companyId, fiscalYear, userId })  // 12 periods from fiscalYearSettings
getAccountingPeriods(client, companyId, { fiscalYear? })
getPeriodCloseReadiness(client, companyId, periodId)  // → { blockers: Check[], warnings: Check[] }
```

Callers to update:
- `postJournalEntry` — add the period gate (`source: "accounting"`) before setting status to Posted. **This closes the biggest existing hole.**
- `postDepreciationRun`, `postDisposal` (`accounting.server.ts`) — gate with `source: "accounting"`.
- `generateEliminations` — gate with `source: "accounting"`.
- Edge functions `post-receipt`, `post-shipment`, `post-purchase-invoice`, payment posting — already call `getOrCreateAccountingPeriod`; the default `"operational"` source makes them respect Locked with no signature change at call sites.
- `reverseJournalEntry` — if the source entry's period is Locked/Closed, date the reversal in the current open period.

Routes (new, under `apps/erp/app/routes/x+/accounting+/`):
- `periods.tsx` — loader (`view: "accounting"`) lists periods grouped by fiscal year; action (`update: "accounting"`) with `intent`: `lock` | `unlock` | `close` | `reopen` | `generate`.
- `periods.$periodId.close.tsx` — Drawer child route (per Drawer-overlay convention) showing `getPeriodCloseReadiness` results with confirm.

## UI Changes

- **Periods page** (`/x/accounting/periods`): table grouped by fiscal year — period number, name ("FY2026 · P6 (Jun)"), date range, status badge (Open gray / Locked amber / Closed green, plain counts, no parenthesized numbers), closed-by/at. Row actions: Lock, Unlock, Close…, Reopen (visibility driven by status + sequential rules). "Generate FY{next}" button when the next fiscal year has no periods. Added to the accounting sidebar next to Fiscal Year settings.
- **Close drawer**: readiness checklist with blockers (red, disable Close) and warnings (amber, require confirmation checkbox), then Close button. Follows existing Drawer-overlay detail-view convention.
- **Journal entry form**: v1 relies on the server-side gate — posting into a Locked/Closed period fails with a clear flash error from `postJournalEntry`. An inline pre-submit warning on the posting-date field is deferred (see plan's non-goals).
- **Flash messages** on all transitions per `.ai/rules/flash-system.md`.

## Acceptance Criteria

- [ ] Controller with `accounting_update` can generate FY periods, and lock, close, and reopen periods from `/x/accounting/periods`; each transition flashes success and appears in the audit log with user + timestamp.
- [ ] Closing period N fails with a clear error while period N−1 is not Closed; reopening period N fails while period N+1 is Closed.
- [ ] With June **Locked**: posting a receipt dated June 15 via the normal receipt flow fails with "period is locked"; posting a manual journal entry dated June 15 as an accounting user succeeds.
- [ ] With June **Closed**: `postJournalEntry`, post-receipt, post-shipment, post-purchase-invoice, depreciation run, and disposal all fail with a period-closed error; a direct SQL `INSERT` into `journal` with a June posting date (service-role) is rejected by the trigger.
- [ ] Close drawer shows a blocker when a draft journal entry dated in the period exists, and Close is disabled until it is posted or re-dated; warnings (negative inventory, unmatched IC) allow close after explicit confirmation.
- [ ] Reversing a journal entry whose period is Closed creates the reversing entry dated in the current open period, and both entries reference each other.
- [ ] Trial balance / balance sheet / income statement for a closed period return identical numbers before and after unrelated postings in later periods.
- [ ] Existing lazy period auto-creation still works for a date with no period, and the created period carries correct `fiscalYear`/`periodNumber`.
- [ ] `pnpm run generate:types` then `pnpm run typecheck` and `pnpm run lint` pass; migration applies idempotently twice in a row.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| In-flight `post-transaction` Inngest jobs reference a period that closes mid-flight → job fails against trigger | Med | Jobs already retry (3x); error message is explicit; readiness blocker "pending posting-queue items" prevents closing on top of a hot queue |
| Xero sync writes inbound transactions dated in a Locked/Closed period → sync errors or silent divergence | High | Open Question 4; minimum: sync handler catches the period error and surfaces it in the integration error queue rather than looping |
| Trigger fires on every journal insert → hot-path overhead | Low | Single indexed PK/date-range lookup per posted journal; journals are not high-frequency inserts |
| Backfilled `fiscalYear`/`periodNumber` wrong for companies that changed `startMonth` after old periods were created | Med | Backfill from period `startDate` month arithmetic, not from current settings alone; flag mismatches in migration NOTICE |
| Users locked out of legitimate late adjustments (auditors, tax) | Med | Reopen is supported, permission-gated, and fully audited; virtual year-end means prior-year reopen self-heals retained earnings |
| Deprecating `Active`/`Inactive` breaks an unnoticed reader of `status = 'Active'` | Med | Phase the removal: keep the toggle in v1, grep + remove in a follow-up once verified unused |

## Open Questions

> All questions resolved 2026-07-02 (user delegated to best judgment).

- [x] **Locked semantics** — **Answer:** Source-based locking in v1 (operational blocked, accounting allowed with `update: accounting`). Per-subledger AR/AP/Inventory locks deferred; the single `closeStatus` column layers them on later without schema churn. Simplicity first.
- [x] **Reopen permission** — **Answer:** Reopen requires `delete: "accounting"` — the de-facto module-admin tier. Adding a dedicated permission would touch the RBAC system (explicitly ask-first territory) for marginal v1 gain. Lock/unlock/close stay at `update: "accounting"`. Every reopen is audit-logged.
- [x] **Adjustment period** — **Answer:** Deferred to v2. `periodNumber` schema and the unique index already accommodate a period 13; nothing in v1 hard-codes 12.
- [x] **Xero sync vs closed periods** — **Answer:** Reject (option a). Inbound sync writes into Locked/Closed periods fail with the period error and surface through the existing sync error handling — no silent re-dating, no special bypass. Matches the "reject and surface" posture of the trigger backstop.
- [x] **Group/consolidation ordering** — **Answer:** Warning, not a block. `getPeriodCloseReadiness` warns when the company belongs to a group and unmatched intercompany transactions exist for the period. Close remains strictly per-company in v1.
- [x] **`Active`/`Inactive` deprecation** — **Answer:** Keep the toggle untouched in v1 (minimal impact); removal is a follow-up after a grep audit confirms nothing reads `status = 'Active'`.
- [x] **Queue behavior on closed-period failure** — **Answer:** Fail loudly through the existing Inngest retry/error path — no new dead-letter UI in v1. The readiness blocker for pending posting-queue items prevents most occurrences by construction.

## Changelog

- 2026-07-02: Created — grounded in codebase exploration (existing `accountingPeriod`/`closedAt` gate, posting entry-point inventory) and ERP research (SAP OB52/AFC, NetSuite period close checklist, D365/BC/Odoo lock models); see `.ai/research/period-closing.md`.
- 2026-07-02: All open questions resolved (user delegated to best judgment); status → in-progress. Key calls: source-based Locked in v1, reopen gated by `delete: accounting`, adjustment period deferred, sync writes rejected into non-open periods, group ordering as warning, Active/Inactive removal deferred, no dead-letter UI.
- 2026-07-02: Implementation plan written at `.ai/plans/2026-07-02-period-closing.md`; migration drafted at `packages/database/supabase/migrations/20260702044133_period-close-lifecycle.sql` (not yet applied). Recon finding folded in: edge functions use a separate period helper (`packages/database/supabase/functions/shared/get-accounting-period.ts`) with no close check — added as a mandatory gate point; depreciation/disposal are gated at their routes; eliminations post via DB RPC and are covered by the trigger backstop. Inline journal-form warning deferred to v2.
