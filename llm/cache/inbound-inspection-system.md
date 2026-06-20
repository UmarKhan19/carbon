# Inbound Inspection System

Receiving-side quality gate. When a receipt is posted, a lot-level inspection is
created for any received line whose item has `requiresInspection = true`.

## Data model (migration `20260419163058_inbound-inspection-sampling.sql`)

- `item.requiresInspection` BOOLEAN — flags an item for inbound inspection.
- `itemSamplingPlan` (PK `itemId`) — per-item plan: `type` (All/First/Percentage/AQL),
  `sampleSize`, `percentage`, `aql`, `inspectionLevel`, `severity`.
- `inboundInspection` (lot level) — `receiptLineId` (unique), `receiptId`, `itemId`,
  `lotSize`, `sampleSize`, `acceptanceNumber`, `rejectionNumber`, sampling snapshot,
  `status` (Pending/In Progress/Passed/Failed/Partial), disposition fields. No
  `itemTrackingType` column — joined from `item` when needed.
- `inboundInspectionSample` — one row per recorded result. `trackedEntityId` is
  **nullable** (migration `20260612151947_inbound-inspection-optional-tracked-entity.sql`);
  a partial unique index (`WHERE trackedEntityId IS NOT NULL`) keeps a serial entity
  sampleable only once while allowing many anonymous samples per lot.
- `inboundInspectionHistory` — one row per disposition (for future plan auto-switching).

## Tracking types (key behavior)

All four `itemTrackingType` values support inbound inspection. Tracked-entity counts
created at receipt (`post-receipt/index.ts`, lot creation ~lines 634-682):
- **Serial** (qty N) → N tracked entities (qty 1 each). Inspector **scans/selects** a
  discrete entity per sample; that entity flips Available/Rejected per result.
- **Batch** (qty N) → 1 tracked entity (qty N). No scanning; the single lot entity is
  released/rejected by disposition as an un-sampled entity.
- **Inventory / Non-Inventory** → 0 tracked entities (inventory goes straight to
  Available in `itemLedger`; no physical hold). Inspection is a **quality record only**.

Non-serial parts record pass/fail per sampled item with `trackedEntityId = NULL` —
same inspection UI, no scan. (Before mid-2026 the "Requires Inspection" toggle was
gated to Serial/Batch only; that gate was removed.)

## Code map

- ERP "Requires Inspection" toggle: `apps/erp/app/modules/items/ui/{Parts,Materials,Tools,Consumables}/*Properties.tsx`
  (no longer gated by tracking type). Quality tab nav keys off `requiresInspection`.
- Sampling plan editor: `apps/erp/app/modules/quality/ui/SamplingPlan/SamplingPlanForm.tsx`
  (per item-type quality routes, e.g. `routes/x+/part+/$itemId.quality.tsx`).
- Inspection detail UI: `apps/erp/app/modules/quality/ui/InboundInspections/InboundInspectionLotView.tsx`
  (drawer: progress, samples table, Accept/Reject/Partial). Branches on
  `isSerial = itemTrackingType === "Serial"`. Reject modal has an optional
  "Open an NCR" checkbox (default on).
- Sample modal: `.../InboundInspections/ScanInspectionSample.tsx` — `isSerial` prop;
  serial shows Scan/Select tabs (entity required), others show just Notes + Pass/Fail.
- Routes: `routes/x+/quality+/inbound-inspections.$id.tsx` (loader passes
  `itemTrackingType`), `.$id.sample.tsx`, `.$id.{accept,reject,partial}.tsx`.
- Server transactions: `apps/erp/app/modules/quality/quality.server.ts`
  - `upsertInboundInspectionSample` — entity status flip + `trackedActivity`
    input/output only when `trackedEntityId` present; anonymous samples are
    always inserts (no dedupe).
  - `dispositionInboundInspection` — Accept releases un-sampled entities, Reject
    flips all lot entities to Rejected, Partial leaves them; writes history. No-op
    on entity flips when the lot has 0 entities.
- Service queries: `quality.service.ts` `getInboundInspection` (selects
  `item(... itemTrackingType)`), `getInboundInspectionLotTrackedEntities`.
- Validator: `quality.models.ts` `inboundInspectionSampleValidator` —
  `trackedEntityId` is optional.
- Reject route auto-creates an NCR (optional via `createNcr` form flag), linking the
  inspection, receipt line, and any failed/lot tracked entities.
