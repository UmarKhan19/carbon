# Purchasing Module

Purchase orders, supplier management, supplier quotes/interactions, receipt-to-PO matching, and procurement planning. Handles the full procure-to-receive lifecycle including supplier approval workflows, supplier quote finalization, and conversion to purchase orders.

## Key Domain Concepts

- **Purchase Orders** — documents sent to suppliers; statuses: Draft → Needs Approval → To Review → To Receive → To Receive and Invoice → To Invoice → Completed. Can be closed manually.
- **Supplier Interactions** — umbrella entity linking a supplier quote to RFQs, POs, and documents. A supplier quote lives under an interaction.
- **Supplier Quotes** — vendor-side pricing; can be finalized and converted to POs via the `convert` edge function.
- **Supplier Processes** — which processes a supplier can perform (links `supplier` ↔ `process`).
- **Purchasing Planning** — MRP-driven planned orders that can be released into POs (`get_purchasing_planning` RPC).
- **Conversion Factors** — when a supplier's UoM differs from the item's stocking UoM, a conversion factor on `purchaseOrderLine` scales quantities at receipt time. See `.claude/rules/purchasing-conversion-factors.md`.

## Safety

### Always
- Scope all queries by `companyId`; purchasing data is multi-tenant.
- Use the `convert` edge function for supplier-quote → PO conversion (never hand-roll inserts).
- Preserve existing `conversionFactor` on PO lines when editing — it drives receipt quantities.

### Ask First
- Changing PO status (approval/finalization workflows have business rules).
- Deleting suppliers or POs that may have linked receipts or invoices.

### Never
- Bypass the approval workflow by directly setting status to `To Receive`.
- Delete receipt lines that have already been posted to inventory.

## Key Data Model

| Table | Purpose |
|---|---|
| `purchaseOrder` | PO header: supplier, status, dates, location |
| `purchaseOrderLine` | Line items: item, quantity, price, conversionFactor, jobId |
| `supplier` | Vendor master: name, type, status, tax info |
| `supplierContact` / `supplierLocation` | Supplier address book |
| `supplierProcess` | Which processes a supplier offers |
| `supplierInteraction` | Container for a supplier quote exchange |
| `supplierQuote` / `supplierQuoteLine` / `supplierQuoteLinePrice` | Vendor pricing at quantity breaks |

## Key Service Functions

- `getPurchaseOrder`, `getPurchaseOrders`, `getPurchaseOrderLines` — read POs
- `closePurchaseOrder` — marks a PO closed
- `convertSupplierQuoteToOrder` — calls `convert` edge function
- `duplicatePurchaseOrder` — copies a PO with new sequence
- `finalizeSupplierQuote` — locks a supplier quote
- `getSupplier`, `getSuppliers`, `getSupplierContacts`, `getSupplierLocations`
- `getPurchasingPlanning` — MRP-driven planned order view (`get_purchasing_planning` RPC)
- `getSupplierApprovalContext` — reads approval workflow state

## Related Modules

- **inventory** — receipts consume PO lines; `purchaseOrderLine.quantityReceived` is updated on receipt
- **items** — `purchaseOrderLine.itemId` → item master; supplier parts live in items module (`supplierPart`)
- **production** — jobs link to PO lines via `purchaseOrderLine.jobId` for outside operations
- **accounting** — purchase invoices tie to POs; posting groups drive GL entries
- **sales** — supplier quotes can originate from sales RFQ workflows

## Rules References

- `.claude/rules/purchasing-conversion-factors.md` — how UoM conversion works on PO lines
- `.claude/rules/method-material-sourcing.md` — how method materials determine sourcing type (Buy/Make/Pull)
