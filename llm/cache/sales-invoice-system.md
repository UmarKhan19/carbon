# Sales Invoice System

## Overview

The Carbon ERP system includes comprehensive sales invoicing functionality, allowing creation of invoices from sales orders or shipments.

## Database Schema

### Sales Invoice Table (`salesInvoice`)

Located in migration: `20250507143421_sales-invoice.sql`

Key fields:
- `id` TEXT (primary key, xid format)
- `invoiceId` TEXT (unique readable identifier per company)
- `status` ENUM: 'Draft', 'Pending', 'Submitted', 'Return', 'Credit Note Issued', 'Paid', 'Partially Paid', 'Overdue', 'Voided'
- `customerId` TEXT (FK to customer.id)
- `invoiceCustomerId` TEXT (billing customer, can be different)
- `paymentTermId` TEXT (FK to paymentTerm.id)
- `postingDate` DATE
- `dateIssued` DATE
- `dateDue` DATE (automatically calculated from payment terms)
- `datePaid` DATE
- `currencyCode` TEXT
- `exchangeRate` NUMERIC
- `subtotal`, `totalDiscount`, `totalAmount`, `totalTax`, `balance` (all NUMERIC)
- `companyId` TEXT

### Payment Term Table (`paymentTerm`)

Located in migration: `20230510035345_purchasing.sql`

Key fields:
- `id` TEXT (primary key)
- `name` TEXT
- `daysDue` INTEGER - Number of days until payment is due
- `daysDiscount` INTEGER - Days to receive early payment discount
- `discountPercentage` NUMERIC(10,5) - Early payment discount percentage
- `calculationMethod` ENUM: 'Net', 'End of Month', 'Day of Month'

## Due Date Auto-Calculation

When a sales invoice is created from a sales order or shipment, the system automatically calculates the `dateDue` based on the payment terms from `salesOrderPayment.paymentTermId`.

### Calculation Methods

1. **Net**: Payment due N days after invoice issue date
   - Example: Net 30 = due date is 30 days from issue date

2. **End of Month**: Payment due at end of month + N days
   - Example: If issue date is Jan 15 with 10 days due, due date is Feb 10

3. **Day of Month**: Payment due on specific day of the next month
   - Example: If daysDue is 15, payment due on the 15th of next month
   - Handles months with fewer days (e.g., uses 28th for February if daysDue is 31)

### Implementation

The `calculateDueDate` helper function is located in:
- `/packages/database/supabase/functions/convert/index.ts` (for invoice creation)
- `/apps/erp/app/routes/x+/sales-invoice+/update.tsx` (for invoice updates)

### Creation Flow

When creating from Sales Order (`salesOrderToSalesInvoice`):
1. Fetches sales order, lines, payment, and shipment data
2. Fetches payment term using `salesOrderPayment.paymentTermId`
3. Calculates `dateDue` using `calculateDueDate(dateIssued, daysDue, calculationMethod)`
4. Creates sales invoice with both `dateIssued` and `dateDue` set

When creating from Shipment (`shipmentToSalesInvoice`):
1. Same logic as above, using the source sales order's payment terms

### Update Behavior

When `dateIssued` is updated:
1. Fetches the invoice's `paymentTermId`
2. Fetches the payment term settings
3. Recalculates `dateDue` using the new `dateIssued` and payment term

When `paymentTermId` is updated:
1. Fetches the invoice's `dateIssued`
2. Fetches the new payment term settings
3. Recalculates `dateDue` using the existing `dateIssued` and new payment term

## Sales Invoice Creation Sources

1. **From Sales Order** - Via convert edge function (`salesOrderToSalesInvoice`)
2. **From Shipment** - Via convert edge function (`shipmentToSalesInvoice`)
3. **Manual Creation** - Via new invoice form (does not auto-set dateDue until dateIssued/paymentTermId are both set)

## Related Tables

- `salesInvoiceLine` - Line items on the invoice
- `salesInvoiceShipment` - Shipping information for the invoice
- `salesOrderPayment` - Contains payment term and billing customer information for sales orders

## Key Files

- `/packages/database/supabase/functions/convert/index.ts` - Invoice creation logic
- `/apps/erp/app/routes/x+/sales-invoice+/update.tsx` - Invoice update handler
- `/apps/erp/app/modules/invoicing/invoicing.service.ts` - Service layer functions
