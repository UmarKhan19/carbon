# Research: Document-capture autofill for ERP (AP invoices + sales RFQs)

Competitor scan for redesigning Carbon's "Autofill from PDF" flow. Sources: SAP Ariba,
Coupa, BILL, Tipalti, Stampli, Medius, AvidXchange, Basware (AP/IDP); Rossum, Nanonets,
Ocrolus, Mindee (pure IDP); Paperless Parts, PartParse, Fulcrum, Xometry/Protolabs (mfg RFQ).

## Key consensus (what everyone agrees on)
1. **Draft, never a committed record, on ingest.** Parse → create a *draft* with everything
   pre-filled → gate promotion to a real record behind explicit human confirmation. Universal.
2. **Two-pane review: source document on one side, extracted fields on the other.** Tipalti
   confirms doc-left / form-right with required fields highlighted. The review surface — not the
   extraction — is where trust is won.
3. **Identity ≠ name.** Ranked binding signals: **PO# → supplier (deterministic) > tax/VAT/TIN >
   bank account > supplier-network ID > remit-to address > email domain > prior-invoice history >
   fuzzy name (last resort).** Name similarity only *surfaces candidates*; it never binds alone.
4. **Confidence drives a 3-band action, not a binary.** Ariba: `<0.5` drop the field · `0.5–0.7`
   autofill but block submit (human reviews) · `>0.7` flow through. ~0.85 is the common auto-apply
   cutoff; configurable per customer. Mature programs hit 70–80% straight-through.
5. **Create master data as a *guarded* action.** Never a raw silent insert. Pre-fill from the
   document, but (a) run **duplicate detection first** (score tax-id+bank+name+address; ≥~90% →
   "may already exist, link instead"), and (b) create in a **non-payable / pending-approval**
   state — "supplier exists" ≠ "supplier is approved to pay" (segregation of duties).
6. **Duplicate-invoice guard is table stakes.** Compare `supplier + invoice# + amount + date`
   with fuzzy tolerance, checked at capture and again at payment. AI catches 95–99% vs 40–60%
   manual. Carbon has none today.

## Unique / borrowable approaches
- **Click-a-field-to-highlight-on-the-document (bounding-box provenance).** Strong on pure-IDP
  (Rossum, Mindee); **NOT confirmed on any AP incumbent.** Building it = a differentiator that
  beats the AP leaders, not just matches them.
- **Learn-from-corrections GL/line coding.** Tipalti Auto-Coding (~95%, reapplies a code once you
  pick it for a vendor); Stampli Billy codes from accounting history; Ariba "Instant Learning."
- **Per-line color-coded exception grid** (green/yellow/red) for line items — Tipalti/Stampli.
- **PO-line matching** by item/part#, description, qty×price with amount-or-% tolerances (header
  and line level, incl. a dedicated shipping tolerance).
- **Cascading/dependent lookups** (Stampli): picking the supplier narrows valid GL/part/cost-center
  options. Directly applicable to mfg (supplier → valid parts; job → valid operations).
- **Customer part cross-reference** (Epicor/Cetec/Aligni): the customer's PN on an RFQ resolves to
  an internal part via a stored cross-ref; create-new records the cross-ref so next time auto-matches.
- **Sender-based resolution for RFQ** (Paperless Parts Wingman): match email/domain → Account +
  Contact, fall back to create. **No incumbent distinguishes engineering vs purchasing contacts —
  Carbon already models both → free differentiator.**
- **Files as first-class, auto-bound to line items** (Paperless): one file → many lines, drag to
  reassign, auto-unzip + virus scan.

## Direct answers to our design questions
- **Vendor resolution:** PO-first, then tax-id/bank/email, name last; surface top candidate(s) with
  the *matched signal* ("matched on VAT ID"), not a bare name guess.
- **Review UX:** two-pane (doc + fields), per-field confidence as flag/route/color, field-level
  confirm; pure-IDP adds numeric confidence + click-to-source.
- **Line items:** match to PO line / item master (tolerances) → else code to GL/type → else create;
  per-line status; header tax/shipping reconciled so the total balances.
- **RFQ intake:** auto-create draft from the doc, resolve customer+contact by sender, map parts via
  customer cross-reference, review before promotion.

Full agent transcripts: 4 research subagents (AP vendor, IDP review UX, line-item/PO match, RFQ intake).
