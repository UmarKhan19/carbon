# Quote Shipping Cost (ERP)

There are TWO distinct "shipping cost" concepts on a quote:

## 1. Quote-level shipping cost (the "Shipping" section / card)

A single flat shipping cost for the whole quote, stored on the `quoteShipment` table (1:1 with `quote`, shares the same `id`).

- **UI component:** `apps/erp/app/modules/sales/ui/Quotes/QuoteShipmentForm.tsx`
  - Renders a `Card` titled "Shipping" with fields: `shippingCost` (Number, currency = company base currency), `locationId` (Location), `shippingMethodId` (ShippingMethod), `incoterm` (Select from `incoterms`), `incotermLocation` (Input, shown only if incoterm set), `receiptRequestedDate` (DatePicker).
  - `forwardRef` exposing `focusShippingCost()` (`QuoteShipmentFormRef`) so other UI can scroll/focus the shipping cost input.
  - Locking: `const isLocked = isQuoteLocked(routeData?.quote?.status); const isEditable = !isLocked;` Form gets `isDisabled={isLocked}`; Submit `isDisabled={!permissions.can("update","sales") || !isEditable}`.
- **Rendered in:** `apps/erp/app/routes/x+/quote+/$quoteId.details.tsx` (~line 217), with `initialValues={shipmentInitialValues}`. `shipmentInitialValues` (~line 168) is built from `quoteData.shipment` with `shippingCost: quoteData?.shipment?.shippingCost ?? 0` — this `?? 0` is the source of the $0 default.
- **Loaded in:** `apps/erp/app/routes/x+/quote+/$quoteId.tsx` loader via `getQuoteShipment(client, quoteId)` (~line 87), returned as `shipment: shipment.data` and consumed through `useRouteData(path.to.quote(quoteId))`.
- **Action/route:** `apps/erp/app/routes/x+/quote+/$quoteId.shipment.tsx` — POST to `path.to.quoteShipment(id)`. Validates with `quoteShipmentValidator`, calls `requireUnlocked({ isLocked: isQuoteLocked(quote.data?.status) })` (server-side lock guard via `~/utils/lockedGuard.server`), then `upsertQuoteShipment`.
- **Service fns** (`apps/erp/app/modules/sales/sales.service.ts`):
  - `getQuoteShipment` (~1484): `client.from("quoteShipment").select("*").eq("id", quoteId).single()`
  - `upsertQuoteShipment` (~4841): update/insert on `quoteShipment`.
- **Validator** `quoteShipmentValidator` (`sales.models.ts` ~659): `{ id, locationId?, shippingMethodId?, receiptRequestedDate?, shippingCost?, incoterm?, incotermLocation? }`.
- **DB table `quoteShipment`** (created in `20240831131003_sales-order-conversion.sql`, PK `id` = FK to `quote.id`, 1:1):
  - base cols: `id, locationId, shippingMethodId, shippingTermId, receiptRequestedDate, companyId, updatedBy, updatedAt`
  - `shippingCost NUMERIC(10,4) DEFAULT 0` added in `20241126124130_quote-shipping-cost.sql` (DEFAULT 0 = DB-level source of $0)
  - `incoterm`, `incotermLocation` added in `20260428233828_incoterms.sql`
  - Exposed on the `quotes` view as `qs."shippingCost"` (see same shipping-cost migration).

## 2. Per-price-break (per-quantity) shipping cost

Each quantity break of a quote line has its OWN shipping cost on `quoteLinePrice.shippingCost`.

- **UI:** `apps/erp/app/modules/sales/ui/Quotes/QuoteLinePricing.tsx` — a "Shipping Cost" row (~line 1090) with one `NumberField` per quantity column; edits call `onUpdatePrice("shippingCost", quantity, value)`.
  - Editable gate (~line 159): `isEditable = permissions.can("update","sales") && isEmployee && ["Draft"].includes(status)` — i.e. only editable while Draft (employees only).
- **DB:** `quoteLinePrice.shippingCost NUMERIC(10,5) NOT NULL DEFAULT 0` + generated `convertedShippingCost = shippingCost * exchangeRate`, added in `20241105002325_quote-taxes-and-shipping.sql`. (`quoteLinePrice` table created in `20240715134816_quote-pricing.sql`.)
- These per-break shipping costs feed line subtotals in `QuoteSummary.tsx` (uses `convertedShippingCost` per selected line), while the quote-level shipment shipping cost is added separately as `convertedShippingCost = quote.exchangeRate * shipment.shippingCost` (`QuoteSummary.tsx` ~837).

## Quote -> Sales Order: shipping consolidation (current behavior)

When a quote is converted to a sales order (`packages/database/supabase/functions/convert/index.ts`, `quoteToSalesOrder` case), per-line shipping is **consolidated into the order-level shipping section**:
- `salesOrderShipment.shippingCost = (quoteShipment.shippingCost ?? 0) + Σ(selected lines' shippingCost for quantity > 0)`.
- Each `salesOrderLine.shippingCost` is set to **0** to avoid double-counting (line shipping is included in the order subtotal in `SalesOrderSummary.tsx`, and the order-level shipping is added on top).
- Net effect: the order's pre-tax total is unchanged vs. the old per-line model; shipping is no longer taxed via the per-line path (the order-level shipping field is untaxed). The consolidated value then flows on to `salesInvoiceShipment.shippingCost` at invoicing.

## Quote "Shipping" card now reflects line shipping (not a $0 flat field)

`QuoteShipmentForm.tsx` no longer renders an editable flat `shippingCost` Number. It renders a **read-only derived display** computed from the line pricing (`routeData.lines`/`prices`/`salesOrderLines`):
- Once ordered (salesOrderLines exist): sum of each ordered line's price `shippingCost` at the ordered `saleQuantity`.
- Otherwise: sum of each line's single shipping value when consistent across its quantity breaks; if shipping varies across quantity options for any line, shows `"—"` (memoized `derivedShippingCost` returns `null`).
- The stored flat value is preserved on save via `<Hidden name="shippingCost" />`. The displayed total also includes that flat value (`initialValues.shippingCost`).

## Locking logic

`isQuoteLocked(status)` in `apps/erp/app/modules/sales/sales.models.ts` (~956):
```
export function isQuoteLocked(status) {
  return status !== null && status !== undefined && status !== "Draft";
}
```
So a quote is locked for ANY status other than "Draft" (Sent, Ordered, Partial, Lost, Cancelled, Expired). `quoteStatusType` defined `sales.models.ts` ~279: Draft, Sent, Ordered, Partial, Lost, Cancelled, Expired.

- Quote-level Shipping card: uses `isQuoteLocked` -> disabled when not Draft (client) + `requireUnlocked` server guard.
- Per-quantity pricing (incl. per-break shipping): uses explicit `["Draft"].includes(status)` check.

Both effectively mean: editable only while Draft; locked once Sent.
