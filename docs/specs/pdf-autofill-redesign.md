# PDF Autofill — Redesign Specification

## Summary
Today's flow is **entity-resolution-centric**: a modal extracts a PDF, auto-matches what it can,
and surfaces a small "mapping grid" for the stragglers — the source document is never shown, matching
leans on the weakest signal (name), and unmatched parents drop their children. The redesign reframes
it as a **document-review intake**: the PDF sits side-by-side with the extracted fields, every field
carries confidence + provenance, resolution runs as a **dependency graph** (parent before children),
master-data creation is **guarded** (dedupe + pending state), and extracted lines become **real typed
lines** — not "Comment" lines. Nothing commits until the reviewer confirms. The goal is enterprise
**trust**: an AP clerk or estimator should be able to glance at the doc, see exactly what the AI read
and how sure it is, fix the two weak fields, and confirm.

## Research summary
See `llm/research/pdf-autofill-redesign.md`. The cross-industry consensus: (1) draft-not-committed on
ingest; (2) two-pane doc + fields review; (3) identity binds on PO#/tax-id/bank/email, *name last*;
(4) 3-band confidence (drop / autofill-but-block / flow); (5) guarded create with dedupe + non-payable
state; (6) duplicate-invoice guard is table stakes. Differentiators available to us: **click-to-source
provenance** (no AP incumbent has it), **real typed line items**, and **engineering-vs-purchasing
contact roles** (no incumbent models them; Carbon already does).

## The core reframe (the "code-judo" move)
Stop building a per-form bespoke resolver + a mapping grid for whatever didn't match. Instead build
**one reusable capture pipeline**:

```
PDF ─▶ extract (existing job) ─▶ resolve() : scored candidates + dependency graph
     ─▶ ReviewPanel (doc ‖ fields, confidence, provenance) ─▶ confirm ─▶ apply to draft form
```

`resolve()` and `<ReviewPanel/>` are **document-type-agnostic** (driven by a small per-type config:
which fields, which entities, which line target). Purchase Invoice and Sales RFQ become two configs of
one engine — and a future PO / receipt / packing-slip capture is a third config, not a third rewrite.

## Design decisions

### D1 — Resolution model: scored, multi-signal, ranked candidates
**Question:** how do we decide an extracted supplier *is* an existing supplier?
**Industry:** PO# → supplier (deterministic) > tax/VAT/TIN > bank acct > network id > remit-to >
email domain > prior-invoice history > fuzzy name (last). Surface the *matched signal*.
**Our approach:** replace the heterogeneous `ilike`/exact/substring matchers with a single
`resolveEntity(kind, extracted) → { candidates: [{id, score, signal}], best }`. Score by signal tier;
return ranked candidates, not first-match-wins. Show "matched on VAT ID" / "matched on email" in the UI.
For **purchase invoices specifically, resolve the supplier from the PO number first** when present —
the deterministic anchor and the path to 3-way matching. Requires capturing supplier `taxId` +
contact `email` as match keys (mostly present already).

### D2 — Dependency-graph resolution (fixes pain #1)
**Question:** how do contacts/locations get resolved when the parent supplier is new?
**Our approach:** model resolution as a **2-level graph**: resolve/create the **parent** (supplier/
customer) first; once its id is known (matched *or* just created), **re-resolve its children**
(contacts, locations) scoped to that parent. The review panel resolves top-down and re-runs child
resolution the instant the parent is set — so creating a brand-new supplier still lets you create its
contact + location from the same PDF in one pass. No more dropped children.

### D3 — Two-pane review (the UX pivot, fixes pain #5/#6)
**Question:** modal mapping-grid vs full review?
**Industry:** universal two-pane (doc ‖ fields) + per-field confidence; nothing auto-commits.
**Our approach:** a **review drawer/page**: left = embedded PDF (we already store it); right = the
extracted fields grouped (Supplier · Dates/Refs · Contacts/Location · Line items), each with a
**confidence chip** and a resolution control. Replace "auto-close when nothing unmatched" with a
**"Looks good — Confirm" one-click** for high-confidence full-matches (straight-through candidate) —
same speed, but the user still sees what they're confirming. The panel keeps its **own state** and
applies to the real form only on Confirm — decoupling it from the parent `ValidatedForm` and killing
the shared-field-name coupling (#6). **Differentiator:** store extraction bounding boxes so clicking a
field highlights its spot on the PDF (provenance).

### D4 — Confidence as a 3-band policy (not a single 0.85 gate)
**Industry:** `<low` drop · `mid` autofill-but-flag · `>high` flow. Configurable.
**Our approach:** keep the gate but split into bands surfaced in the UI: low → field left blank +
muted "not found"; mid → filled + **amber chip + must be acknowledged before Confirm**; high → filled +
green chip. Thresholds in company settings (we already have `EXTRACTION_CONFIDENCE_THRESHOLD`).

### D5 — Guarded master-data creation (fixes pain #3)
**Industry:** never a silent insert; dedupe first; create in non-payable/pending state.
**Our approach:** before offering "Create," run **duplicate detection** (score tax-id + name +
address/email); if a strong candidate exists, show "Looks like *X* already exists — link?" instead.
For **name-only entities (supplier/customer)** offer true **one-click create** from the doc (your
import-flow `creatableLookup` pattern) — answering your earlier question: yes, supplier/customer can be
one-click; contacts need an email (one-click only when extracted); locations stay a quick prefilled
form. New suppliers land in the existing **pending/approval** state where applicable.

### D6 — Real line items + the Comment-line fix (fixes pain #4)
**Question:** how do extracted lines become invoice/RFQ lines?
**Industry:** match to PO line / item master (item#, description, qty×price, tolerances) → else
GL-code/type → else create; per-line green/yellow/red status; header tax/shipping reconciled.
**Our approach:** a **line-item review grid** inside the review panel. Each extracted line:
(1) try **PO-line match** (PI) / **customer-part cross-reference** (RFQ); (2) else **item-master
match** by part#/description; (3) else let the user pick a **type (Part/Material/Service/G-L)** or
create — writing **real typed lines**, never `"Comment"`. Per-line status chip. **Tax/shipping land on
the header** (or are pro-rated per policy), so the total reconciles — retiring the "whole tax on line 1"
hack. This is the standalone PR we deferred; the redesign gives it a real home.

### D7 — Trust & audit layer (enterprise)
- **Duplicate-invoice guard**: on confirm, check `supplier + invoice# + amount + date` (fuzzy) and warn.
- **Audit**: persist extracted-vs-confirmed diff on the `documentExtraction` row (we already keep
  `extractedData`/`filteredData`; add `confirmedData` + who/when) → an audit trail + future
  learn-from-corrections.
- **Verify-don't-overwrite** bank/tax: compare the PDF's bank/tax to the stored supplier record and
  **flag a change** rather than silently overwriting (Medius Detect's fraud-signal insight).

## Data model deltas
- `supplier.taxId`, reuse `contact.email` as match keys (add indexes for match speed).
- `documentExtraction`: add `confirmedData jsonb`, `confirmedBy`, `confirmedAt`, `boundingBoxes jsonb`.
- `customerPartToItem` cross-reference table (RFQ): `customerId, customerPartId, itemId` (if not present).
- No change to the extraction job, schemas, or confidence gate.

## Workflow (purchase invoice, happy path)
1. New PI → ✨ → drop PDF → "Extracting…".
2. Resolve: PO# present → bind supplier from PO; else scored match. Children resolved under the parent.
3. Review drawer opens: doc left; right shows supplier (green "matched on PO"), dates/refs, an amber
   contact ("review"), and a line grid (3 lines matched to PO lines, 1 needs a type).
4. Reviewer fixes the amber contact (or one-click creates it), picks a type for the stray line.
5. **Confirm** → draft PI form filled with real ids + real typed lines; duplicate-invoice check passes.

## Edge cases (informed by research)
- **No PO, brand-new supplier:** scored match returns nothing → guarded create (dedupe first) → then
  its contact/location resolve under the new supplier (D2).
- **Duplicate invoice:** same supplier+invoice#+amount → block with a link to the existing invoice.
- **Bank/tax drift:** PDF bank ≠ stored → flag, don't overwrite.
- **Low-confidence document / scanned image (no text layer):** extraction empty → show "couldn't read
  this PDF" with a manual-entry fallback, not a broken autofill.
- **Multi-currency:** currency from doc vs supplier default → show both, let reviewer choose.
- **Ambiguous match (2 suppliers, same name):** ranked candidates list, not first-match-wins.

## Phasing
- **Phase 1 (incremental on current branch):** dependency-graph resolution (D2), scored matching with
  signal labels (D1, name+email+tax), duplicate-invoice guard (D7), real typed line items for PI (D6),
  decouple panel state from the form (D3 partial). High value, no new surfaces.
- **Phase 2 (the pivot):** two-pane review drawer with PDF + confidence chips + click-to-source
  provenance (D3, D4); guarded create with dedupe + one-click supplier/customer (D5); audit diff (D7).
- **Phase 3 (north-star):** document **inbox** (email-to-intake), learn-from-corrections coding,
  customer-part cross-reference automation, supplier portal for bank/tax, cascading lookups.

## Pain-point → fix map
| # | Pain today | Fixed by |
|---|---|---|
| 1 | Unmatched parent drops contacts/locations | D2 dependency graph |
| 2 | Brittle heterogeneous matching | D1 scored multi-signal |
| 3 | All creates are forms | D5 guarded one-click (supplier/customer) |
| 4 | Lines written as "Comment" + tax on line 1 | D6 real typed lines + header tax |
| 5 | Auto-close only on initial full-match | D3 review + one-click Confirm |
| 6 | Modal shares form field names | D3 panel owns its own state |
