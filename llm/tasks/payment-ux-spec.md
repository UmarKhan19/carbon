# NetSuite-Parity Payment UX

## Context

Carbon already has the back-end for payments and applications (atomic settlement, derived status, tie-out RPCs, edge function for posting). The UX is payment-centric only — you create a payment from `/x/payment/new`, then add applications one at a time by typing raw invoice IDs.

After deriving status from applications, the legacy Payment dropdown on the invoice header (which used to flip `status` to `Paid` / `Partially Paid`) is now a no-op and confusing. We want NetSuite's invoice-centric pattern as the primary path: a single "Receive Payment" / "Make Payment" button on the invoice that opens a pre-filled payment with all the counterparty's open invoices laid out as a check-and-amount apply list.

The standalone `/x/payment/new` flow stays as the secondary entry point for cash-blotter and on-account scenarios.

## NetSuite reference

| Element | Behavior |
|---|---|
| Invoice header button | "Accept Payment" — single primary action when invoice has open balance |
| Customer Payment page | Opens pre-filled with customer + payment date + this invoice already auto-applied for full open amount |
| Apply subtab | Table of ALL open invoices for that customer with checkbox + applied-amount per row, running totals, "Apply" / "Unapply" / "Auto Apply" buttons |
| Status | Read-only on the invoice; derived from applications |
| Invoice → related list | Shows the payment(s) that applied to this invoice with amount + date, linked |

## Goals (in scope)

1. Replace the Payment dropdown on `salesInvoice` and `purchaseInvoice` headers with `<PaymentStatus>` badge + "Receive Payment" / "Make Payment" button.
2. New-payment form accepts query-params (`customerId`, `supplierId`, `invoiceId`, `amount`) and pre-fills accordingly.
3. Payment detail's application editor becomes an **apply list** of the counterparty's open invoices — checkbox per row, applied-amount input per row, running totals, "Auto Apply" button (oldest-first).
4. New "Payments" panel/section on the invoice detail showing every Posted application against it (amount, date, link to payment).

## Non-goals

- Customer Deposits / prepayments (NetSuite has a separate flow; defer).
- Reset Cleared Items (SAP-style un-apply without voiding; defer — void+repay works).
- Multi-currency-pair conversion UI niceties (rates are still manual inputs).
- Bank reconciliation / statement matching.
- Auto-suggest matching on import.

## Critical files

| Path | Change |
|---|---|
| `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader.tsx` | Replace Payment dropdown with `<PaymentStatus>` + "Receive Payment" button |
| `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceHeader.tsx` | Replace Payment dropdown with `<PaymentStatus>` + "Make Payment" button |
| `apps/erp/app/modules/invoicing/ui/Payment/PaymentForm.tsx` | Accept query-param prefills; expose `defaultValues` for counterparty + currency |
| `apps/erp/app/routes/x+/payment+/new.tsx` | Read query params; build initialValues; on create, auto-build first application against `invoiceId` if present |
| `apps/erp/app/modules/invoicing/ui/Payment/PaymentApplyTable.tsx` | **New**: full apply list (Table or grid) per the spec below |
| `apps/erp/app/routes/x+/payment+/$paymentId.tsx` | Replace `PaymentApplicationForm` with `PaymentApplyTable` for Draft payments |
| `apps/erp/app/routes/x+/payment+/$paymentId.applications.set.tsx` | **New**: batch action that uses `replacePaymentApplications` (already in service) |
| `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoicePayments.tsx` | **New**: read-only panel listing applications + linking to payment |
| `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicePayments.tsx` | **New**: parallel for AP |
| `apps/erp/app/modules/invoicing/payments.service.ts` | Add `getPaymentApplicationsForInvoice(side, invoiceId)` |
| `apps/erp/app/utils/path.ts` | `paymentApplicationsSet(id)` helper |

## PaymentApplyTable design

Mirrors NetSuite's Apply subtab. Inside the payment detail page when status='Draft'.

- Loads `getOpenSalesInvoicesForCustomer` or `getOpenPurchaseInvoicesForSupplier` (already implemented) for the payment's counterparty.
- One row per open invoice; columns: checkbox · invoice # · due date · currency · total · open · **applied amount** (editable Number input) · **discount** · **write-off**.
- Header buttons:
  - **Auto Apply** — distribute remaining cash to oldest invoices until depleted; clears prior selections first.
  - **Clear** — uncheck all, zero all amounts.
  - **Save** — POSTs to `paymentApplicationsSet` which calls `replacePaymentApplications`.
- Footer:
  - Running total of applied + discount + write-off (in payment currency).
  - "Unapplied" = `payment.totalAmount - sum(applied)`.
  - Save button is the primary action; disabled if total applied > totalAmount.
- Exchange rates per row default to the invoice's `exchangeRate` and the payment's `exchangeRate`; advanced disclosure shows them and lets the user override.

Behaviour with current `PaymentApplicationForm`: deprecate. Its single-row add-form was a stop-gap and the apply-list supersedes it for Draft payments.

## Invoice header redesign

Sales/Purchase invoice headers currently render a Payment dropdown that calls a status mutation. After this spec:

- **`PaymentStatus` badge** shown on the header (driven by the derived `salesInvoices.status` / `purchaseInvoices.status` from the view).
- **"Receive Payment" / "Make Payment" Button** (primary variant when status is the side's active value and `balance > 0`; hidden when status is `Paid`, `Voided`, or terminal). Navigates to:
  ```
  /x/payment/new?customerId={id}&invoiceId={id}&amount={balance}    // AR
  /x/payment/new?supplierId={id}&invoiceId={id}&amount={balance}    // AP
  ```
- **"View Payments" link** when applications exist — anchors to the new SalesInvoicePayments / PurchaseInvoicePayments panel.

The existing dropdown's status-set behavior is removed (it has been a no-op since the service started rejecting derived statuses).

## Pre-fill from query params

`new.tsx` loader reads:
- `customerId` / `supplierId` → seeds counterparty + sets `paymentType`
- `invoiceId` → carried to action; after payment insert, the action also inserts one `paymentApplication` with `appliedAmount = balance` against that invoice (rates pulled from the invoice)
- `amount` → seeds `totalAmount`

When the user lands, the form is mostly populated; they pick a bank account + reference and save.

## Invoice payments panel

Below the line items on the invoice detail page. Read-only table:

| Date | Payment ID | Applied | Discount | Write-Off | FX G/L | Status |

Links each row to `/x/payment/{paymentId}`. Hidden when there are zero applications.

## Sequence

1. **`paymentApplicationsSet` route + service** — small; unblocks the apply-table.
2. **`PaymentApplyTable`** component — biggest single piece of work; replaces the existing add-form on Draft payments.
3. **`new.tsx` query-param prefill** including auto-create of the first application.
4. **`SalesInvoicePayments` + `PurchaseInvoicePayments`** panels — small read-only components.
5. **Sales + Purchase invoice header refactor** — replaces the dropdown with badge + "Receive/Make Payment" button + "View Payments" anchor.

## Verification

End-to-end (manual, requires DB):

1. Open a `Submitted` sales invoice with $100 balance. Header shows `Submitted` badge + "Receive Payment" button.
2. Click "Receive Payment" → new-payment page opens with customer filled in, totalAmount=100, currency from invoice.
3. Save → redirected to payment detail; one application already created against the invoice for 100; unapplied = 0.
4. Post → invoice status badge becomes `Paid`; "Receive Payment" button disappears; "View Payments" link appears; clicking it scrolls to the payments panel showing one row linking back to the payment.
5. From `/x/payment/new` directly: pick a customer with 3 open invoices, enter totalAmount = sum of two of them, click "Auto Apply" → first two invoices auto-filled, third unchecked.
6. AP mirror: open purchase invoice → "Make Payment" → same flow.
7. Tie-out report variance still = 0 after each step.

## Tests

- `PaymentApplyTable.test.tsx` (RTL) — auto-apply distributes correctly, total-exceeded disables save, deselect clears applied amount.
- Service test for `getPaymentApplicationsForInvoice` (filters to Posted applications only).
- Validator: applying more than open balance rejected.
