# AR & AP Aging Reports

## Context

We already have the tie-out report (subledger vs GL control). Aging is the **standard finance complement**: same open-amount data, sliced by how many days each invoice is past due. Drives "who do we chase / who do we pay first" conversations. Every ERP ships this.

Same shared-component pattern as `TieOut` — one `<AgingReport side="ar"|"ap" />` rendered by two routes under `accounting+/`, backed by two RPCs that share an SQL CTE.

## Goals (in scope)

1. Two new SQL functions: `get_ar_aging(_company_id, _as_of_date)` and `get_ap_aging(...)` returning one row per counterparty with totals per bucket: **Current**, **1-30**, **31-60**, **61-90**, **90+** days past due, plus a `total`.
2. One shared `<AgingReport side="ar"|"ap" />` component in `modules/accounting/ui/Reports/` rendering a `Table` of counterparties with per-bucket columns.
3. Two routes: `x+/accounting+/ar-aging.tsx` and `x+/accounting+/ap-aging.tsx`, each loading the corresponding RPC and rendering the shared component.
4. Wire both into the accounting Reports submenu (next to Trial Balance and Tie-Out).
5. Path helpers `arAging` and `apAging`.

## Non-goals

- Configurable bucket boundaries (hardcode 30/60/90 for v1; if users complain, add a settings hook later).
- Aging Detail report (per-invoice list grouped by customer). Drill-down is via the existing tie-out drill or by clicking the customer name to navigate to the customer's invoice list.
- Future-dated aging (only as-of past or today).
- PDF / email of aging reports.
- Statement of account (the customer-facing version).

## Bucket math

For each open invoice (active status, `postingDate <= as_of`, balance > 0 in invoice currency):

| Bucket | Condition |
|---|---|
| Current | `dateDue IS NULL OR dateDue >= as_of` (not yet due) |
| 1-30 | `1 <= (as_of - dateDue) <= 30` |
| 31-60 | `31 <= ... <= 60` |
| 61-90 | `61 <= ... <= 90` |
| 90+ | `(as_of - dateDue) > 90` |

Open amount per invoice = `(totalAmount - settled) * exchangeRate` (base currency) where settled = sum of applied + discount + writeOff from Posted-payment applications with `appliedDate <= as_of`. Same formula as the tie-out — could be factored into a shared SQL helper, but for v1 the duplicate in two RPCs is fine.

**Unapplied payments** (on-account credits) reduce a counterparty's total balance but don't fit any aging bucket. v1 ignores them in aging (matches NetSuite "Aging by Document Date"); the tie-out remains the place to see the full subledger reconciliation. Document this in the report subtitle.

## Critical files

| Path | Change |
|---|---|
| `packages/database/supabase/migrations/<ts>_ar-ap-aging.sql` | **New**: `get_ar_aging` + `get_ap_aging` RPCs |
| `apps/erp/app/modules/invoicing/invoicing.service.ts` | Append `getArAging(client, companyId, asOfDate)` + `getApAging(...)` |
| `packages/database/src/types.ts` + `packages/database/supabase/functions/lib/types.ts` | Hand-patch the two new RPC signatures (no `db:types` without Docker) |
| `apps/erp/app/modules/accounting/ui/Reports/AgingReport.tsx` | **New**: shared `<AgingReport side={...} />` |
| `apps/erp/app/modules/accounting/ui/Reports/index.ts` | Export `AgingReport` |
| `apps/erp/app/routes/x+/accounting+/ar-aging.tsx` | **New**: loader calls `getArAging`, renders `<AgingReport side="ar" />` |
| `apps/erp/app/routes/x+/accounting+/ap-aging.tsx` | **New**: parallel |
| `apps/erp/app/utils/path.ts` | `arAging` + `apAging` |
| `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` | Add "AR Aging" + "AP Aging" entries in the Reports group |

## SQL shape

```sql
CREATE OR REPLACE FUNCTION get_ar_aging(
  _company_id TEXT,
  _as_of_date DATE
) RETURNS TABLE (
  "customerId" TEXT,
  "current" NUMERIC,
  "days1to30" NUMERIC,
  "days31to60" NUMERIC,
  "days61to90" NUMERIC,
  "days90plus" NUMERIC,
  "total" NUMERIC
) LANGUAGE SQL SECURITY INVOKER AS $$
  WITH open_invoices AS (
    SELECT
      si."customerId",
      si."dateDue",
      (si."totalAmount" - COALESCE((
        SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount")
        FROM "paymentApplication" pa
        JOIN "payment" p ON p."id" = pa."paymentId"
        WHERE pa."salesInvoiceId" = si."id"
          AND p."status" = 'Posted'
          AND pa."appliedDate" <= _as_of_date
      ), 0)) * si."exchangeRate" AS open_base
    FROM "salesInvoice" si
    WHERE si."companyId" = _company_id
      AND si."postingDate" <= _as_of_date
      AND si."status" NOT IN ('Draft', 'Pending', 'Voided')
  ),
  bucketed AS (
    SELECT
      "customerId",
      CASE
        WHEN "dateDue" IS NULL OR "dateDue" >= _as_of_date THEN 'current'
        WHEN _as_of_date - "dateDue" BETWEEN 1 AND 30 THEN 'd1_30'
        WHEN _as_of_date - "dateDue" BETWEEN 31 AND 60 THEN 'd31_60'
        WHEN _as_of_date - "dateDue" BETWEEN 61 AND 90 THEN 'd61_90'
        ELSE 'd90plus'
      END AS bucket,
      open_base
    FROM open_invoices
    WHERE open_base > 0
  )
  SELECT
    "customerId",
    COALESCE(SUM(open_base) FILTER (WHERE bucket = 'current'), 0)  AS "current",
    COALESCE(SUM(open_base) FILTER (WHERE bucket = 'd1_30'), 0)    AS "days1to30",
    COALESCE(SUM(open_base) FILTER (WHERE bucket = 'd31_60'), 0)   AS "days31to60",
    COALESCE(SUM(open_base) FILTER (WHERE bucket = 'd61_90'), 0)   AS "days61to90",
    COALESCE(SUM(open_base) FILTER (WHERE bucket = 'd90plus'), 0)  AS "days90plus",
    COALESCE(SUM(open_base), 0)                                    AS "total"
  FROM bucketed
  GROUP BY "customerId"
  ORDER BY "total" DESC;
$$;
```

AP mirror substitutes `purchaseInvoice` and `supplierId`.

## UI shape

`<AgingReport side="ar"|"ap" />`:

- Header: `<DatePicker>` driven by `useUrlParams` (matches `TieOut`).
- Four `<Card>` summary tiles at the top: Current / 31-60 / 61-90 / 90+ (skip 1-30 to keep the row tight — it's in the table). Each shows the sum across all counterparties in base currency.
- `<Table>` with columns: counterparty (`CustomerAvatar`/`SupplierAvatar`), Current, 1-30, 31-60, 61-90, 90+, Total. Total column right-aligned and bold; per-column totals via the existing `meta.renderTotal` pattern.
- Counterparty column links to the customer/supplier detail page.

## Sequence

1. Migration with both RPCs.
2. Service functions appended to `invoicing.service.ts`.
3. Hand-patch the two new RPC entries into both `types.ts` files (same pattern as the tie-out RPCs in commit `af81184`).
4. `AgingReport` shared component.
5. Two route files.
6. Submenu wire-up + path helpers.

## Verification

1. Seed a customer with three invoices: one due in 60 days (Current), one due 15 days ago (1-30), one due 100 days ago (90+). Full balances.
2. Visit `/x/accounting/ar-aging` → one row for the customer with the three amounts in their right buckets; total = sum.
3. Apply a Posted payment for the full 100+ days invoice → re-load → that bucket goes to 0; total reduced.
4. AP mirror with a supplier.
5. RPC syntax verified standalone on a fresh DB (same approach as the tie-out migration).
