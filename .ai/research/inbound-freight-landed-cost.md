# Inbound Freight / Landed Cost Research: Best Practices Survey

## Summary

Carbon currently **folds** allocated inbound shipping into the single inventory
debit at receipt (`post-receipt/index.ts:916` — `cost = lineCost +
lineWeightedShippingCost`), so freight is capitalized but **invisible** — there is
no way to see freight spend by supplier/period (e.g. "the purchaser is next-day-
airing everything"). There is **no inbound-freight account** in `accountDefault`
(the only freight account seeded is `6040 "Freight & Shipping Out"`, outbound).
This research surveys how SAP and NetSuite break out inbound freight. Both
**capitalize freight into inventory** (landed cost → correct COGS/margin) **but
break it out** via a dedicated freight account/condition/category so it's
reportable. Expensing freight to a pure P&L account is a supported **opt-out for
immaterial freight**, not the default.

## Competitors Surveyed

- **SAP S/4HANA (MM + FI)** — enterprise reference for delivery-cost handling.
- **NetSuite** — mid-market reference; the "Landed Cost" feature.

## Key Consensus Patterns

### 1. Freight is capitalized into inventory (landed cost), not expensed by default
- **SAP**: planned delivery costs "become part of material valuation at GR" — they
  flow into stock value (BSX) and later COGS. Under moving-average (V) freight
  raises the moving average; under standard price (S) freight it can't capitalize
  goes to a **price-difference/variance account**.
- **NetSuite**: "Any landed cost associated with an item is added to the asset
  value of an inventory item"; COGS on sale reflects full landed cost.
- **Rationale**: freight to acquire inventory is a **product cost** (GAAP), so
  capitalizing keeps per-product margin, inventory value, and COGS correct.

### 2. But freight is BROKEN OUT for visibility — its own account + line
- **SAP**: dedicated freight **condition types** (FRA1 %, FRB1 absolute, FRC1
  qty) on the PO; a **separate freight clearing account** (transaction key FR1,
  distinct from goods GR/IR key WRX); can settle to a **different freight vendor**.
  GR journal: `DR Stock (goods+freight) / CR GR-IR (goods) / CR Freight clearing
  (freight)`. The freight vendor invoice later clears the freight clearing account.
- **NetSuite**: **landed cost categories** (Freight, Duty, Insurance…), each mapped
  to its own **GL holding account**; allocation by weight/quantity/value; sourced
  from lines on the receipt or a **separate carrier vendor bill**. Receipt: `DR
  Inventory Asset / CR category holding account`; the freight bill clears the
  holding account.
- **Rationale**: a dedicated freight account (+ dimensions/category) yields a
  clean, sliceable freight figure for analytics.

### 3. Expensing freight to P&L is the explicit opt-out
- **NetSuite**: record freight as an "Other Charge" line mapped to a **freight
  expense account** (skip the Landed Cost subtab) → hits period P&L, not inventory.
  Chosen for **immaterial** freight / simplicity.
- **SAP**: unplanned delivery costs can be configured to a separate G/L expense
  account; account-assigned/non-stock POs debit the cost object; standard-price
  freight variance lands in a P&L price-difference account.

## Answers to Research Questions

1. **Break out or fold in?** Break out — both give freight its own account/line.
   Carbon folds it in today (the gap).
2. **Capitalize or expense?** Capitalize into inventory by **default** (both
   vendors); expense-to-P&L is the opt-out for immaterial freight.
3. **How is visibility achieved?** A dedicated freight (clearing/holding) account +
   category/condition + dimensions (supplier) → reportable freight spend.
4. **Standard-cost interaction?** Under standard price, freight that can't
   capitalize into standard-valued stock goes to a **price-difference/variance**
   account (SAP). So for Standard items, freight naturally flows to variance.

## Recommended Approach for Carbon

Two coherent options; **A is the researched default**:

- **Option A — Capitalize + break out (recommended; SAP/NetSuite default).**
  Add an **Inbound Freight** clearing account to `accountDefault`. At receipt,
  keep freight in inventory value (FIFO/Average) but split the **credit**: goods →
  GR/IR, freight → Inbound Freight clearing (with the supplier dimension). At
  invoice, clear both. For **Standard** items, inventory sits at standard, goods
  price delta → PPV, and freight → the freight/variance account (SAP standard-price
  behavior). Correct COGS/margin **and** freight visibility. More moving parts.

- **Option B — Expense freight-in to P&L (simpler opt-out).** Add an **Inbound
  Freight expense** account. At receipt, freight posts to it as its own line;
  inventory holds goods only. Most prominent/immediate P&L visibility; simplest.
  Understates inventory/COGS vs strict GAAP (fine for immaterial freight).

This applies to **all costing methods**, not just Standard — it reshapes the
shipping handling in `post-receipt` and `post-purchase-invoice`.

## Sources

- SAP freight condition types (FRA1/FRB1/FRC1) — https://community.sap.com/t5/enterprise-resource-planning-q-a/freight-condition-types-fra1-frb1-frc1/qaq-p/9719193
- SAP planned & unplanned delivery costs — https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/planned-amp-unplanned-delivery-costs/ba-p/13250707
- SAP freight clearing account (FR1) — https://community.sap.com/t5/enterprise-resource-planning-q-a/freight-clearing-account/qaq-p/9031572
- SAP entering delivery costs (invoice verification) — https://learning.sap.com/courses/invoice-verification-in-sap-s-4hana/entering-delivery-costs-1
- SAP moving-average vs standard price — https://blog.sap-press.com/what-is-the-difference-between-moving-average-price-and-standard-price-in-sap
- SAP KBA 1826392 delivery costs as own cost component — https://userapps.support.sap.com/sap/support/knowledge/en/1826392
- NetSuite Landed Cost Overview — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2417056.html
- NetSuite Landed Cost Categories — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2417902.html
- NetSuite Entering Landed Cost on a Transaction — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2418831.html
- NetSuite item setup for landed cost — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2418189.html
- Folio3 — NetSuite landed cost setup — https://netsuite.folio3.com/blog/landed-cost-setup-management/
- CohnReznick — NetSuite landed costs — https://www.cohnreznick.com/insights/optimize-inventory-tracking-with-netsuite-landed-costs
