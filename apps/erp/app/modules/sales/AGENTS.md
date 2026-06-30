# Sales Module

Quotes (with cost rollup and pricing), sales orders, sales RFQs, customer management, opportunity tracking, pricing rules/overrides, and the customer portal. Covers the full quote-to-order-to-fulfillment lifecycle.

## Key Domain Concepts

- **Opportunities** — container linking quotes and sales orders for a customer deal.
- **Quotes** — detailed cost estimates with line items, each having a make method (BOM + routing), quantity breaks with pricing, and cost category markups. Quote statuses: Draft → Pending → Sent → Ordered / Lost / Cancelled.
- **Quote Line Pricing** — per-quantity-break pricing. PK is `(quoteLineId, quantity)` — no `id` column. `discountPercent` is a **fraction 0..1** (not 0..100). Generated columns compute net/converted prices.
- **Pricing Rules** — company-scoped Discount/Markup rules. Discounts are non-stacking (highest priority wins); Markups stack and compound. See `.claude/rules/quote-discount-system.md`.
- **Price Overrides** — customer-specific or customer-type-specific price overrides with quantity breaks. Precedence: customer override > customer-type > all-customers > base price.
- **Sales Orders** — confirmed orders from quotes. Statuses drive fulfillment. Lines have `methodType` (Make to Order, Make to Stock, etc.) that determines production handling.
- **Sales RFQs** — inbound requests from customers, convertible to quotes.
- **Customers** — customer master with contacts, locations, tax settings, payment terms, shipping preferences.

## Safety

### Always
- Use `convertQuoteToOrder` for quote→order conversion — it goes through the `convert` edge function.
- Remember `discountPercent` is a fraction (0..1), not a percentage (0..100).
- Use `resolvePrice` + `applyPriceRules` for price calculation — never compute prices ad hoc.
- `quoteLinePrice` has no `id` column — PK is `(quoteLineId, quantity)`.

### Ask First
- Closing sales orders — it sets `closed`, `closedAt`, `closedBy` permanently.
- Deleting quotes that have been converted to orders (linked via opportunity).
- Modifying pricing rules — they affect all future price resolutions.

### Never
- Store `discountPercent` as a whole number (e.g., 10 instead of 0.10).
- Delete `quoteLinePrice` rows without preserving existing `discountPercent`, `leadTime`, and `categoryMarkups` — `upsertQuoteLinePrices` handles this.
- Bypass the `convert` edge function for quote-to-order or RFQ-to-quote conversions.

## Key Data Model

| Table / View | Purpose |
|---|---|
| `opportunity` | Deal container linking quotes and sales orders |
| `quote` / `quoteLine` / `quoteLinePrice` | Quote with cost rollup and quantity-break pricing |
| `quoteMakeMethod` / `quoteMaterial` / `quoteOperation` | Quote-level BOM and routing |
| `salesOrder` / `salesOrderLine` | Confirmed orders with fulfillment tracking |
| `salesRfq` / `salesRfqLine` | Inbound customer RFQs |
| `customer` / `customerContact` / `customerLocation` | Customer master data |
| `customerStatus` / `customerType` | Customer categorization |
| `pricingRule` | Company-scoped discount/markup rules |
| `priceOverride` / `priceOverrideBreak` | Customer-specific pricing |
| `noQuoteReason` | Why a quote was declined |

## Key Service Functions

- `convertQuoteToOrder`, `convertSalesRfqToQuote` — lifecycle conversions
- `copyQuoteLine`, `copyQuote` — duplication helpers
- `applyPriceRules` — applies discount/markup rules to a base price
- `resolvePrice` — full price resolution with overrides and rules
- `getQuote`, `getQuoteLines`, `getQuoteLinePrices` — quote reads
- `getSalesOrders`, `getSalesOrderLines`, `getExternalSalesOrderLines`
- `getCustomer`, `getCustomers`, `getCustomerContacts`, `getCustomerLocations`
- `getPricingRules`, `createPricingRule`, `duplicatePricingRule`
- `getOpportunity`, `getOpportunityDocuments`
- `closeSalesOrder` — closes an order

## Related Modules

- **production** — `convertSalesOrderLinesToJobs` creates jobs from Make to Order lines
- **items** — quote lines reference items; methods are copied from item make methods
- **purchasing** — sales RFQs may flow to purchasing; outside operations create PO lines
- **inventory** — shipments fulfill sales order lines
- **accounting** — sales invoices tie to orders; customer payment terms from accounting
- **people** — customer contacts may overlap with people/contacts

## Rules References

- `.claude/rules/quote-discount-system.md` — pricing architecture, discount vs markup, price trace
