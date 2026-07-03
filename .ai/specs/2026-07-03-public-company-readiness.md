# Public-Company Readiness: Compliance Gap Audit & Remediation Program

> Status: draft
> Author: Claude (Big-4-style readiness assessment), for brad@carbonos.dev
> Date: 2026-07-03
> Research: `.ai/research/public-company-compliance.md`

## TLDR

This spec is a readiness audit of Carbon's accounting platform against the requirements of a US-listed (or dual-listed) manufacturer operating in multiple countries, plus the remediation program to close the gaps. The audit assumes every existing spec is implemented as written (FX convention normalization, memo refactor, invoice/payment audit Tiers 1–2, account-ledger drill-down, work-order stitching). Even on that baseline, the assessment identifies **five findings that would be assessed at material-weakness level in an ICFR audit** — unenforceable period close, mutable/unlogged posted accounting records, absence of journal-entry approval and segregation of duties, indirect tax embedded in revenue/COGS instead of a tax liability, and financial statements that include unposted drafts with no year-end close — plus significant deficiencies (FX/consolidation completeness, numbering/dating, ITGC), GAAP capability build-outs (rev rec, leases, inventory valuation, multi-book), multi-country statutory machinery (tax engine, e-invoicing, audit-file exports), and a vendor-level assurance program (SOC 1 Type II). The remediation is phased so that the control keystones — hard close, immutable journals, JE approval — land first: they are the cheapest differentiators, the first things a SOX readiness firm tests, and the foundation every later phase posts into.

## Problem Statement

Carbon's goal is to be the accounting system a CFO adopts at seed and never leaves — through Series C, IPO readiness, and life as a public multi-national. The market evidence (research §Ecosystem) says this is winnable: companies graduate from QuickBooks/Xero at ~$5–30M revenue triggered by multi-entity consolidation, rev-rec spreadsheets, and inventory complexity (Carbon's manufacturing customers hit the inventory trigger earliest), and companies that reach NetSuite-class systems essentially never leave below $500M revenue — they IPO on them. Carbon already has unusually strong bones for its age: company groups with subsidiary hierarchies, intercompany matching/eliminations with elimination entities, IAS 21-style translation with per-account rate types, a dimension-driven GL (the modern Intacct-style architecture), manual journals with reversal-only correction intent, AR/AP settlement with tie-out RPCs, and fixed assets with book + MACRS tax depreciation.

But the audit fieldwork (nine research workstreams, 2026-07-03; inventories cited per finding below) shows the control layer that makes those bones auditable is largely missing, several GAAP-required subsystems do not exist, and nothing supports country statutory compliance. A public-company client running on today's Carbon would fail SOX 404(b) on multiple fronts in year one.

**Baseline for this audit** — the following are treated as done and their fixes are NOT re-reported as findings:

| Assumed implemented | What it resolves |
|---|---|
| `.ai/specs/2026-07-02-exchange-rate-convention-normalization.md` | GL base amounts on divide-to-base convention; phantom PPV on FX invoices; realized FX gain/loss signs; remittance currency labels; tie-out RPC rates |
| `.ai/specs/implemented/memo-refactor-plan.md` | Payment-shaped credit/debit memos with defined journal shapes |
| `.ai/runs/2026-07-02-invoice-payment-audit.md` Tier 1 + Tier 2 | AR stranding, invoice-tax-in-balance, WIP corruption fixes; remaining audit item S4 (tax payable split) is subsumed by finding MW-4 below |
| `.ai/specs/2026-07-02-account-ledger-drilldown.md` | Report drill-down + period selector |
| `.ai/specs/2026-07-02-work-order-stitching.md` | Production-side; only the WIP posting boundary touches this audit |

Findings below only cover what remains beyond that baseline. Where a finding builds on one of these, it says so.

---

## Findings

Severity scale (ICFR framing): **MW** = would likely be assessed a material weakness (reasonable possibility of material misstatement not prevented/detected); **SD** = significant deficiency; **GAP** = capability absent — becomes a deficiency the moment the client has the underlying transaction type; **CO** = company/vendor-level program, not product code.

### A. Control environment (ICFR core)

#### MW-1 — Period close cannot be enforced

**Condition.** `accountingPeriod.closedAt/closedBy` exist but **no code path ever sets them** (grep across apps/packages/migrations: reads only). `accountingPeriodStatus` enum is only `Inactive|Active` — there is no `Closed` value. The app-side guard (`accounting.service.ts:592-657`) checks `closedAt`, but the edge-function twin `functions/shared/get-accounting-period.ts` — the path taken by **every** system posting (invoices, receipts, shipments, payments, memos, production events, job close) — never checks it. Product docs state it plainly: "no hard period-close that blocks posting" (`docs/content/docs/reference/accounting.mdx`). Manual JEs accept arbitrary posting dates; system posters stamp today.
**Criteria.** Auditors test who can post to closed periods and whether close/reopen is permissioned and logged (AS 2201; NetSuite locked-vs-closed contract; SAP posting-period variants). A 10-Q close on the 40-day accelerated-filer clock is impossible if numbers move after sign-off.
**Risk.** Reported results change after management review and after filing; no cutoff assertion is supportable; restatement exposure.
**Remediation (build).** Period state machine `Open → Locked → Closed` enforced at the database layer (trigger on `journal` INSERT/UPDATE validating the target period's status — the only layer that binds service-role edge functions), with: per-module locks (AR/AP/GL) in the `Locked` state; `accounting_close` permission for lock/close and a separate override permission to post into `Locked` (never into `Closed`); reopen as an explicit, logged action that cascades to later periods; auto-created periods default `Open` only for current/future months. Close UI on the fiscal-years page plus a **close checklist** entity (ordered tasks, owners, statuses — FX revaluation, eliminations, depreciation, rev rec, reconciliation sign-offs land here in later phases).

#### MW-2 — Posted accounting records are mutable and not audit-logged

**Condition.** (a) `journal` UPDATE RLS allows updates while status is Draft **or Posted** with `WITH CHECK (true)` — any `accounting_update` user can rewrite a posted journal header (postingDate, description) via PostgREST (`20260402000000:84-92`). (b) `payment` UPDATE policy has no status condition (Posted-payment immutability is app-layer only, per the migration's own comment). (c) `purchaseInvoice` RLS DELETE checks permission but not status; Draft-only deletion is app code. (d) No trigger-level immutability anywhere on ledger tables. (e) The audit-log system is **opt-in per company (default off)**, retains 30 days hot, has a fully permissive `USING (true)` policy on its own tables, writes asynchronously through a queue (loss on pipeline failure), and its 26-entity coverage **excludes** `journal`, `journalLine`, `account`, `accountingPeriod`, `payment`, `memo`, `sequence`, `userPermission`, `apiKey`, and all approval tables. (f) `journalLine` has no `createdBy`.
**Criteria.** AS 2401 requires a complete, tamper-evident JE population with preparer/approver/timestamps; Germany GoBD requires Unveränderbarkeit; France FEC requires a sequentially complete extract on 15 days' notice; NetSuite System Notes / SAP change documents are the reference bar. One schema investment covers all four regimes (research §Pattern 1).
**Risk.** No auditor can rely on the ledger as evidence; fraud-testing analytics (backdating, off-hours, admin postings) are impossible; GoBD/FEC non-compliance in DE/FR entities.
**Remediation (build).** (1) DB triggers making posted `journal`/`journalLine`/`payment`/`memo`/`invoiceSettlement` rows immutable — the only permitted transitions are status-only (`Posted → Reversed/Voided` with linkage columns); triggers fire for service role too. (2) Add `journalLine.createdBy`; add `preparedBy`/`approvedBy` to `journal` (populated by MW-3). (3) Accounting audit coverage: extend the audit config to the excluded tables above and make audit logging **always-on and non-disablable for accounting entities** (company opt-out applies only to operational entities); write accounting audit rows **synchronously in the posting transaction** (or transactional outbox) rather than via PGMQ. (4) Lock the audit tables down: append-only policies, revoke UPDATE/DELETE, configurable retention with a floor of 7 years for accounting entities (30-day default stays for operational noise). (5) Full-population JE export (flat CSV/JSON, no row caps, preparer/approver/created/posted timestamps, source type, reversal linkage) — this single export is the SOX/FEC/SAF-T/GoBD workhorse.

#### MW-3 — No journal-entry approval, no segregation of duties, self-approval permitted

**Condition.** Manual journals go Draft → Posted with no approval step. The generic approval engine (`approvalRequest`/`approvalRule`) covers only `purchaseOrder`, `qualityDocument`, `supplier`; invoices, payments, journals, and master-data changes have none. `canApproveRequest` never excludes `requestedBy` — **self-approval of POs is possible today**. The permission model (module × CRUD) cannot express preparer ≠ approver; no SoD conflict detection exists (repo-wide grep); the sole four-eyes flag (inbound inspections) is a UI warning, not a server block. `salesOrderStatus` contains a dead `'Needs Approval'` value nothing sets.
**Criteria.** Auditors specifically test whether submitter and approver credentials match (AS 2401 fraud procedures); SAP parks journals until workflow approval with requester ≠ approver enforced; NetSuite JE approval routing is standard pre-IPO configuration; a documented SoD matrix over roles is an ITGC prerequisite.
**Risk.** Management-override risk is uncontrolled; every manual JE is a fraud-testing exception; SOX readiness assessment fails at the first control tested.
**Remediation (build).** (1) Extend `approvalDocumentType` to `journalEntry`, `payment`, `purchaseInvoice` (and wire the dead sales-order status or remove it); journal state machine becomes `Draft → Pending Approval → Posted` when a matching rule exists, with amount/account-class routing reusing `approvalRule` tiers. (2) System-enforced **no-self-approval** in `canApproveRequest` (server-side, all document types, config flag defaulted on). (3) `journal.preparedBy`/`approvedBy` stamped from the request. (4) SoD v1 = detective: a conflict-matrix report over `userPermission` (canonical conflicts: vendor-create + payment-post; JE-create + JE-approve; sequence-edit + posting) plus a point-in-time **user access report** (per-user permissions by company, with grant history from the audit log) for quarterly access reviews. Preventive SoD enforcement is a later phase.

#### MW-4 — Indirect tax is misstated: no tax liability posting, no tax engine

**Condition.** Tax is a flat `taxPercent` per line defaulted from the counterparty. At posting, `post-sales-invoice` credits the **tax-inclusive** amount to the sales account; `post-purchase-invoice` folds tax into item cost. The seeded tax payable accounts (2210/2220/2230) and `accountDefault.salesTaxPayableAccount`/`purchaseTaxPayableAccount`/`reverseChargeSalesTaxPayableAccount` are referenced by **no posting function**. `taxExempt` and exemption certificates are captured but never enforced. No tax code/rate/jurisdiction tables, no returns, no withholding, no engine integration. (Flagged as product decision S4 in the 2026-07-02 invoice/payment audit; this finding scopes the full fix.)
**Criteria.** ASC 606 excludes amounts collected on behalf of third parties from revenue; VAT/GST regimes require output/input tax in dedicated accounts to produce returns; US sales tax requires jurisdiction-level determination (typically delegated to Avalara/Vertex — the ERP builds the hook, research §Pattern 7).
**Risk.** Revenue overstated by output tax and inventory/COGS overstated by recoverable input tax in every taxed jurisdiction — a direct, recurring misstatement; no VAT return is producible; US nexus compliance impossible.
**Remediation (build).** Tax subledger: `taxCode` (group-scoped) → `taxRate` (jurisdiction, validity dates, recoverable %), `taxRegistration` per company (multiple concurrent registrations, fiscal-representative fields), line-level `taxCodeId` replacing bare percent (percent kept as derived display); posting splits tax to payable/receivable accounts with reverse-charge self-assessment (both sides) support; exemption enforcement from `customerTax.taxExempt` + certificate validity; a **tax-calculation hook interface** at document pricing/posting so an external engine (Avalara/Vertex/Anrok) can own determination per registration; tax box mapping + return extract per registration as the v1 "returns" story. Withholding tax on AP as a follow-on.

#### MW-5 — Reported financial statements are not closeable or complete

**Condition.** (a) Balance RPCs and the drill-down view **intentionally include Draft journals** — unposted drafts appear in the trial balance, balance sheet, and income statement. (b) No year-end close exists: nothing rolls P&L into retained earnings (`retainedEarningsAccount` is config-only; net income is a synthetic display row). (c) Double-entry balance is not enforced at the DB; manual-JE and payment builders assert it in app code, but invoice/receipt/shipment/production posters have no balance assertion at all. (d) No cash flow statement, no comparative-period columns, no report exports.
**Criteria.** A trial balance that includes unapproved drafts cannot be IPE (information produced by the entity) for an audit; auditors roll the JE population forward from opening to closing TB — impossible without a year-end close; a balanced-journal constraint is table stakes in every reference system.
**Risk.** The statements management reviews are not the statements the ledger supports; equity is wrong after year one (no RE roll-forward); cash flow statement — a required primary statement — cannot be produced.
**Remediation (build).** (1) Reports default to **Posted-only**, with an explicit "include drafts" preview toggle (decision recorded below). (2) DB-level balance enforcement: deferred constraint trigger asserting Σ(signed amounts) = 0 per journal at COMMIT (0.01 tolerance), covering every poster including edge functions. (3) Year-end close routine: generated closing journal per company zeroing income-statement accounts to `retainedEarningsAccount` at fiscal year end, permissioned, reversible only by reopening the year; balance-sheet "Net Income" row then reads current-year-only. (4) Reporting completeness: indirect-method cash flow statement (accounts get a `cashFlowCategory` tag, per NetSuite's cash-flow rate-type precedent), comparative prior-period/prior-year columns on TB/BS/IS, CSV export on all report pages, and budget-vs-actual + account-level flux (period-over-period with threshold highlighting) once budgets exist (GAP-8).

### B. Significant deficiencies

#### SD-1 — Numbering and dating are not audit-grade

**Condition.** `journalEntryId` comes from the app-level `sequence` table — not gapless (failed transactions leave holes), and the `sequence` table is **editable by any `settings_update` user** (next-number can be rewound → duplicate/reused numbers), with sequence changes not audit-logged. Invoice numbering likewise has no legal-series concept (gapless per series is law across most of the EU/LatAm; Portugal additionally requires ATCUD + hash chaining). Manual-JE backdating is unrestricted (period close will bound it, but no backdating alert exists).
**Remediation.** Gapless posting-time numbering: assign the final `journalEntryId` (and legal invoice numbers) inside the posting transaction from a DB-serialized per-company (per-series) counter; make `sequence` rows for accounting documents immutable-after-first-use and audit-logged; add `legalSeries` on customer-facing documents (per entity + country + document type) as the substrate for F-D2 e-invoicing; flag backdated entries (postingDate < createdAt − n days) in the JE export.

#### SD-2 — ITGC gaps: authentication, deprovisioning, environments

**Condition.** No MFA and no SAML/OIDC SSO (magic link + Google/Azure OAuth + passkeys only); deactivation does not revoke live sessions (no `auth.admin.signOut`); no idle timeout; API keys impersonate their creator and are excluded from audit logging; `getCarbonServiceRole()` bypass is convention-gated; deploys go main → prod with no staging tier; `pnpm audit` non-blocking; no CODEOWNERS.
**Remediation.** MFA enforcement policy per company (TOTP + passkey step-up), SAML/OIDC SSO (enterprise gate), session revocation on deactivate + admin session listing, API-key usage audit events, staging environment in the deploy pipeline, CODEOWNERS for `packages/database` + posting functions. (Vendor-side SOC 1 controls in CO-1 depend on these.)

#### SD-3 — FX completeness (beyond the convention-normalization spec)

**Condition.** With the FX spec implemented, realized FX and base-amount magnitudes are correct — but: `journalLine` carries **no transaction currency or amount** (base only), so remeasurement, dual-currency display, and FEC/SAF-T (which require both) are impossible; there is **no unrealized FX revaluation** of open AR/AP/bank at period end (comment in `build-payment-journal.ts` confirms FX only realizes at settlement); historical-rate memory is a single value per currency (no per-transaction historical rates for equity/assets).
**Criteria.** ASC 830/IAS 21 require period-end remeasurement of monetary items with gains/losses in income; SAP FAGL_FCV / NetSuite "Revalue Open Foreign Currency Balances" is a standard close task (research §Pattern 5).
**Remediation.** (1) Add `currencyCode` + `transactionAmount` (+ `exchangeRate`) to `journalLine`, populated by every poster (base `amount` stays authoritative). (2) Unrealized-revaluation close task: revalue open FX invoices, unapplied payments/memos, and FX bank-GL balances at the period-end rate, posting auto-reversing entries to new `unrealizedExchangeGain/LossAccount` defaults; runs from the close checklist (MW-1). (3) Historical-rate table keyed by account/transaction where `consolidatedRate = 'Historical'` demands it.

#### SD-4 — Consolidation correctness and completeness

**Condition.** `exchangeRateHistory` — the source of closing/average rates for `translateTrialBalance` — has **no writer**; unless rows are inserted by hand, translation silently falls back to rate 1, so translated/consolidated statements for any multi-currency group are wrong today. CTA is a display-time plug applied to hardcoded account number "3200" (the `currencyTranslationAccount` default exists but is unread — violates the repo's own control-account lesson); CTA never posts or rolls forward. Translated income statements are life-to-date (the translate RPC lacks `netChange`, flagged in the drill-down spec). IC matching is exact-amount with no tolerance and no FX-difference handling; consolidation is 100%-summation (no ownership %/NCI); no group close lock.
**Remediation.** (1) Extend the daily exchange-rate job to append `exchangeRateHistory` (closing) and derive period averages; surface rate-coverage warnings on consolidated reports instead of the silent rate-1 fallback. (2) Post CTA to the configured `currencyTranslationAccount` (resolved by id) as part of group close; CTA rolls forward as a real balance. (3) Teach `translateTrialBalance` `netChange`. (4) IC matching tolerance + FX-difference posting to a dedicated difference account; IC document mirroring (PO↔SO) and netting later. (5) Ownership %/NCI deferred until sub-100% subsidiaries are a real customer need (SAP-tier; NetSuite also does 100% summation).

#### SD-5 — Master-data change controls

**Condition.** `accountDefault` (the entire GL account resolution layer), payment terms, and counterparty tax/banking data are editable by anyone with module update permission, with most of it outside audit-log coverage; there are no vendor bank details at all yet (F-C7 adds them) — but when payment execution arrives, unaudited bank-detail changes are the #1 fraud vector.
**Remediation.** Audit-log coverage (MW-2) for `accountDefault`, `paymentTerm`, `customerTax`/`supplierTax`, sequences; approval-workflow option on supplier bank-detail changes (extends MW-3's engine) the moment bank details exist; change-alert notifications to accounting owners.

### C. GAAP capability build-outs

#### GAP-1 — Revenue recognition (ASC 606 / IFRS 15)

Revenue is recognized in full at invoice posting; the seeded Deferred Revenue account has no writer; no schedules, obligations, POC, milestone/progress billing, or customer deposits. For Carbon's manufacturing base, the v1 cut that matters is: **deferred revenue schedules** (invoice → schedule → monthly recognition journal via close checklist), **customer deposits/prepayments** (liability until shipment), and **over-time recognition for long-lead contracts** (cost-to-cost POC using the job-costing data Carbon already has — a genuine differentiation vs the AI-GL startups, which have no cost basis to recognize against). SSP allocation across bundled obligations is deferred until product mix demands it. Contract asset/liability rollforward report ships with v1 (auditors ask for it first).

#### GAP-2 — Leases (ASC 842 / IFRS 16)

Nothing exists (verified: zero code hits). Build a lease subledger inside fixed assets: lease master (payments, term, IBR), PV computation, ROU asset + liability with effective-interest schedules, operating vs finance treatment (and IFRS 16 single-model when multi-book lands — GAP-6), monthly JEs from the close checklist, maturity-analysis disclosure export. Point-tool import (FinQuery JE upload) is the interim path via F-E1's JE import.

#### GAP-3 — Inventory valuation completeness (manufacturing credibility core)

Standard costing is enum-only (`standardCost` has no write path — Standard items cost at $0); no LCNRV write-downs; the `Revaluation` costLedgerType and `inventoryAdjustmentVarianceAccount`/overhead/lot-size/subcontracting variance accounts are dead schema; quantity adjustments post no GL; overhead absorption stops at estimates; no landed cost. Remediate in order: (1) wire standard cost input + actual-vs-standard variance posting (the accounts already exist), (2) inventory revaluation document (posts `Revaluation` cost-ledger rows + GL), (3) LCNRV write-down run with reversal support **per book** (US GAAP: no reversal; IAS 2: reversal required — first concrete consumer of GAP-6 multi-book), (4) GL posting for quantity adjustments, (5) overhead absorption to GL with `overheadVarianceAccount`, (6) landed cost (duty/freight/brokerage allocation onto receipts).

#### GAP-4 — Fixed assets completeness

Depreciation runs are entirely manual (no scheduled poster — a close-calendar risk); no impairment; no CIP; disposal lacks proceeds-based gain/loss (docs admit it); no component depreciation (IAS 16 requires it). Remediate: scheduled monthly depreciation proposal (Inngest) feeding an approvable Draft run; disposal-with-proceeds flow (link to sales invoice, gain/loss = proceeds − NBV); impairment posting (write-down account exists); CIP asset class + capitalization flow from job/PO costs; components as child assets (IFRS books later).

#### GAP-5 — Accruals, deferrals, recurring journals

Only GR/IR exists. Build: prepaid-expense schedules (AP invoice line → amortization schedule → monthly journal; `prepaymentAccount` exists unused), recurring journal templates, and auto-reversing accrual JEs (flag on manual JE: post, auto-reverse day 1 next period) — all executed from the close checklist.

#### GAP-6 — Multi-GAAP parallel books

Single implicit book today. Per research (§Pattern 2), a book/ledger dimension is the single hardest retrofit in this list and is required the day the first foreign subsidiary files statutory accounts. Remediate in two steps: **now** (cheap): add `journal.bookId` defaulting to a seeded `PRIMARY` book per company group, indexes and RPC filters included, so every future poster and report is book-aware from day one; **later**: adjustment-only books (NetSuite pattern — deltas on top of primary, first consumers: IFRS 16 leases, IAS 2 NRV reversals, statutory depreciation), book-specific depreciation per asset, and book columns in reporting UI.

#### GAP-7 — Segment reporting (ASC 280) and dimension enforcement

Dimensions exist and system posters populate them, but the `required` flag is client-side only and there is no segment concept. Remediate: server-side enforcement of required dimensions at posting; a reserved **Segment** dimension derived from item/cost-center master data (SAP pattern: users never key segments); segment columns in the financial reports; ASU 2023-07 significant-expense breakdown by segment.

#### GAP-8 — Budgets, flux, and close analytics

No budget entity anywhere. Build: `budget` (company, fiscal year, book) + `budgetLine` (account, period, dimension values, amount), CSV import, budget-vs-actual report, and account-level flux report (PoP/YoY with threshold flags + comment capture — the management-review-control evidence auditors test). Deep FP&A stays ecosystem (research: Adaptive/Pigment).

#### GAP-9 — Bank subledger

No bank account master (payments point at bare GL accounts), no reconciliation, no statement import. Build: `bankAccount` master (per company, currency, GL link, masked external identifiers), manual + CSV/CAMT/BAI2 statement import, reconciliation workspace (match statement lines to payments/journals, reconciled flags, adjustment JEs), close-checklist task "bank rec complete per account". Bank feeds (Plaid et al.) and payment execution rails stay ecosystem/EE.

### D. Multi-country statutory

#### GAP-D1 — Country tax returns and filings

On top of MW-4's tax subledger: VAT return box-mapping per registration with a filing extract, EC Sales List and Intrastat extracts (commodity codes/weights already partially exist via EORI work), UK MTD digital-links-compliant VAT API submission, AP withholding tax with treaty rates and certificates. US sales-tax content and filing stays with the external engine (Avalara/Vertex) behind MW-4's hook.

#### GAP-D2 — E-invoicing and legal invoice formats

Zero e-invoicing code exists; mandates are imminent for any EU footprint (France issue-mandate Sept 2026, Poland KSeF Feb/Apr 2026, Germany issue 2027–28, ViDA intra-EU 2030). Build the **adapter framework, not fifty adapters**: EN 16931 semantic invoice model generated from Carbon invoices; format renderers starting with Peppol BIS 3.0 / Factur-X / XRechnung; a clearance/submission state machine per document (Pending → Submitted → Accepted/Rejected → Corrected) with retry and rectification-document flows; inbound structured-invoice receipt into AP; country routing via a middleware partner (Avalara/Sovos/Pagero pattern) behind one internal interface; legal numbering series from SD-1. Clearance-model countries (Italy SDI, Mexico CFDI, Brazil NF-e, India IRP) come per customer demand via the same framework.

#### GAP-D3 — Statutory audit files, statutory COA, retention

Build on MW-2's JE export: **France FEC** (18-field prescribed layout — near-free once journal data is complete), **SAF-T** country flavors (PT/PL/NO/RO) generated from GL/AR/AP/assets/inventory, GoBD-compliant data access export. Statutory chart-of-accounts support via an **alternative account number mapping table** per country (SAP three-layer pattern — never fork the group COA); statutory reports render through the mapping. Record retention: accounting archives (audit-log + JE exports + invoice originals) in WORM-configured storage with per-country retention ≥10 years and legal hold.

### E. Ecosystem integration surface

#### GAP-E1 — The feeds every bolt-on needs

Public-company customers will bring BlackLine/FloQast, Workiva, Carta, provision tools, payroll, and expense systems (research §Ecosystem: even NetSuite doesn't build these). Carbon must expose: (1) **TB API** — balances by entity/book/period/dimension, stable account identifiers; (2) **JE-population export API** (MW-2's export, programmatic); (3) **controlled JE import API** — validated, approval-workflow-aware, period-status-aware, idempotent, audit-stamped (this is how Carta SBC entries, payroll summaries, lease JEs, and provision adjustments land); (4) MW-4's tax-calculation hook; (5) webhooks for posting/close events. Most of this can ride the existing MCP/API-key infrastructure once approval + period gates exist.

### F. Vendor-level program (company, not code)

#### CO-1 — Assurance and operations

No SOC 1/SOC 2/ISO 27001 posture exists or is claimed; DR is explicitly "not disaster recovery" (docs); no staging tier. Public-company customers' auditors **rely on the vendor's SOC 1 Type II** — without it every customer takes a control gap (research §6). Program: SOC 2 Type II first (procurement gate, ~2 quarters of evidence), SOC 1 Type II covering posting-integrity control objectives + ITGCs (needs SD-2's environment work as prerequisites), ISO 27001 for EU procurement, PITR/DR with stated RPO/RTO, and eventually country invoicing-software certifications (Portugal AT, France PDP) gated on GAP-D2 market entry. Timeline reality: a customer IPO-ing in 2 years needs Carbon's SOC 1 period started ~now.

---

## Proposed Solution — Remediation Program

Phased so control keystones land first; each phase is independently shippable and PR-sized specs get cut from it per module.

| Phase | Contents (findings) | Theme |
|---|---|---|
| **0 — Ledger integrity** | MW-1 (period state machine, DB enforcement), MW-2 (immutability triggers, accounting audit coverage, JE export v1), MW-3 (JE/payment/invoice approval + no-self-approval, access report), MW-5.2/5.3 (Posted-only reports, DB balance constraint), SD-1 (gapless numbering, sequence lockdown), GAP-6 step 1 (`bookId` column), SD-3.1 (`journalLine` currency columns) | Make the ledger trustworthy. Schema seeds for everything later. |
| **1 — Close & FX** | MW-1 (close checklist entity), MW-5.3 (year-end close), SD-3.2 (unrealized FX revaluation), SD-4.1–.3 (rate-history feed, posted CTA, translated netChange), MW-5.4 (cash flow, comparatives, exports), GAP-4.1 (scheduled depreciation), GAP-5 (accruals/prepaids/recurring JEs) | A real monthly + annual close on a calendar. |
| **2 — Tax** | MW-4 (tax subledger, engine hook), GAP-D1 (VAT returns, ECSL/Intrastat, withholding) | Correct statements in every taxed jurisdiction. |
| **3 — Subledger completeness** | GAP-9 (bank master + reconciliation), GAP-1 (deferred revenue, deposits, POC v1), GAP-3 (standard cost, revaluation, LCNRV, adjustment GL), GAP-4 (impairment, CIP, disposal proceeds), SD-5 (master-data controls incl. vendor bank details) | Every balance-sheet line has a subledger that ties. |
| **4 — Multi-book & statutory** | GAP-6 (adjustment books), GAP-2 (leases), GAP-D3 (FEC/SAF-T/statutory COA/retention), GAP-D2 (e-invoicing framework), GAP-7 (segments, dimension enforcement) | Multi-country statutory + dual-GAAP. |
| **5 — Scale-out** | SD-4.4–.5 (IC tolerance/netting/mirroring, NCI), GAP-8 (budgets/flux), GAP-E1 (TB/JE APIs, JE import), SD-2 remainder (SSO/MFA enterprise) | Consolidation maturity + ecosystem surface. |
| **∥ — Company program** | CO-1 (SOC 2 → SOC 1 → ISO 27001, staging, DR) | Runs parallel from Phase 0. |

### Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Where period close is enforced | DB trigger on `journal` (+ posting functions check first for good errors) | Edge functions run as service role and bypass RLS; triggers are the only layer that binds every writer (MW-1 evidence) |
| 2 | Posted-record immutability mechanism | Status-transition-only triggers on posted rows, applying to service role | Same reasoning; RLS alone demonstrably failed (`WITH CHECK (true)` gaps) |
| 3 | Journal approval | Extend existing `approvalRule`/`approvalRequest` engine | Engine already has tiers/amounts/groups; per-document ad-hoc approvals are the anti-pattern; SAP parked→posted is the model |
| 4 | Self-approval | Blocked server-side, all approval document types, default on | AS 2401 auditor test #1; one-line check in `canApproveRequest` |
| 5 | Multi-book placement | `journal.bookId` (header-level), seeded `PRIMARY` book, column lands Phase 0 | Header-level matches NetSuite books/SAP ledger-group posting; line-level splitting not needed; deferring the column is the expensive retrofit (research §Pattern 2) |
| 6 | Per-line currency | `journalLine.currencyCode/transactionAmount/exchangeRate` alongside base `amount` | SAP parallel-currency pattern; required by FEC/SAF-T and remeasurement; base stays authoritative |
| 7 | Draft journals in reports | Posted-only default + explicit include-drafts toggle | IPE integrity; preserves the preview workflow the current behavior served |
| 8 | Tax model | Native tax codes/rates/registrations + external-engine hook for US sales tax | SAP procedure/NetSuite SuiteTax consensus; never build US rate content (research §Pattern 7) |
| 9 | E-invoicing | EN 16931 core + adapter framework + middleware partner for clearance networks | SAP DRC pattern; ViDA makes EN 16931/Peppol the safe bet; per-country direct integrations don't scale |
| 10 | CTA | Posted to `currencyTranslationAccount` resolved by id at group close | Display-plug doesn't roll forward; hardcoded "3200" violates the repo's own control-account lesson |
| 11 | Rev-rec v1 scope | Deferred revenue + deposits + cost-based POC; SSP allocation deferred | Manufacturing customer need; POC leverages job costing Carbon uniquely has; NetSuite ARM full model is a later tier |
| 12 | Recs/SEC/equity/provision/payroll | Never build; expose GAP-E1 feeds | Even NetSuite doesn't build these (research §Ecosystem) |
| 13 | Multi-tenancy heuristic | All new tables: `companyId` + composite PK + `id('prefix')`; tax codes/books group-scoped like `account`/`currency` | Matches company-group master-data pattern (`20260228023426`) |
| 14 | Service shape / RLS / permissions / forms / module layout | Per repo conventions; new close/tax/bank UI in `modules/accounting` (+ `modules/invoicing` where document-side); `requirePermissions` with `accounting_*` scopes; new `accounting_close` permission action needs schema + claims work | Heuristics 2–6 of the spec checklist; note: adding a permission *action* beyond CRUD touches `packages/auth` — flagged in Risks |
| 15 | Backward compatibility | Additive schema only; period enforcement + Posted-only reports are behavior changes shipped behind company-level activation (see Open Questions on the accounting switch) | FROZEN surfaces unaffected; posting-function changes ship as one coordinated PR per the FX-spec precedent |

## Data Model Changes (representative sketches, Phase 0–1)

```sql
-- Period state machine (MW-1)
ALTER TYPE "accountingPeriodStatus" ADD VALUE 'Locked';
ALTER TYPE "accountingPeriodStatus" ADD VALUE 'Closed';
ALTER TABLE "accountingPeriod"
  ADD COLUMN "lockedModules" TEXT[] DEFAULT '{}',        -- e.g. {'AR','AP'}
  ADD COLUMN "reopenedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "reopenedBy" TEXT REFERENCES "user"("id");
-- trigger: journal INSERT/UPDATE must reference a period whose status permits the
-- writer (Open; Locked only with accounting_close_override; Closed never).

-- Journal control columns (MW-2/MW-3, GAP-6, SD-3)
ALTER TABLE "journal"
  ADD COLUMN "bookId" TEXT NOT NULL DEFAULT 'PRIMARY',   -- FK "accountingBook", seeded per group
  ADD COLUMN "preparedBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN "approvedBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN "approvalRequestId" TEXT;
ALTER TABLE "journalLine"
  ADD COLUMN "createdBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN "currencyCode" TEXT,                        -- transaction currency
  ADD COLUMN "transactionAmount" NUMERIC(19,4),          -- amount in that currency
  ADD COLUMN "exchangeRate" NUMERIC(20,8);
-- trigger: when journal.status = 'Posted', only status-transition updates allowed
-- (Posted -> Reversed with reversedById); journalLine frozen entirely; fires for service role.

CREATE TABLE "accountingBook" (
    "id" TEXT NOT NULL DEFAULT id('bk'),
    "companyGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Primary',              -- Primary | Adjustment
    "accountingPrinciple" TEXT,                          -- US-GAAP | IFRS | Local | Tax
    "baseBookId" TEXT,                                   -- for Adjustment books
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "accountingBook_pkey" PRIMARY KEY ("id", "companyGroupId")
);

-- Close checklist (MW-1, Phase 1)
CREATE TABLE "closeTask" (
    "id" TEXT NOT NULL DEFAULT id('clt'),
    "companyId" TEXT NOT NULL,
    "accountingPeriodId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,           -- Manual | FxRevaluation | Depreciation | Eliminations | RevRec | BankRec | YearEndClose
    "sortOrder" INTEGER NOT NULL,
    "dependsOnId" TEXT,
    "assigneeId" TEXT REFERENCES "user"("id"),
    "status" TEXT NOT NULL DEFAULT 'Open',  -- Open | Done | Skipped
    "completedBy" TEXT REFERENCES "user"("id"),
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "evidenceJournalId" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "closeTask_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "closeTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Tax subledger core (MW-4, Phase 2) — sketch
CREATE TABLE "taxCode" ( -- group-scoped like account/currency
    "id" TEXT NOT NULL DEFAULT id('tax'),
    "companyGroupId" TEXT NOT NULL,
    "code" TEXT NOT NULL, "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,               -- Output | Input | ReverseCharge | Exempt | ZeroRated
    "payableAccountId" TEXT, "receivableAccountId" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"), "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "taxCode_pkey" PRIMARY KEY ("id", "companyGroupId")
);
-- + taxRate (taxCodeId, jurisdiction, percent, validFrom/To, recoverablePercent)
-- + taxRegistration (companyId, country, registrationNumber, scheme, fiscalRep fields)
-- + journalLine tax linkage via taxCodeId on document lines; audit columns as per template.
```

RLS per conventions (`get_companies_with_employee_permission('accounting_*')`); all new tables audit-logged from day one. Full DDL per phase lands in that phase's implementation spec.

## API / Service Changes

Phase 0–1 (representative): period close/lock/reopen actions + `getOrCreateAccountingPeriod` unification (edge + app share one status-checking implementation); `postJournalEntry` gains approval-state checks; `canApproveRequest` self-approval block; posting edge functions populate `journalLine` currency columns + `preparedBy`; JE-population export route (`/x/accounting/exports/journal-entries`) + service; year-end close service + route; FX revaluation edge function; exchange-rate job extended to write `exchangeRateHistory`; consolidation service reads `currencyTranslationAccount` by id and posts CTA. Later phases per their specs.

## UI Changes

Phase 0–1: period management on the fiscal-years page (lock/close/reopen with confirmation + reason); journal-entry approval states in `JournalEntryForm` + approval inbox reuse; "include drafts" toggle on report filter bars; close checklist workspace (new route `x+/accounting+/close.tsx`); comparative columns + CSV export on TB/BS/IS; cash flow statement page; JE export page; access-review report under settings/users. Later phases per their specs.

## Acceptance Criteria

Phase 0 (the ICFR keystones — each maps to an auditor test):

- [ ] Posting any document (via UI **and** via each posting edge function) into a `Closed` period fails with a clear error; into `Locked` fails without the override permission; the attempt is audit-logged.
- [ ] Closing a period requires `accounting_close`; reopening requires the same, records who/when/why, and cascades reopen to all later closed periods.
- [ ] A posted journal's header and lines cannot be modified via PostgREST with any user role, including a direct service-role UPDATE — only `Posted → Reversed` transitions succeed.
- [ ] With an approval rule active, a manual journal cannot reach `Posted` without a second user's approval; the preparer attempting to approve their own entry is rejected server-side; `preparedBy`/`approvedBy` appear on the journal and in the JE export.
- [ ] The JE export for a fiscal year contains every journal line (manual + all system source types), reconciles opening TB + export = closing TB per account, and includes preparer, approver, createdAt, postedAt, source type, and reversal linkage on every row.
- [ ] An unbalanced journal insert (Σ signed amounts ≠ 0) is rejected at COMMIT regardless of which code path wrote it.
- [ ] Trial balance/BS/IS show Posted-only by default; the drafts toggle reproduces today's numbers.
- [ ] Journal and legal-document numbering shows no gaps across a simulated posting-failure test; editing a used sequence is rejected and logged.
- [ ] Changes to `journal`, `account`, `accountingPeriod`, `payment`, `sequence`, and `userPermission` appear in the audit log with actor + before/after, with audit logging on regardless of the company toggle.

Phase 1 spot checks: year-end close zeroes IS accounts into retained earnings and the next year's BS needs no synthetic net-income plug for prior years; FX revaluation posts and auto-reverses; consolidated report of a two-currency group with no manual rate entry uses real rates (and warns if history is missing) with CTA posted to the configured account. Later phases define theirs in their specs.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Immutability/period triggers break existing posting flows (all posters mutate journals today during void/reverse) | High | Inventory every writer first (the posting functions are enumerable); allow status-transition writes; ship behind a per-company activation with the golden-master posting tests extended |
| Gapless posting-time numbering serializes posting throughput per company | Med | Per-company (not global) advisory-lock counter; measure; documents keep draft IDs until post |
| New `accounting_close` permission action doesn't fit the module×CRUD claims model | Med | Prototype in `packages/auth` early Phase 0; fallback: model close as a sub-module (`accountingClose_update`) |
| Synchronous audit writes slow posting hot paths | Med | Same-transaction insert is one row per change; benchmark; outbox pattern as fallback — never fire-and-forget for accounting entities |
| Posted-only reports change numbers customers currently see | Med | Release note + drafts toggle; tie-outs unaffected (they already reconcile to control accounts) |
| Behavior changes vs the "accounting is a switch" positioning confuse existing users | Med | All Phase-0 controls activate at a company-level cutover event (see Open Questions) |
| Scope: this program is quarters of work competing with product roadmap | High | Phases are independently valuable; Phase 0 alone is a marketable "SOX-ready controls" release; later phases gate on customer geography/stage |

## Open Questions

> 🛑 HARD STOP: Do not proceed with implementation until these are answered.

- [ ] **Does "accounting is a switch" survive, and what is the activation contract?** Proposal: keep the switch for onboarding, but make enabling a one-way, dated **activation event** that requires an opening-balance journal, locks base currency/fiscal settings, and turns on all Phase-0 controls. Without deciding this, period enforcement and immutability have no clean adoption story for existing companies. *(Product positioning + migration design.)*
- [ ] **Immutability vs service role:** triggers that also bind the service role will break any internal tooling that "fixes" journals directly. Is there any sanctioned direct-fix path today that needs a controlled replacement (logged admin repair function), or do we accept reversal-only absolutely? *(Determines the trigger design and the ops runbook.)*
- [ ] **Approval scope at launch:** journals only, or journals + payments + purchase invoices in one release? Payments without bank details are GL-recording only today — is payment approval premature before GAP-9/SD-5 land? *(Sequencing inside Phase 0.)*
- [ ] **Gapless numbering domain:** per company per year (`JE-2026-...` resets annually, SAP-style) or continuous per company? And do legal invoice series get their own table in Phase 0 (SD-1) or wait for GAP-D2? *(FEC/SAF-T validators check sequence semantics; changing later is a restatement-grade migration.)*
- [ ] **Draft journals in reports:** is there a workflow that depends on drafts appearing in balances (e.g., preview-before-post review), or was inclusion incidental? Flipping the default is easy; knowing who relied on it is not. *(MW-5.)*
- [ ] **Rev-rec v1 cut:** confirm deferred revenue + deposits + cost-based POC (and explicitly defer SSP/multi-element allocation). Wrong cut here is the most expensive product mistake in the program. *(GAP-1; needs customer-contract evidence.)*
- [ ] **Unrealized FX method:** auto-reverse next period (simpler, SAP default) vs delta valuation (no reversal noise, harder)? *(SD-3; affects journal volume and report readability.)*
- [ ] **E-invoicing middleware partner vs direct:** which markets do current + 18-month-pipeline customers actually operate in? France Sept 2026 is the first hard deadline that could bite a customer; partner selection (Avalara/Sovos/Pagero) determines the adapter interface. *(GAP-D2; commercial + architectural.)*
- [ ] **SoD preventive vs detective for v1:** detective conflict reporting is Phase-0-cheap; preventive enforcement (block conflicting grants) touches the permission model. Is detective + documented mitigating controls acceptable for the first SOX-ready release (it is for most auditors)? *(MW-3.)*
- [ ] **SOC 1 timing and scope:** which control objectives does Carbon commit to in the first SOC 1 (posting integrity, depreciation calc, costing calc?), and does the company start the SOC 2 evidence period this quarter? Product must freeze the relevant control surfaces during the audit period. *(CO-1; company-level decision with product implications.)*
- [ ] **Book scoping:** `accountingBook` sketched group-scoped (like `account`) — but statutory books are per legal entity (a German subsidiary's HGB book is meaningless group-wide). Group-scoped definitions with per-company enablement, or company-scoped books? *(GAP-6; decide before the Phase-0 `bookId` column ships.)*

## Changelog

- 2026-07-03: Created from the public-company readiness assessment (9 research workstreams: accounting core, multi-entity/FX, controls/ITGC, domain subledgers, repo baseline, NetSuite, SAP, regulatory inventory, ecosystem). Research: `.ai/research/public-company-compliance.md`.
