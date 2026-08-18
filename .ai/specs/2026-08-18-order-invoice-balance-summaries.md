# Issue #1005 — Order and Invoice Balance Summaries

> Status: in-progress (implementation present; convention artifacts and final release verification pending)
> Author: Carbon maintainers
> Date: 2026-08-18
> Tracking issue: crbnos/carbon#1005

## TLDR

Show authoritative settlement totals, paid amounts, and remaining balances on
Sales Orders, Purchase Orders, Sales Invoices, and Purchase Invoices. Order
summaries aggregate linked invoice views without adding a payment-allocation
model; individual invoice summaries keep their authoritative settlement visible
when presentation currency metadata is unsafe.

## Problem

After partial settlement, users cannot easily see how much remains due. The
summary surfaces need to distinguish the document total from the amount
invoiced, the amount paid, and the balance still outstanding.

Affected surfaces:

- Sales Order
- Purchase Order
- Sales Invoice
- Purchase Invoice

## Intended UX

- **Sales Order:** show the order total, Invoiced Amount, Paid Amount, and
  Balance Remaining. Show **Paid** only when the linked settlement is genuinely
  complete.
- **Purchase Order:** show the order total, Invoiced Amount, Paid Amount, and
  Balance Remaining. Show **Paid** only when the linked settlement is genuinely
  complete.
- **Sales Invoice and Purchase Invoice:** show Total, Paid Amount, and Balance
  Remaining. Preserve the authoritative base/native settlement and show a
  secondary presentation-currency value only when its metadata is safe.

An order total and a linked-invoice balance are different concepts. An order
can be only partly invoiced, so the order total must not be presented as the
amount still due on its linked invoices.

## Source of Truth

Settlement values come from the authoritative invoice views:

- `salesInvoices.totalAmount` and `salesInvoices.balance`
- `purchaseInvoices.totalAmount` and `purchaseInvoices.balance`

For every invoice, paid amount is derived as:

```text
paid = totalAmount - balance
```

The implementation does not sum raw payment rows. Discounts, write-offs,
credit/debit memos, and partial payments remain represented by the invoice-view
`balance`.

## Order Aggregation

Sales Orders follow `salesInvoiceLine` links and Purchase Orders follow
`purchaseInvoiceLine` links. The implementation:

- deduplicates linked invoice IDs before reading invoice views;
- batches the invoice-view read instead of querying once per invoice;
- scopes both the linkage query and the batched invoice-view query by
  `companyId`;
- fails closed when an authoritative row is missing or its `totalAmount` or
  `balance` is malformed, rather than coercing the value to zero;
- excludes and reports invoices with incompatible or unresolved currency or
  exchange-rate metadata;
- uses each linked invoice's own exchange rate when presentation conversion is
  needed; and
- suppresses **Paid** when any linked invoice is excluded.

## Individual Invoices

The Sales Invoice and Purchase Invoice loaders validate the authoritative
`totalAmount`/`balance` pair before rendering. The base/native settlement stays
visible even when currency or FX metadata cannot support presentation
conversion. Unsafe converted secondary values are omitted instead of being
shown as a fabricated zero.

## Known Intentional Limitation

The existing whole-linked-invoice behavior is unchanged: one invoice may span
multiple orders. #1005 does not invent a settlement-allocation policy between
those orders. There is no proportional, FIFO, or line-allocation calculation.

## Scope Boundaries

#1005 does **not**:

- alter payment posting;
- alter the settlement schema;
- change invoice database views;
- normalize Carbon's broader FX system;
- add migrations;
- change GL behavior; or
- introduce realtime updates or polling.

## Data Model Changes

None. The implementation reads existing invoice views and existing invoice-line
links. No tables, columns, views, migrations, or generated database types are
changed.

## API / Service Changes

The implementation adds a pure invoicing settlement helper and narrow,
company-scoped service reads for batched invoice-view settlement data. Existing
payment and settlement APIs are unchanged.

## UI Changes

The four document summary components now render the settlement fields described
in **Intended UX**. Order summaries retain their existing order-total and
invoiced-versus-fulfillment distinctions; invoice summaries retain their
existing line and shipping presentation while adding authoritative settlement
values.

## Acceptance Criteria

- [x] Sales and Purchase Order summaries show total/invoiced, paid, and
      remaining settlement values, with a Paid state only for complete included
      linked settlement.
- [x] Sales and Purchase Invoice summaries show authoritative total, paid, and
      remaining values.
- [x] Partial payments are reflected through `totalAmount - balance`.
- [x] Linked invoice IDs are deduplicated and read in one company-scoped batch
      per order.
- [x] Missing or malformed authoritative rows fail closed; unresolved currency
      and FX metadata is excluded/reported.
- [x] Individual invoice base/native values remain visible when converted values
      are unsafe.
- [x] No payment posting, settlement schema, invoice view, migration, GL, FX
      architecture, realtime, polling, or allocation behavior is changed.

## Verification

The reviewed implementation completed the following checks before this
convention-fix session:

- targeted Vitest coverage: **9 files, 104 tests passed**;
- `pnpm exec turbo run typecheck --filter=erp`: passed;
- targeted Biome checks: **17 files passed**; and
- `git diff --check`: clean.

The implementation review also recorded successful Lingui extraction/clean and
catalog compilation for the new message IDs. Full production build and browser
verification were not completed and are not claimed here. Translation
completeness and product-document synchronization are the follow-up convention
work tracked by this session; the final `linguito check` must be green before
this spec can move to `implemented/`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| A shared invoice is linked to multiple orders. | Med | Preserve whole-linked-invoice semantics and do not imply an allocation policy. |
| Currency or FX metadata is incomplete. | Med | Exclude/report the affected aggregate and omit unsafe converted secondary values. |
| A view row is missing or malformed. | High | Validate the authoritative pair and fail closed rather than rendering a guessed amount. |

## Open Questions

None. The source-of-truth pair, aggregation semantics, fail-closed behavior,
whole-invoice limitation, and scope boundaries are resolved in the
implementation above.

## Changelog

- 2026-08-18: Created from the reviewed Issue #1005 implementation; recorded
  the authoritative invoice-view source, cross-module UX, intentional
  whole-linked-invoice limitation, and explicit scope boundaries.
