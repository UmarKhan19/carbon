# Accounting Module

Chart of accounts, journal entries, general ledger, fiscal periods, currencies, payment terms, cost centers, dimensions, financial reporting (trial balance, balance sheet, income statement), fixed assets with depreciation, intercompany transactions, and external accounting sync (Xero).

## Key Domain Concepts

- **Chart of Accounts** — hierarchical account tree. Accounts have: `class` (Asset/Liability/Equity/Revenue/Expense), `incomeBalance` (Balance Sheet/Income Statement), `accountType` (Bank, AR, AP, Inventory, Fixed Asset, etc.). Group accounts contain children; ledger accounts post transactions.
- **Journal Entries** — double-entry bookkeeping. Each entry has balanced debit/credit lines. Lines can carry dimensions and cost center allocations.
- **Fiscal Year Settings** — configurable start month for fiscal and tax years. Accounting periods are auto-created.
- **Dimensions** — analytical tags on journal lines (e.g., Project, Region). Each dimension has values; lines can carry multiple dimension assignments.
- **Cost Centers** — hierarchical organizational units for cost allocation.
- **Fixed Assets** — capital assets with depreciation tracking. Supports straight-line, declining balance, and MACRS methods. Depreciation runs generate journal entries.
- **Intercompany** — transactions between companies in a group. Matching and elimination entries for consolidation.
- **Multi-Currency** — exchange rates, consolidated rate types (Average/Current/Historical), and balance translation for multi-company groups.
- **Net Income** — computed equity line on balance sheet (never a posted account). Uses synthetic `NET_INCOME_ACCOUNT_ID`.

## Safety

### Always
- Journal entries must balance (total debits = total credits).
- Use `rootSignMultiplier` logic for root account aggregation — Assets/Revenue add, Liabilities/Equity/Expense subtract.
- Scope by `companyGroupId` for chart of accounts (shared across company group) and `companyId` for transactions.
- Use `getOrCreateAccountingPeriod` to ensure periods exist before posting.

### Ask First
- Modifying the chart of accounts structure — it affects all reporting.
- Running depreciation — it creates irreversible journal entries.
- Changing fiscal year settings — impacts period boundaries.
- Intercompany eliminations — they create adjustment entries.

### Never
- Delete accounts that have posted journal entries.
- Manually create the "Net Income" account — it's a computed line (`NET_INCOME_ACCOUNT_ID`).
- Bypass double-entry balance validation on journal entries.

## Key Data Model

| Table / View | Purpose |
|---|---|
| `account` / `accounts` (view) | Chart of accounts: hierarchical, with class/type/balance |
| `journalEntry` / `journalLine` | Double-entry transactions with dimensions |
| `accountingPeriod` | Fiscal periods (auto-created) |
| `currency` / `exchangeRate` | Multi-currency support |
| `paymentTerm` | Net-30, 2/10 Net 30, etc. |
| `costCenter` | Hierarchical cost allocation units |
| `dimension` / `dimensionValue` / `journalLineDimension` | Analytical dimensions |
| `fixedAsset` / `fixedAssetClass` / `depreciationRun` | Capital asset tracking |
| `intercompanyTransaction` | Cross-company transactions |
| `defaultAccount` | Default GL mappings (AR, AP, inventory, etc.) |

## Key Service Functions

- `getChartOfAccounts`, `getAccounts`, `upsertAccount` — account management
- `getTrialBalance` — trial balance RPC
- `getFinancialStatementBalances` — balance sheet / income statement with Net Income computation
- `getJournalEntries`, `getJournalEntry` — transaction reads
- `getCurrentAccountingPeriod`, `getOrCreateAccountingPeriod` — period management
- `getCurrencies`, `getBaseCurrency`, `translateCompanyBalances`
- `getConsolidatedBalances` — multi-company consolidation
- `getCostCenters`, `getCostCentersTree` — cost center hierarchy
- `getDimensions`, `getActiveDimensionsWithValues`, `saveJournalLineDimensions`
- `getFixedAssets`, `getDepreciationRuns` — fixed asset management
- `createIntercompanyTransaction`, `runIntercompanyMatching`, `generateEliminations`

## Related Modules

- **purchasing** — purchase invoices post to AP; PO receipts create inventory GL entries
- **sales** — sales invoices post to AR; pricing uses payment terms
- **inventory** — inventory movements create GL entries via posting groups
- **items** — `itemPostingGroup` maps item categories to GL accounts
- **people** — employee-related postings (payroll integration point)

## Rules References

- `.claude/rules/accounting-sync-handlers.md` — Xero sync architecture, entity syncers, Inngest functions
