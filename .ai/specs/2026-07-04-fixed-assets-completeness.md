# Fixed Assets Completeness — Disposal Proceeds, Impairment, CIP, Components

> Status: in-progress
> Author: Claude (readiness remediation, GAP-4 remainder)
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1041
> Readiness finding: `.ai/specs/2026-07-03-public-company-readiness.md` §GAP-4 (Phase 2 slice)
> Related: `.ai/specs/2026-07-04-multi-book.md` (book-specific depreciation), close-automation spec (scheduled depreciation — GAP-4.1, **not** this spec), `.ai/specs/2026-07-02-period-closing.md` (posting matrix)

## TLDR

The fixed-asset subledger acquires, depreciates, and scraps — but cannot book a
gain on sale (docs admit "no proceeds-based gain calculation"), impair
(`writeDownAccountId` is a dead FK), accumulate construction costs (no CIP), or
componentize (IAS 16 prerequisite for IFRS books). This spec adds four
capabilities to `modules/accounting`: (1) disposal with proceeds — full or partial
— posting gain/loss = proceeds − NBV to the class's `disposalAccountId`, linked to
a sales invoice or direct cash proceeds; (2) an impairment document (asset or
class scope) posting Dr `writeDownAccountId` / Cr accumulated depreciation with an
`accumulatedImpairment` tracking column, re-basing future depreciation; (3) CIP
classes accumulating costs from Fixed Asset PO lines and job costs, capitalized
into a depreciating class via a transfer document; (4) parent/child component
assets with independent lives/methods, plus mid-life class transfers. All postings
obey the period-close matrix and posted-journal immutability.

## Problem Statement

Verified against `20260524143827_fixed-assets.sql`, `accounting.server.ts`
(`postDisposal` L37), `post-sales-invoice/index.ts` (L578–800), and
`docs/content/docs/reference/fixed-assets.mdx`:

1. **Disposal ignores proceeds.** `postDisposal()` posts Dr accumulated
   depreciation / Dr `writeOffAccountId` (NBV) / Cr asset at cost. The
   sales-invoice path books proceeds as plain *revenue* and NBV to *write-off* —
   gross, never netted. `fixedAssetDisposal.saleProceeds`/`gainLoss` columns exist
   but no gain is ever computed against proceeds; `disposalAccountId` (NOT NULL on
   every class) has **zero writers**. Cost 10,000, accum dep 4,000, sold 7,500
   shows 7,500 revenue + 6,000 expense instead of a 1,500 gain. No partial disposal.
2. **No impairment.** `writeDownAccountId` is required on every class and never
   referenced by any posting path; ASC 360/IAS 36 write-downs become manual JEs
   the subledger never learns about — NBV overstated, over-depreciation thereafter.
3. **No CIP.** Fixed Asset PO lines post straight to the class asset account and
   depreciation can start before in-service; job costs (self-constructed machinery
   — Carbon's own customer base) can't reach an asset at all. No CIP aging.
4. **No components.** No parent/child concept; IAS 16.43 componentization is a
   prerequisite for IFRS books via the multi-book spec. No mid-life class transfer
   either (wrong-class fixes mean dispose + re-create, destroying history).

## Proposed Solution

### 1. Disposal with proceeds (full and partial)

Extend the dispose flow (`$fixedAssetId.dispose` → `postDisposal()`) with proceeds:

- **Proceeds source** — one of: (a) a `salesInvoiceLine` of type `'Fixed Asset'`
  (link exists via `salesInvoiceLine.assetId`); (b) direct proceeds with a
  user-selected debit account (cash/clearing) for sales outside the invoicing flow.
- **Journal** (`sourceType: 'Asset Disposal'`): Dr accumulated depreciation
  (incl. accumulated impairment), Dr proceeds account (AR via invoice posting, or
  the selected cash account), Cr asset at cost, and the balancing line to the
  class's **`disposalAccountId`**: gain (credit) or loss (debit) = proceeds − NBV.
  The `post-sales-invoice` edge function's Fixed Asset branch is rewritten to this
  pattern (proceeds stop hitting revenue; NBV stops hitting write-off).
  `writeOffAccountId` remains the zero-proceeds (scrapping) target — unchanged.
- **Partial disposal**: the user disposes a fraction, entered as quantity
  (e.g. 2 of 5 identical units) or value fraction; both resolve to
  `disposalFraction` (0 < f ≤ 1). Disposed cost = cost × f; disposed accumulated
  depreciation/impairment = accumulated × f (pro-rata). Asset stays `Active` with
  reduced cost/accumulated balances; `fixedAssetDisposal` records the fraction and
  the disposed slices. `f = 1` is today's full disposal.

### 2. Impairment

New `fixedAssetImpairment` document, Draft → Posted:

- **Scope**: single asset, or a class (one header, one line per Active asset in the
  class — each line gets its own recoverable amount, prefilled with NBV).
- **Input**: recoverable amount per asset. Loss = max(0, NBV − recoverable amount)
  where NBV = acquisitionCost − accumulatedDepreciation − accumulatedImpairment.
- **Posting** (new `journalEntrySourceType` value `'Asset Impairment'`):
  Dr class `writeDownAccountId` / Cr class `accumulatedDepreciationAccountId`.
  **Contra treatment, not a new account column**: the credit lands in the existing
  accumulated-depreciation account, while a new `fixedAsset.accumulatedImpairment`
  column tracks the impairment slice separately for the register, disposal
  clearing, and the IAS 36 reversal question later (multi-book adjustment books
  need the split; the GL does not need a seventh NOT NULL account FK on every
  class, which would force a breaking backfill for all existing classes).
- **Re-basing**: after posting, future depreciation = (recoverable amount −
  residual) over remaining useful life. `buildDepreciationLines()` already
  computes from NBV-style inputs; it subtracts `accumulatedImpairment` in the NBV
  term. Reversals (IAS 36) are **out of scope** until the multi-book adjustment
  books exist — same staging as LCNRV reversals in GAP-3.

### 3. CIP — construction in progress

- **CIP class flag**: `fixedAssetClass.isConstructionInProgress BOOLEAN` — assets
  in a CIP class never enter depreciation runs, and their status uses a new enum
  value `'Under Construction'` (between Draft and Active). Seed one "Construction
  in Progress" class per company group (asset account = CIP; depreciation accounts
  point at CIP too — required by NOT NULL but never posted).
- **Cost accumulation** — new `fixedAssetCipCost` ledger rows, two sources:
  1. **PO lines**: a Fixed Asset PO line pointing at a CIP asset posts Dr CIP
     asset account (existing acquisition path, unchanged accounts) and appends a
     `fixedAssetCipCost` row (source `'Purchase Invoice'`, document line FK).
  2. **Job costs**: a job (or selected job cost slice) is attached to a CIP asset;
     on attachment the accumulated job cost posts Dr CIP asset account / Cr WIP
     (`postingGroupInventory.workInProgressAccount`) and appends a row (source
     `'Job'`). Timing of the WIP credit is an open question below.
- **Capitalization** = a `fixedAssetTransfer` of type `'Capitalization'`: pick
  target class + in-service date; posts Dr target class asset account / Cr CIP
  asset account at accumulated cost; sets `acquisitionCost`, `acquisitionDate`,
  `depreciationStartDate` (= in-service date), status → `Active`. Depreciation
  begins with the next run (scheduling itself: close-automation spec).
- **CIP aging report**: CIP assets with accumulated cost bucketed by age of first
  cost (0–90/91–180/181–365/365+ days) — the auditor's stale-CIP question.

### 4. Component assets and class transfers

- **Components**: `fixedAsset.parentFixedAssetId` self-FK (one level; a component
  cannot itself have children — trigger-enforced). Components are ordinary assets
  with their own class, method, life, and cost — depreciation/disposal/impairment
  work per component unchanged; the parent may carry residual cost (IAS 16.46
  "remainder"). Register UI rolls children up under the parent. Book-specific
  lives per component are the multi-book spec's layer
  (`.ai/specs/2026-07-04-multi-book.md`): componentization here is the structural
  prerequisite; per-book depreciation parameters attach to components there.
- **Class transfer** (type `'Reclassification'` on the same `fixedAssetTransfer`
  table): Dr new / Cr old asset account at cost, Dr old / Cr new accumulated
  depreciation account at accumulated amounts (skip lines where accounts match);
  new `journalEntrySourceType` `'Asset Transfer'`. Method/life do **not** change
  on transfer (that is an estimate change, edited on the asset directly).

### 5. Period close and immutability

Every posting above goes through the existing journal insert path and inherits
the period-close posting matrix (`20260702044133`) and posted-journal immutability
— no special cases. Posting actions resolve `accountingPeriodId` from the document
date and fail with the standard closed-period error; posted documents are
immutable, corrections are reversing documents. Scheduled depreciation proposals
and the close-readiness depreciation check are the **close-automation spec's**
scope — referenced here only so `Under Construction` assets are excluded from it.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Gain/loss account | Net single line to class `disposalAccountId` (gain credit / loss debit) | Column is NOT NULL + seeded + unwritten — it was built for exactly this; NetSuite/BC both post net gain-loss, not gross revenue+expense |
| 2 | Sales-invoice disposal path | Rewrite `post-sales-invoice` Fixed Asset branch to gain/loss pattern; proceeds stop posting to revenue | Revenue overstatement is a GAAP error (ASC 610-20: derecognition gain, not revenue); coordinated-PR posting change per the readiness spec's decision 15 |
| 3 | Partial disposal representation | Single `disposalFraction` + frozen disposed-cost/accum snapshot columns on `fixedAssetDisposal` | Quantity and value entry both collapse to a fraction; snapshots make the disposal row self-auditing after the asset's balances shrink |
| 4 | Impairment credit side | Contra within existing accumulated-depreciation account + new `accumulatedImpairment` tracking column | A new NOT NULL account FK breaks every existing class (backfill + form churn); subledger column preserves the impairment split for register/disposal/IAS 36 reversals; BC's "Write-Down" posting type uses the same collapsed-contra pattern |
| 5 | Impairment reversals | Out of scope until multi-book adjustment books | US GAAP forbids reversal; IAS 36 requires it — inherently book-specific, same staging as GAP-3 LCNRV |
| 6 | CIP modeling | Class-level flag + `'Under Construction'` status + cost ledger, not a separate CIP module | Reuses acquisition paths already keyed to `fixedAssetClass` accounts; SAP AuC / BC "CIP class" precedent |
| 7 | Capitalization & reclass | One `fixedAssetTransfer` table, `type IN ('Capitalization','Reclassification')` | Same shape (from/to class, journal, date); two tables would duplicate posting + RLS + UI |
| 8 | Component depth | One level (parent → components), trigger-enforced | IAS 16 needs parts, not trees; deep hierarchies wreck register rollups and disposal math for no auditor benefit |
| 9 | Multi-tenancy heuristic | New tables: `companyId`, composite PK `("id","companyId")`, `id('prefix')`, audit columns | Repo convention (`packages/database/AGENTS.md`); existing fixed-asset tables predate it (xid, single PK) — new tables follow current convention; FKs still target `fixedAsset("id")` |
| 10 | Service shape | New functions in `accounting.service.ts` / posting transactions in `accounting.server.ts`, `(client, args)` → `{data,error}` | One service file per module; disposal/depreciation posting already lives there |
| 11 | RLS coverage | Four policies per new table, `get_companies_with_employee_permission('accounting_*')` | Matches every existing fixed-asset table |
| 12 | Permission scoping | `requirePermissions` with `accounting_view/create/update/delete`; posting = `create`, like dispose today | No new permission actions — readiness spec decision 14 |
| 13 | Form pattern | `ValidatedForm` + zod validators in `accounting.models.ts` + route actions under `x+/fixed-asset+` and `x+/impairment+` | Existing `FixedAssetDisposalForm`/route precedent |
| 14 | Module layout | All in `modules/accounting` (models/service/server/ui), barrel exports | Fixed assets already live there |
| 15 | Backward compatibility | Additive schema only; behavior changes are the two posting rewrites (dispose, post-sales-invoice), shipped as coordinated PRs | No FROZEN surface touched; existing disposals/journals untouched (new columns nullable/defaulted) |

## Data Model Changes

```sql
-- Enums (separate pre-migration file, per ADD VALUE transaction rule)
ALTER TYPE "fixedAssetStatus" ADD VALUE IF NOT EXISTS 'Under Construction';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Impairment';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Transfer';

-- fixedAsset: components + impairment tracking
ALTER TABLE "fixedAsset"
  ADD COLUMN "parentFixedAssetId" TEXT REFERENCES "fixedAsset"("id") ON DELETE SET NULL,
  ADD COLUMN "accumulatedImpairment" NUMERIC NOT NULL DEFAULT 0;
CREATE INDEX "fixedAsset_parentFixedAssetId_idx" ON "fixedAsset" ("parentFixedAssetId");
-- trigger: reject parentFixedAssetId whose target itself has a parent (depth 1)

-- fixedAssetClass: CIP flag
ALTER TABLE "fixedAssetClass"
  ADD COLUMN "isConstructionInProgress" BOOLEAN NOT NULL DEFAULT FALSE;

-- fixedAssetDisposal: proceeds linkage + partial disposal (additive)
ALTER TABLE "fixedAssetDisposal"
  ADD COLUMN "salesInvoiceLineId" TEXT REFERENCES "salesInvoiceLine"("id") ON DELETE SET NULL,
  ADD COLUMN "proceedsAccountId" TEXT REFERENCES "account"("id"),
  ADD COLUMN "disposalFraction" NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN "disposedCost" NUMERIC,                    -- snapshot: cost × fraction
  ADD COLUMN "disposedAccumulatedDepreciation" NUMERIC, -- snapshot at posting
  ADD COLUMN "disposedAccumulatedImpairment" NUMERIC;

-- Impairment document (header + lines). Audit columns = createdBy/createdAt/
-- updatedBy/updatedAt with REFERENCES "user"("id"), as in the template.
CREATE TABLE "fixedAssetImpairment" (
    "id" TEXT NOT NULL DEFAULT id('faim'),
    "companyId" TEXT NOT NULL,
    "impairmentId" TEXT NOT NULL,               -- readable, sequence-backed
    "scope" TEXT NOT NULL CHECK ("scope" IN ('Asset', 'Class')),
    "fixedAssetClassId" TEXT REFERENCES "fixedAssetClass"("id") ON DELETE RESTRICT,
    "testDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft' CHECK ("status" IN ('Draft', 'Posted')),
    "postedAt" TIMESTAMP WITH TIME ZONE,
    "postedBy" TEXT REFERENCES "user"("id"),
    -- audit columns + "customFields" JSONB
    CONSTRAINT "fixedAssetImpairment_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "fixedAssetImpairment_impairmentId_companyId_key" UNIQUE ("impairmentId", "companyId"),
    CONSTRAINT "fixedAssetImpairment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "fixedAssetImpairmentLine" (
    "id" TEXT NOT NULL DEFAULT id('fail'),
    "companyId" TEXT NOT NULL,
    "impairmentId" TEXT NOT NULL,               -- FK → fixedAssetImpairment(id)
    "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
    "netBookValue" NUMERIC NOT NULL,            -- snapshot at posting
    "recoverableAmount" NUMERIC NOT NULL,
    "impairmentLoss" NUMERIC NOT NULL,          -- max(0, NBV − recoverable)
    "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
    -- audit columns
    CONSTRAINT "fixedAssetImpairmentLine_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "fixedAssetImpairmentLine_asset_key" UNIQUE ("impairmentId", "fixedAssetId")
);

-- CIP cost ledger (append-only)
CREATE TABLE "fixedAssetCipCost" (
    "id" TEXT NOT NULL DEFAULT id('facc'),
    "companyId" TEXT NOT NULL,
    "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
    "sourceType" TEXT NOT NULL CHECK ("sourceType" IN ('Purchase Invoice', 'Receipt', 'Job', 'Manual')),
    "sourceDocumentId" TEXT,
    "sourceDocumentLineId" TEXT,
    "jobId" TEXT REFERENCES "job"("id") ON DELETE SET NULL,
    "amount" NUMERIC NOT NULL,
    "costDate" DATE NOT NULL,
    "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
    -- audit columns
    CONSTRAINT "fixedAssetCipCost_pkey" PRIMARY KEY ("id", "companyId")
);
CREATE INDEX "fixedAssetCipCost_fixedAssetId_idx" ON "fixedAssetCipCost" ("fixedAssetId");

-- Capitalization + reclassification
CREATE TABLE "fixedAssetTransfer" (
    "id" TEXT NOT NULL DEFAULT id('fatr'),
    "companyId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,                 -- readable, sequence-backed
    "type" TEXT NOT NULL CHECK ("type" IN ('Capitalization', 'Reclassification')),
    "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
    "fromClassId" TEXT NOT NULL REFERENCES "fixedAssetClass"("id") ON DELETE RESTRICT,
    "toClassId" TEXT NOT NULL REFERENCES "fixedAssetClass"("id") ON DELETE RESTRICT,
    "transferDate" DATE NOT NULL,
    "inServiceDate" DATE,                       -- Capitalization only
    "transferredCost" NUMERIC NOT NULL,
    "transferredAccumulatedDepreciation" NUMERIC NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft' CHECK ("status" IN ('Draft', 'Posted')),
    "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
    "postedAt" TIMESTAMP WITH TIME ZONE,
    "postedBy" TEXT REFERENCES "user"("id"),
    -- audit columns
    CONSTRAINT "fixedAssetTransfer_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "fixedAssetTransfer_transferId_companyId_key" UNIQUE ("transferId", "companyId")
);

-- RLS: all four tables get the standard four policies
-- (SELECT accounting_view; INSERT accounting_create; UPDATE accounting_update;
--  DELETE accounting_delete), companyId = ANY(get_companies_with_employee_permission(...)::text[]).
-- Sequences: seed "fixedAssetImpairment" and "fixedAssetTransfer" rows in "sequence".
-- Seed: one 'Construction in Progress' class per company group (isConstructionInProgress = true).
```

## API / Service Changes

- `accounting.models.ts`: extend `fixedAssetDisposalValidator` (proceeds source,
  `salesInvoiceLineId` | `proceedsAccountId` + amount, quantity/fraction); new
  `fixedAssetImpairmentValidator`, `fixedAssetTransferValidator`; status arrays
  gain `'Under Construction'`.
- `accounting.service.ts`: CRUD for impairments, transfers, CIP costs;
  `getCipAging(client, companyId)`; `getFixedAssetComponents`; class list flags CIP.
- `accounting.server.ts` (Kysely transactions): `postDisposal()` gains proceeds +
  fraction handling (gain/loss line to `disposalAccountId`); new
  `postImpairment()`, `postTransfer()`, `attachJobCostToCip()`.
- `accounting.utils.ts`: `buildDepreciationLines()` subtracts
  `accumulatedImpairment` in the NBV/basis term; excludes `'Under Construction'`.
- Edge functions: `post-sales-invoice` Fixed Asset branch → gain/loss pattern;
  `post-receipt`/`post-purchase-invoice` append `fixedAssetCipCost` rows when the
  target asset's class is CIP (GL lines unchanged — CIP class's own asset account).
- Routes: `x+/fixed-asset+/$fixedAssetId.{dispose,transfer,components}`;
  `x+/impairment+/{new,$impairmentId,$impairmentId.post}`;
  `x+/accounting+/cip-aging` (report loader).

## UI Changes

- `FixedAssetDisposalForm`: proceeds section (invoice picker filtered to this
  asset's Fixed Asset lines, or direct account + amount) and partial-disposal
  quantity/fraction input with live gain/loss preview.
- New `FixedAssetImpairmentForm` (scope toggle, per-line recoverable amounts,
  computed loss column) + impairments table; new `FixedAssetTransferForm` (type,
  target class, in-service date), reused as the "Capitalize" action on CIP assets.
- `FixedAssetForm`: parent-asset combobox; register groups components under
  parents; NBV column = cost − accum dep − accum impairment.
- CIP aging report page (buckets by first-cost age, drill to cost ledger).

## Acceptance Criteria

- [ ] Asset cost 10,000, accumulated depreciation 4,000, sold via sales invoice for
      7,500: posting produces Dr AR 7,500, Dr Accum Dep 4,000, Cr Asset 10,000,
      Cr `disposalAccountId` 1,500 (gain); `fixedAssetDisposal.gainLoss` = 1,500;
      no revenue-account line; asset status `Disposed`.
- [ ] Same asset scrapped (proceeds 0): unchanged legacy journal — Dr Accum Dep
      4,000, Dr `writeOffAccountId` 6,000, Cr Asset 10,000.
- [ ] Partial disposal, fraction 0.4, direct proceeds 3,000 to a cash account:
      Dr Cash 3,000, Dr Accum Dep 1,600, Cr Asset 4,000, Cr gain 600; asset stays
      `Active` with cost 6,000 / accum dep 2,400; disposal row stores fraction 0.4
      and snapshots 4,000 / 1,600.
- [ ] Impairment: NBV 6,000 (10,000 − 4,000), recoverable amount 4,500 → posted
      journal Dr `writeDownAccountId` 1,500 / Cr accumulated depreciation account
      1,500; `accumulatedImpairment` = 1,500; next depreciation run for this asset
      (straight line, 36 months remaining, 0 residual) charges 125.00 (= 4,500/36),
      not 166.67.
- [ ] Class-scope impairment creates one line per Active asset in the class,
      prefilled with each NBV; lines with recoverable ≥ NBV post nothing.
- [ ] CIP asset (class flagged CIP) receives a 6,000 Fixed Asset PO line (via
      purchase-invoice posting) and a 2,500 job-cost attachment: two
      `fixedAssetCipCost` rows, GL shows 8,500 Dr in the CIP asset account (2,500
      credited from WIP); asset status `Under Construction`; asset appears in CIP
      aging; depreciation run proposal excludes it.
- [ ] Capitalization of that asset into Machinery & Equipment with in-service date
      2026-08-01: journal Dr Machinery asset account 8,500 / Cr CIP asset account
      8,500; `acquisitionCost` = 8,500, `depreciationStartDate` = 2026-08-01,
      status `Active`; August run depreciates it.
- [ ] Component: child asset with `parentFixedAssetId` set, own class and 60-month
      life, depreciates independently; attempting to parent an asset under an
      asset that itself has a parent is rejected.
- [ ] Reclassification transfer between two depreciating classes posts the
      cost + accumulated-depreciation reclass lines and skips lines where source
      and target accounts are identical.
- [ ] Posting a disposal/impairment/transfer dated into a Closed period fails with
      the standard closed-period error; posted documents reject edits (immutability
      trigger pattern), and the UI offers reversal instead.
- [ ] All new tables have four RLS policies and `companyId` scoping;
      `pnpm exec turbo run typecheck --filter=erp` passes after
      `pnpm run generate:types`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Rewriting `post-sales-invoice` Fixed Asset branch regresses AR/tax lines | High | Coordinated PR with edge-function integration tests covering invoice-with-asset-line fixtures before/after |
| Partial-disposal rounding drift (fraction × cost vs stored balances) | Med | Snapshot columns are authoritative for the journal; final partial (remaining fraction) disposes exact remaining balances |
| Impairment inside accum-dep account complicates account-level reconciliation | Med | Register report splits dep vs impairment from subledger columns; note in docs; revisit split account when multi-book lands |
| CIP WIP credit double-counts if job later ships/completes normally | High | Jobs attached to a CIP asset are blocked from normal completion costing (see open question 6) |
| Enum ADD VALUE in same transaction as usage | Low | Separate enums migration file, as the existing `20260524143826` precedent |

## Open Questions

> HARD STOP: unchecked items must be resolved before implementation.

- [x] Where does disposal gain/loss post? — **Resolved:** net to the class's
      existing `disposalAccountId` (proceeds − NBV); `writeOffAccountId` stays the
      scrapping target. (Scope resolution 1.)
- [x] Are partial disposals in scope? — **Resolved:** yes; quantity or value
      fraction, pro-rata cost/accumulated split. (Scope resolution 1.)
- [x] Impairment credit: new contra-account column or contra treatment? —
      **Resolved:** contra treatment in the existing accumulated-depreciation
      account plus a `fixedAsset.accumulatedImpairment` tracking column; no new
      NOT NULL account FK (breaking backfill avoided; subledger keeps the split
      for reporting and future IAS 36 reversals). (Scope resolution 2 + Decision 4.)
- [x] CIP cost sources? — **Resolved:** Fixed Asset PO lines and job costs both
      accumulate onto a CIP asset; capitalization transfers to a depreciating
      class and starts depreciation at in-service date. (Scope resolution 3.)
- [x] Components for IFRS? — **Resolved:** one-level parent/child with independent
      lives/methods; book-specific depreciation parameters are the multi-book
      spec's layer on top. (Scope resolution 4.)
- [x] Depreciation scheduling / close checks here? — **Resolved:** no — the
      close-automation spec owns scheduled runs and close-readiness; this spec
      only excludes `Under Construction` from runs. (Scope resolution 5.)
- [ ] **Job → CIP WIP credit timing:** credit WIP at attachment (cost leaves the
      job immediately; job margin excludes asset build) vs only at capitalization
      (WIP stays until in-service). Recommended: at attachment — matches SAP AuC
      settlement and keeps WIP clean at close — but it changes production job
      costing behavior, and jobs attached to CIP must be blocked from normal
      completion costing. Cross-module (production) contract → needs sign-off.
- [ ] **Fate of the standalone "Sell" flow:** `$fixedAssetId.sell` today creates a
      sales order at book value and the invoice posts revenue. Once disposal owns
      gain/loss, should Sell remain (as the invoice-generating front end whose
      posting now nets to `disposalAccountId`) or be folded into the dispose form?
      Recommended: keep Sell as the front end, rewrite only its posting — but this
      changes what customers see on posted invoices' GL, so it needs confirmation.

## Changelog

- 2026-07-04: Created from readiness finding GAP-4 remainder (tracking crbnos/carbon#1041); scope resolutions 1–5 baked in; two new blocking questions surfaced (WIP credit timing, Sell-flow fate).
