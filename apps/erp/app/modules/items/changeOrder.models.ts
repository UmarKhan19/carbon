import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { nonConformancePriority } from "../quality/quality.models";
// supersessionModes is an item-domain const (mirrors the DB "supersessionMode"
// enum); reuse the single canonical declaration in items.models.
import { supersessionModes } from "./items.models";

// Error shape returned by the change order service functions: either a real
// Supabase PostgrestError or a hand-built message (sequence/lookup failures that
// don't originate from a query). One alias so callers get a consistent contract.
export type ChangeOrderError = PostgrestError | { message: string };

// =============================================================================
// Change Orders — validators, enums, and the stage state machine.
//
// A sub-area of the Items module, modeled on Quality. The header evolves the
// existing `changeOrder` table; the affected-item/disposition model is replaced
// by the part-first BOM-change model (see change order BOM validators, Phase 2).
// =============================================================================

// changeOrder.type — the legacy category enum on the header. Retained (the
// column still exists); the primary "Category" is `changeOrderTypeId` (a row in
// the changeOrderType lookup, reseeded to Design improvement / Obsolescence /
// Cost reduction).
export const changeOrderType = [
  "Engineering",
  "Manufacturing",
  "Documentation"
] as const;

// V1 stage flow (forward, one step at a time). Broadcast on Start /
// Implementation / Done; silent on Draft / Engineering Complete.
export const changeOrderStatus = [
  "Draft",
  "Start",
  "Engineering Complete",
  "Implementation",
  "Done"
] as const;

export const changeOrderTaskStatus = [
  "Pending",
  "In Progress",
  "Completed",
  "Skipped"
] as const;

// changeOrder.priority reuses quality's nonConformancePriority DB enum.
export const changeOrderPriority = nonConformancePriority;

// -----------------------------------------------------------------------------
// Stage state machine (G8 — one place). Forward-only, single step. This map only
// encodes the allowed shape of a transition.
// -----------------------------------------------------------------------------
export const changeOrderStatusTransitions: Record<
  (typeof changeOrderStatus)[number],
  (typeof changeOrderStatus)[number][]
> = {
  Draft: ["Start"],
  Start: ["Engineering Complete"],
  "Engineering Complete": ["Implementation"],
  Implementation: ["Done"],
  Done: []
};

export function isAllowedChangeOrderTransition(
  from: string | null | undefined,
  to: string | null | undefined
): boolean {
  if (!from || !to || from === to) return false;
  const allowed =
    changeOrderStatusTransitions[from as (typeof changeOrderStatus)[number]];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

// The stages that broadcast a team notification on entry.
export const changeOrderBroadcastStages: (typeof changeOrderStatus)[number][] =
  ["Start", "Implementation", "Done"];

// "Open" = every stage before the record is closed at Done. Used by the item
// open-CO alert and the single-open-CO guard.
export const changeOrderOpenStatuses: (typeof changeOrderStatus)[number][] = [
  "Draft",
  "Start",
  "Engineering Complete",
  "Implementation"
];

// Locked once Done — the record is closed and part of the audit trail.
export function isChangeOrderLocked(
  status: string | null | undefined
): boolean {
  return status === "Done";
}

// Content (reason/description/products/BOM changes/actions) is editable until
// the CO is closed.
export function canEditChangeOrder(status: string | null | undefined): boolean {
  return !isChangeOrderLocked(status);
}

// -----------------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------------
export const changeOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  reasonForChange: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  type: z.enum(changeOrderType).optional(),
  priority: z.enum(nonConformancePriority).optional(),
  changeOrderTypeId: zfd.text(z.string().optional()),
  nonConformanceId: zfd.text(z.string().optional()),
  openDate: z.string().min(1, { message: "Open date is required" }),
  dueDate: zfd.text(z.string().optional()),
  effectiveDate: zfd.text(z.string().optional()),
  assignee: zfd.text(z.string().optional())
});

// Status transition (used by the $id.status route). fromStatus drives a
// compare-and-swap so a stale/concurrent transition is rejected.
export const changeOrderStatusValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  fromStatus: z.enum(changeOrderStatus),
  status: z.enum(changeOrderStatus),
  assignee: zfd.text(z.string().optional()),
  effectiveDate: zfd.text(z.string().optional())
});

// =============================================================================
// Top-to-bottom change content — affected items + staged BOM/BOP/attributes +
// supersession. The user selects affected parts first, then edits each part's
// method/attributes staged in CO-owned tables (full desired end-state, git-style).
// All validators are flat objects (no discriminated unions / heavy generics) to
// stay clear of TS2589 when threaded through @carbon/form's `validator()`.
// =============================================================================

// Affected item — the source revision the user selects to change. Adding one
// snapshots its current method + attributes into staging (service side).
export const changeOrderAffectedItemValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  itemId: z.string().min(1, { message: "Item is required" })
});

// Per-item revision cutover config (Q3): existence of the oldRev→newRev
// supersession is automatic at release; the user only tunes mode + dates here.
export const changeOrderAffectedItemCutoverValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  supersessionMode: z.enum(supersessionModes),
  discontinuationDate: zfd.text(z.string().optional()),
  successorEffectivityDate: zfd.text(z.string().optional())
});

// Staged BOM line — mirrors methodMaterial. methodType/sourcingType are
// re-derived from the component item by the service (advisory here). An Add of a
// not-yet-synced part forward-references via newItemReadableId + newItemName (G3).
export const changeOrderStagedMaterialValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  affectedItemId: z.string().min(1, { message: "Affected item is required" }),
  itemId: zfd.text(z.string().optional()),
  newItemReadableId: zfd.text(z.string().optional()),
  newItemName: zfd.text(z.string().optional()),
  quantity: zfd.numeric(z.number().gt(0, { message: "Quantity must be > 0" })),
  unitOfMeasureCode: zfd.text(z.string().optional()),
  methodType: zfd.text(z.string().optional()),
  sourcingType: zfd.text(z.string().optional()),
  materialMakeMethodId: zfd.text(z.string().optional()),
  stagedOperationId: zfd.text(z.string().optional()),
  order: zfd.numeric(z.number().optional()),
  itemType: zfd.text(z.string().optional()),
  sourceMaterialId: zfd.text(z.string().optional())
});

// Staged BOP operation — mirrors the CURRENT methodOperation columns
// (processId/workCenterId, setup/labor/machine time+unit, operationType).
// Children (steps/params/tools) are Phase 5. Enum-typed fields are text here
// (the DB enum column is the real guard); process/type nullable = authoring WIP.
export const changeOrderStagedOperationValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  affectedItemId: z.string().min(1, { message: "Affected item is required" }),
  order: zfd.numeric(z.number().optional()),
  operationOrder: zfd.text(z.string().optional()),
  operationType: zfd.text(z.string().optional()),
  processId: zfd.text(z.string().optional()),
  workCenterId: zfd.text(z.string().optional()),
  operationSupplierProcessId: zfd.text(z.string().optional()),
  procedureId: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  setupTime: zfd.numeric(z.number().optional()),
  setupUnit: zfd.text(z.string().optional()),
  laborTime: zfd.numeric(z.number().optional()),
  laborUnit: zfd.text(z.string().optional()),
  machineTime: zfd.numeric(z.number().optional()),
  machineUnit: zfd.text(z.string().optional()),
  sourceOperationId: zfd.text(z.string().optional())
});

// Staged BOP operation children (Task 16) — mirror methodOperationStep /
// Parameter / Tool, scoped to a staged operation.
export const changeOrderStagedOperationStepValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  stagedOperationId: z.string().min(1, { message: "Operation is required" }),
  name: z.string().min(1, { message: "Name is required" }),
  description: zfd.text(z.string().optional()),
  type: zfd.text(z.string().optional()),
  required: zfd.checkbox(),
  sortOrder: zfd.numeric(z.number().optional()),
  unitOfMeasureCode: zfd.text(z.string().optional()),
  minValue: zfd.numeric(z.number().optional()),
  maxValue: zfd.numeric(z.number().optional())
});

export const changeOrderStagedOperationParameterValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  stagedOperationId: z.string().min(1, { message: "Operation is required" }),
  key: z.string().min(1, { message: "Key is required" }),
  value: z.string().min(1, { message: "Value is required" })
});

export const changeOrderStagedOperationToolValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  stagedOperationId: z.string().min(1, { message: "Operation is required" }),
  toolId: z.string().min(1, { message: "Tool is required" }),
  quantity: zfd.numeric(z.number().gt(0, { message: "Quantity must be > 0" }))
});

// Staged item attributes — CO-owned redline of an affected item's editable
// fields (Q6). All optional; the exact set is finalized in Phase 3b against
// PartProperties. One row per affected item.
export const changeOrderStagedItemAttributesValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  affectedItemId: z.string().min(1, { message: "Affected item is required" }),
  name: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  unitOfMeasureCode: zfd.text(z.string().optional()),
  itemTrackingType: zfd.text(z.string().optional()),
  defaultMethodType: zfd.text(z.string().optional()),
  replenishmentSystem: zfd.text(z.string().optional()),
  sourcingType: zfd.text(z.string().optional()),
  requiresInspection: zfd.checkbox(),
  thumbnailPath: zfd.text(z.string().optional())
});

// Manual different-part supersession declaration (NOT revision cutover — that is
// auto-generated per affected item). predecessor → successor (successor optional
// for a pure discontinuation).
export const changeOrderSupersessionValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  predecessorItemId: z.string().min(1, { message: "Predecessor is required" }),
  successorItemId: zfd.text(z.string().optional()),
  supersessionMode: z.enum(supersessionModes),
  discontinuationDate: zfd.text(z.string().optional()),
  successorEffectivityDate: zfd.text(z.string().optional())
});

// Actions — freeform tasks (reuse changeOrderActionTask). Any user, any stage;
// non-gating.
export const changeOrderActionValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  name: z.string().min(1, { message: "Title is required" }),
  assignee: zfd.text(z.string().optional()),
  dueDate: zfd.text(z.string().optional())
});

export const changeOrderActionStatusValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  status: z.enum(changeOrderTaskStatus)
});

// -----------------------------------------------------------------------------
// Diff types (Q5 git-style) — one shape reused for the pre-release "tips"
// (staged-vs-live) and the post-release revision redline (oldRev-vs-newRev).
// -----------------------------------------------------------------------------
export type MethodDiffStatus = "added" | "removed" | "modified" | "unchanged";

export type MethodDiffEntry<T> = {
  status: MethodDiffStatus;
  before: T | null;
  after: T | null;
  // Field-level changes for a "modified" entry: { field: { before, after } }.
  changedFields?: Record<string, { before: unknown; after: unknown }>;
};

export type ChangeOrderItemDiff = {
  affectedItemId: string;
  itemId: string;
  materials: MethodDiffEntry<Record<string, unknown>>[];
  operations: MethodDiffEntry<Record<string, unknown>>[];
  attributes: MethodDiffEntry<Record<string, unknown>>[];
};

// -----------------------------------------------------------------------------
// Change Order Types (the "Category" lookup — configured like Issue Types)
// -----------------------------------------------------------------------------
export const changeOrderTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});
