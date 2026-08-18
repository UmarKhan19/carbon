# Issue #1005 — Settlement balances in document summaries

**Spec:** `.ai/specs/2026-08-18-order-invoice-balance-summaries.md`

Base: `upstream/main` at `953fb47a091d43b790aebe260db99f397de1f506`

## Plan

- [x] Add a narrow invoicing settlement aggregation helper and focused tests for authoritative `totalAmount - balance`, deduplication, currency exclusion, invoice-specific exchange rates, purchase/sales equivalent cases, and empty inputs.
- [x] Update Sales Order linked-invoice loaders to stay batched/deduplicated, explicitly scope by `companyId`, select `totalAmount`, `balance`, `currencyCode`, and `exchangeRate`, and return total/paid/balance plus settlement state.
- [x] Add the equivalent company-scoped, batched Purchase Order linked purchase-invoice loader flow.
- [x] Render Total / Amount Paid / Balance Remaining in Sales Order and Purchase Order summaries while preserving Sales Order Invoiced Amount and existing currency presentation.
- [x] Add authoritative settlement rows to Sales Invoice and Purchase Invoice summaries without changing existing local line/shipping calculations.
- [x] Run targeted tests, relevant sales/purchasing/invoicing tests, ERP typecheck, and relevant lint/check commands; inspect only issue-scoped failures.

## Constraints

- No migrations, generated DB type edits, payment/settlement behavior changes, FX architecture changes, allocation policy, polling, commit, push, PR, or GitHub activity.
- Use invoice view `totalAmount` + `balance` as the same-source pair; derive paid as `totalAmount - balance`.
- Preserve whole-linked-invoice semantics and existing currency-mismatch exclusion behavior.
