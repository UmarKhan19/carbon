# Incremental Git Commits for Recent Changes

## Tasks

- [x] Commit 1: Fix passkey type-casting in `packages/auth/src/services/passkey.server.ts`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] (Skipped) Commit 2: Update local dev environment configurations, redis port, and bindings (kept local). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] Commit 3: Update document extraction schemas for RFQ fields.
- [x] Commit 4: Enhance CustomerLocation, SupplierLocation, and PurchaseInvoiceForm for auto-fill.
- [x] Commit 5: Update SalesRFQForm and new RFQ route for auto-fill and document saving.

## Review

- **Commit 1 (fix(auth))**: Corrected `Uint8Array` type-casting in passkey registration options to meet the WebAuthn standard / TypeScript expectations.
- **Commit 2 (chore(dev))**: *Skipped* per request since these are local environment changes (port, host binding, inngest URLs).
- **Commit 3 (feat(jobs))**: Expanded the document extraction schema for RFQ contact and location fields.
- **Commit 4 (feat(erp))**: Enhanced CustomerLocation, SupplierLocation, and PurchaseInvoiceForm to support better auto-filling.
- **Commit 5 (feat(sales))**: Updated SalesRFQForm and the new RFQ route to properly use the auto-filled contact and location details from PDF extraction, and associated the extracted PDF document under the corresponding Opportunity.
