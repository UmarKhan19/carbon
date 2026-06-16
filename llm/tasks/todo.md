# Lanjutan Feature: PDF Extraction & Auto-fill

## Semua selesai ✅

### Commits yang sudah di-push ke remote:
- `cb11a7edf` fix(auth): correct Uint8Array type-casting in passkey registration
- `6ee83d4b1` feat(jobs): update document extraction schema for RFQ contact and location fields
- `7dc801158` feat(erp): enhance CustomerLocation and SupplierLocation for auto-fill
- `68b343645` feat(sales): update SalesRFQForm and new RFQ route for auto-fill

### Commits lokal (belum push):
- `22f6bcb21` fix(jobs): increase AI API timeout (60s) and retries (5x) for DeepSeek
- `fb8807e14` feat(invoicing): auto-fill supplier currency from purchase invoice (PurchaseInvoiceProperties)
- `a2d89e90e` feat(invoicing): propagate resolved currency to new supplier form in invoice creation (PurchaseInvoiceForm)

## Bug Fix: Currency & Exchange Rate Alignment

### Plan and Progress
- [x] Fix database trigger typo that was blocking exchange rate propagation on purchase invoices. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] Add migration script to backfill existing purchaseInvoiceLine records' exchange rate. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] Fix multiplier-instead-of-division bug in purchase orders/invoices database views. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] Correct the shipping cost conversion math (multiply -> divide) in frontend summary screens (PurchaseOrderSummary, PurchaseInvoiceSummary). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] Correct the fallback unit price conversion math (avoiding division on USD standard unit price when supplier price is null) in frontend forms (PurchaseOrderLineForm, PurchaseInvoiceLineForm). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Review Section
- All database-level trigger, view, and backfill corrections are defined in untracked migration `20260616061244_fix_purchase_invoice_line_trigger_exchange_rate_typo.sql`.
- Frontend pricing calculation changes made to `PurchaseInvoiceSummary`, `PurchaseOrderSummary`, `PurchaseInvoiceLineForm`, and `PurchaseOrderLineForm`.
- A database rebuild/migration run is required to apply the trigger and view changes to the local environment.

## Summary Fitur
- Upload PDF → auto-fill form invoice (supplier, currency, dates, payment terms, line items)
- Upload PDF → auto-fill form RFQ (customer, contacts, location, line items)
- Supplier baru dibuat dari invoice → currency pre-fill dari invoice (bukan hardcode USD)
- AI extraction lebih tahan timeout (60s, 5 retries)

