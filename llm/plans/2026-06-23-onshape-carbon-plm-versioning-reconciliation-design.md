# OnShape ↔ Carbon PLM Versioning Reconciliation — Design Spec

- **Date:** 2026-06-23
- **Status:** Approved direction (decisions locked 2026-06-23); ready for implementation plan
- **Anchor:** Pillar 1 of Liam Sill's (Minimal) PLM requirements — *items need a lifecycle and versioning to tie in change management* — reconciled with OnShape, foundation-first.
- **Customer signal (Liam):** lightweight, Duro-direction; a change-management **module** like the quality module (links to affected things + actions + workflows; propose/scope → enact → approve); resolve the difference between OnShape versioning/revisions and Carbon versioning/revisions; focus OnShape first ("other integrations fall like dominoes later").

## 0. The one-paragraph design

> An engineer picks a **released** OnShape object → Carbon opens a **Draft change order (ECO)** → `createPendingRevision` creates the new item revision *inside* that ECO → the existing `sync` edge function loads the OnShape multi-level BOM into the new revision's make method → the drawing PDF is pulled to a per-revision `modelUpload` → the existing recursive redline diffs current-vs-pending → releasing the ECO (`releaseChangeOrder`) promotes the revision to Production and pins the controlled drawing for purchasing.

This wraps the **already-built** OnShape connector + BOM import in the **already-built** ECO/revision machinery. The new work is release-gating, revision-per-released-object, drawings, and honoring OnShape's reconciliation gotchas — not a from-scratch integration.

---

## 1. Current state (verified against the repo)

### 1.1 OnShape integration that ALREADY exists
| Capability | Evidence |
|---|---|
| OAuth connector (Bearer + refresh, `cad.onshape.com`) | `packages/ee/src/onshape/lib/client.ts`; `apps/erp/app/routes/api+/integrations.onshape.{oauth,install}.ts`; `integration` config row (migration `20250410120243_onshape-integration.sql`, schema updated `20260214120000`) |
| Browse documents → versions → elements | client `/api/v10/documents`, `/documents/d/{did}/versions`, `/…/elements`; routes `integrations.onshape.{documents, d.$did.versions, d.$did.v.$vid.elements}.ts` |
| Multi-level BOM pull | client `/api/v10/assemblies/d/{did}/v/{vid}/e/{eid}/bom?indented=true&multiLevel=true&generateIfAbsent=true` |
| Import BOM → `item`+`part`+`methodMaterial`, make-method versioning | `packages/database/supabase/functions/sync/index.ts` `case "onshape"` (creates/updates items by `readableId`+`revision`, versions make methods, replaces `methodMaterial`) |
| Identity mapping | `externalIntegrationMapping`, `integration='onshapeData'`, `entityType='item'` (sync/index.ts ~L420-455) |
| Trigger today | `integrations.onshape.sync.ts` posts `{makeMethodId, versionId, rows}` → invokes `sync` edge fn |

### 1.2 ECO / change-order module that ALREADY exists
`changeOrder` + `changeOrderItem` (affected items w/ `pendingItemId`), `changeOrderReviewer`, action/approval tasks, recursive multi-level BOM/BOP **redline**, one-open-CO-per-item guard (`getOpenChangeOrderForItem`, `plm.service.ts:541`), and `releaseChangeOrder()` (transaction: promotes the pending revision → Production, the prior → Obsolete — verified `plm.server.ts:54-66`; promotion is straight-to-Production today, with a `// TODO: tiered release` marking Prototype/Pre-Production as a later phase). Pre-release **validation** separately gates a release (e.g. maturity checks). Deliberately shaped like the quality module.

Verified hooks:
- `createPendingRevision(client, {changeOrderId, changeOrderItemId, itemId, userId, companyId})` — **ECO-scoped by construction** (`plm.service.ts:680`). It runs *inside* an open CO; this fixes the flow ordering (open ECO → then create revision).
- `changeOrder.sourceType` / `sourceId` exist (`20260621143000_plm-change-orders.sql:261-262`) and `insertChangeOrder` accepts them (`plm.service.ts:306-307`) → OnShape provenance needs **no new column**.

### 1.3 Carbon revision model (verified)
- Item revisions = **separate `item` rows** sharing `readableId`, distinct `id`, `revision` TEXT; `UNIQUE(readableId, revision, companyId, type)`; generated `readableIdWithRevision` → `P-1001.A`. No family FK; grouped by `readableId`.
- `createRevision` inserts a new item row, a trigger creates a `makeMethod`, and for non-Buy the `get-method` edge fn deep-copies BOM/BOP.
- `makeMethod` per-revision; `version` NUMERIC, `status` Draft/Active/Archived; `activeMakeMethods` view ranks Active-then-version.
- `modelUpload` per-revision (`item.modelUploadId`; `modelUpload.itemId`); storage `{companyId}/models/…`; `thumbnailPath`, `autodeskUrn`.
- `externalIntegrationMapping` (generic linchpin): `entityType, entityId, integration, externalId, metadata JSONB, lastSyncedAt, remoteUpdatedAt, allowDuplicateExternalId`; `UNIQUE(entityType, entityId, integration, companyId)`; partial-unique `(integration, externalId, entityType, companyId)` when not `allowDuplicate`.
- `revisionStatus` enum on `item`: Design / Prototype / Production / Obsolete. **No "Released" state.** Release is governed by `changeOrder.status` (Draft / In Review / Approved / Released / Cancelled).

### 1.4 The gaps = the reconciliation work
1. **Imports from a Version, not a Revision.** The flow pulls BOM from `/v/{vid}/…` (a document-wide snapshot), not a released Revision. (OnShape gotcha #1.)
2. **Zero ECO awareness.** `grep changeOrder|createPendingRevision` in `sync` = 0; it overwrites a make method's BOM directly — no proposal/redline/approval.
3. **No drawings.** `grep modelUpload|drawing` in `sync` = 0 → purchasing-SSOT piece absent.
4. **Targets a `makeMethodId`** (sync into one item's method) rather than mirroring released revisions per object keyed by Part Number + Revision.

---

## 2. The reconciliation model

| OnShape concept | Carbon concept | Rule |
|---|---|---|
| **Revision** (per-object, approval-gated, immutable `revisionId`) | an `item` revision row (`readableId`+`revision`) | Map item revision ↔ OnShape **Revision**, **never** a Version. |
| **Version** (document-wide immutable snapshot) | provenance only — `metadata.sourceVid` | The pinned API read anchor (`v/{vid}`); never an item revision. |
| **Part Number + Revision** (business key) | `readableId` (=PN) + `revision` | The stable cross-version key. **Never key on `partId`** (transient). |
| **Workflow state** (In Progress/Pending/Released/Rejected/Obsolete) | `changeOrderItem.metadata.onshapeState` | Provenance only; does **not** touch `item.revisionStatus`. |
| **Released configuration** (own PN+Rev+BOM line) | a distinct `item` | One config → one item (see §3.5). |
| **Drawing** (own revisionable object/label) | per-revision `modelUpload` (v1) | `metadata.drawingRevisionLabel` preserves drawing-rev ≠ part-rev. |

---

## 3. Architecture

### 3.1 Identity & mapping (reuse `externalIntegrationMapping`, no new identity table)
One row per mirrored released object:
- `entityType='item'`, `entityId=<carbon item.id>`, `integration='onshape'`, `externalId=<onshape revisionId>` (immutable, release-locked).
- `metadata` JSONB: `{ did, sourceVid, mid, eid, partNumber, revisionLabel, configurationId, fullConfiguration, drawingRevisionLabel, isStandardContent, massProps, schemeType }`.
  - `sourceVid` = the immutable Version the revision was cut from = our `v/{vid}` read anchor.
  - `revisionLabel` = OnShape's literal label (e.g. `"B"`), stored as **durable truth** because `item.revision` is Carbon's *auto-computed* label and the two can diverge.
  - `partId` lives here **only** as a transient breadcrumb, always re-resolved against `sourceVid`; never a key.
- Keep `integration='onshapeData'` (the existing per-line BOM mapping the sync fn already writes) distinct from `integration='onshape'` (this revision-level mapping), OR consolidate during Increment 1 — decided in the plan; both are the same table.

**Resolution path (per released object):**
1. Look up by `(integration='onshape', entityType='item', externalId=revisionId)`. Hit → already synced; update in place.
2. Miss → find any `item` by `readableId = partNumber` (the family).
3. Family hit → new revision: open/attach a Draft CO, add `changeOrderItem`, call `createPendingRevision({changeOrderId, changeOrderItemId, itemId})`.
4. Family miss → create the base item, then the same CO flow.

### 3.2 Sync trigger & flow — **manual pull**, ECO-first ordering
**Trigger (DECISION):** manual "Sync from OnShape" action (extends the existing browse UI). Webhooks deferred to Increment 4.

Flow per released object, in code-correct order:
1. **Resolve & validate** the released revision via the **Revisions API**, pinned to `v/{sourceVid}`: PN, revision label, name, description, material, custom props, mass props. **Refuse loudly** if PN is null ("OnShape object has no Part Number — release it first").
2. **Open/attach the ECO first** (DECISION: auto-Draft fallback). `getOpenChangeOrderForItem`; if none, auto-create a **Draft** CO (not In Review) and notify. Tag provenance: `sourceType='onshape'`, `sourceId=<releasePackageId>` (existing columns).
3. **Create the pending revision into the CO** — `changeOrderItem` + `createPendingRevision` → new `item` row + Draft `makeMethod` + `externalIntegrationMapping` row.
4. **BOM → `methodMaterial`** — pull `/assemblies/.../bom?multiLevel=true&indented=true` (existing client method); **reuse/extend the `sync` edge fn** to write lines into the *new revision's* make method. Match-not-create children by PN (§3.6); flag phantom rows (§3.6).
5. **Drawing → `modelUpload`** (Increment 2) — drawing PDF (`formatName='PDF'`) + geometry STEP (async translations + poll) → per-revision `modelUpload`, set `item.modelUploadId`, store `drawingRevisionLabel`.
6. **Redline runs free** — the existing recursive ECO redline diffs current-Production vs imported-pending `methodMaterial`+`methodOperation`. No new diff code.

### 3.3 Lifecycle ruling — single source of truth
**`changeOrder.status` is the sole release authority.** No new "Released" item state.
- A mirrored-but-not-adopted revision = a pending revision inside an open CO; `revisionStatus` untouched until release.
- OnShape's workflow state = provenance only in `changeOrderItem.metadata.onshapeState` (surfaced as a column in Increment 3).
- `releaseChangeOrder()` is the **only** adoption path. OnShape-Released ≠ Carbon-Production.

### 3.4 ECO governance
The OnShape release is an **upstream proposal**, not an auto-commit. It lands as a **Draft** CO the engineer scopes/reviews before submitting — the propose/scope → actions → review/approve → release shape Liam asked for. The one-open-CO-per-item guard prevents races. A multi-object release package dedupes into **one** ECO via a mapping row `entityType='changeOrder'`, `externalId=releasePackageId` (Increment 3).

### 3.5 Configurations — **in v1 (DECISION)**
OnShape requires a **unique Part Number per released configuration**, so each released configuration is already a distinct revisionable object with its own PN+Rev and its own BOM line → **each maps to a distinct Carbon `item`** keyed by its PN+Rev. No quantity roll-up across configs.
- Store `configurationId` + the encoded `fullConfiguration` string in `metadata` (needed to re-read that variant's geometry/drawing via the `configuration=` query param).
- A configured assembly BOM lists each used configuration as its own child line → resolve each independently through §3.1. No new table.

### 3.6 BOM children, standard content, phantom rows
- **Match-not-create:** BOM children matched by PN to existing items; standard/library parts (not revisioned) are linked, never created as revisions; vendor PN stored as a custom property.
- **Phantom/reference rows:** `excludeFromBom` / not-revision-managed / obsoleted rows flagged in `methodMaterial.metadata` (reference), not created as active stock.

### 3.7 Drawings as single source of truth for purchasing (DECISION: per-revision modelUpload)
The controlled PDF is stored as the part revision's per-revision `modelUpload` (`item.modelUploadId`). Because `modelUpload` is per-revision, purchasing viewing `P-1001.B` sees exactly that revision's released drawing. A separate drawing-item with an independent drawing-revision lifecycle (drawing-only releases) is deferred to Increment 4.

---

## 4. Non-negotiables (OnShape gotchas) + how honored
| Gotcha | Handling |
|---|---|
| Map to Revision, never Version | `externalId=revisionId`; `sourceVid` is read-anchor only |
| Key = PN+Rev, never `partId` | `readableId=partNumber`; `partId` transient breadcrumb re-resolved against `v/{vid}` |
| PN null until release | ingest only released objects; refuse on null PN |
| OnShape label ≠ Carbon label | Carbon auto-computes `item.revision`; OnShape label kept in `metadata.revisionLabel` |
| Configs → many items | one released config → one item (unique PN); no qty roll-up; `fullConfiguration` in metadata |
| Standard/library = match-not-create | matched by PN; never revisioned |
| Drawings revision separately | `metadata.drawingRevisionLabel`; v1 pins PDF to part's per-revision modelUpload |
| Phantom rows | flagged in `methodMaterial.metadata`, not active stock |
| Release cascade / where-used | Increment 4; parents batch into the **same** ECO to avoid no-value-revision spam |

---

## 5. Schema changes
- **Reused untouched:** `externalIntegrationMapping`, `changeOrder` (+`sourceType`/`sourceId`), `changeOrderItem`, `createPendingRevision`, `makeMethod`/`methodMaterial`, `modelUpload`, `releaseChangeOrder`, the `sync` edge fn, the OnShape OAuth client + routes.
- **New schema:** **none for Increments 1–3.** Increment 4 adds a single `onshapeWebhookEvent` idempotency/audit table (revisionId-keyed; status received/processing/done/failed) for webhook replay/backfill.
- Constraint: the user applies all migrations; `types.ts` is auto-generated (never hand-edited).

## 6. Decisions (locked 2026-06-23)
1. **Sync trigger:** manual pull (webhooks → Increment 4).
2. **ECO creation:** auto-Draft fallback (engineer scopes before submit).
3. **Configurations:** **supported in v1** (config→many-items fan-out via unique released PNs).
4. **Drawing model:** part's per-revision `modelUpload`.
5. **Ruled defaults (all lenses agreed):** no new "Released" lifecycle state (`changeOrder.status` is authority); import from **Revisions** for adoption, keep the existing Version browse for scoping/preview.

## 7. Phased build (Increments 1–2 = full MVP)
1. **Release-gated, ECO-wrapped sync incl. config fan-out** — Revisions API read + refusal guards (null PN) → Draft CO (tag `sourceType/sourceId`) → `createPendingRevision` → reuse `sync` for BOM; match-not-create standard content; phantom flagging; config fan-out. *No migration.* Ships propose→review→adopt for single + configured parts.
2. **Drawing + geometry SSOT** — drawing PDF + STEP → per-revision `modelUpload`; purchasing sees the pinned drawing; redline + `releaseChangeOrder()` adopt. *No migration.*
3. **OnShape-state visibility + release-package→one-ECO dedupe** — mirror workflow state into `changeOrderItem.metadata.onshapeState` (surfaced column); dedupe via `entityType='changeOrder'` mapping. *No migration.*
4. **Cascade + webhooks** — `onshape.revision.created` → Inngest; `/productstructure/whereused` cascade batched into one ECO; separate-linked-drawing-item. *One migration (`onshapeWebhookEvent`).*

## 8. Risks & open questions
- **Auth scope:** the existing connector is **OAuth (user-delegated)**. Webhooks/background sync (Increment 4) may need a company-level token or API keys (HMAC) — revisit before Increment 4.
- **Existing Version-based import:** keep as the "scope/preview" path during ECO drafting vs deprecate — resolve in the plan; default is keep.
- **`onshapeData` vs `onshape` mapping rows:** consolidate or coexist — decide in Increment 1.
- **In-context parts** (anchored to a frozen parent Version) and **upward release cascade** ("no-value" assembly revisions) — handled via batching in Increment 4; verify behavior with a real Minimal assembly.
- **Mass-properties / translation endpoint exact paths + API version majors** — confirm in OnShape Glassworks before coding Increment 2.

## 9. Out of scope (this pass)
Other CAD systems / general "data manager" write-back (Liam: dominoes later); BOP authoring from OnShape (OnShape has no process plan); supplier-external drawing sharing (internal PO visibility only for now).
