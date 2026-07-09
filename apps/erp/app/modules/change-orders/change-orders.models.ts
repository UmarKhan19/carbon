import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { nonConformancePriority } from "../quality/quality.models";

// Error shape returned by the change-orders service functions: either a real
// Supabase PostgrestError or a hand-built message (sequence/lookup failures that
// don't originate from a query). One alias so callers get a consistent contract.
export type ChangeOrderError = PostgrestError | { message: string };

// Mirrors the DB "supersessionMode" enum (20260618171234_material-supersession).
// Declared locally rather than imported from the large items.models to keep the
// change-orders type graph independent.
export const supersessionModes = [
  "Consume First",
  "Prefer New",
  "Stock Only",
  "No Stock"
] as const;

// =============================================================================
// Change Orders — validators, enums, and the stage state machine.
//
// V1 is a standalone module modeled on Quality. The header evolves the existing
// `changeOrder` table; the affected-item/disposition model is replaced by the
// part-first BOM-change model (see change-orders BOM validators, Phase 2).
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

export const itemRevisionStatus = [
  "Design",
  "Prototype",
  "Production",
  "Obsolete"
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
// Phase 2 — change content (Products Affected, BOM change rows, Actions)
// =============================================================================

// Products Affected — the top-level products the CO touches (drives the
// Implementation effectivity-version list).
export const changeOrderProductAffectedValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  itemId: z.string().min(1, { message: "Product is required" })
});

// BOM change rows are part-first. A discriminated union on changeType (G8) so an
// Add row structurally can't be a Delete and vice-versa:
//   - Delete: targets an EXISTING part being removed from assemblies.
//   - Add: an existing part, OR a forward-reference to a not-yet-synced part
//     (newItemReadableId + newItemName) which the service mints as a real
//     inactive item (G3 — no nullable placeholder threading).
// Per-assembly quantity + supersession mode live on the assembly rows below.
// A single flat object (not a discriminatedUnion of ZodEffects): the union form
// is structurally nicer but, threaded through @carbon/form's `validator()`
// generics, its type instantiation is heavy enough to trip TS2589 elsewhere. The
// superRefine enforces the same rules — a Delete row targets an existing part; an
// Add row is either an existing part or a forward-reference (id + name) that the
// service mints (G3/G8 intent preserved at runtime).
export const changeOrderBomChangeValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    changeOrderId: z.string().min(1, { message: "Change order is required" }),
    changeType: z.enum(["Add", "Delete"]),
    itemId: zfd.text(z.string().optional()),
    newItemReadableId: zfd.text(z.string().optional()),
    newItemName: zfd.text(z.string().optional())
  })
  .superRefine((d, ctx) => {
    if (d.changeType === "Delete" && !d.itemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Part is required",
        path: ["itemId"]
      });
    }
    if (
      d.changeType === "Add" &&
      !d.itemId &&
      !(d.newItemReadableId && d.newItemName)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a part or provide an id and name for the new part",
        path: ["itemId"]
      });
    }
  });

// Per-assembly target of a BOM change. supersessionMode is only meaningful on a
// Delete row's assemblies; the service ignores it for Add rows.
export const changeOrderBomChangeAssemblyValidator = z.object({
  id: zfd.text(z.string().optional()),
  bomChangeId: z.string().min(1, { message: "BOM change is required" }),
  assemblyItemId: z.string().min(1, { message: "Assembly is required" }),
  quantity: zfd.numeric(z.number().gt(0, { message: "Quantity must be > 0" })),
  supersessionMode: zfd.text(z.enum(supersessionModes).optional())
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

// Full-obsolescence predicate (G8 — the SINGLE place that decides whether the
// apply writes a GLOBAL itemSupersession for a deleted part). A part is fully
// obsoleted when the CO removes it from every assembly that currently consumes
// it AND no Add row re-introduces it. Per-assembly supersession modes are the
// stock instructions; this rollup is the global old→successor link.
export function isItemFullyObsoleted(args: {
  deleteAssemblyIds: string[];
  assembliesUsingItem: string[];
  isReAddedElsewhere: boolean;
}): boolean {
  if (args.isReAddedElsewhere) return false;
  if (args.assembliesUsingItem.length === 0) return false;
  const deleted = new Set(args.deleteAssemblyIds);
  return args.assembliesUsingItem.every((id) => deleted.has(id));
}

// -----------------------------------------------------------------------------
// Change Order Types (the "Category" lookup — configured like Issue Types)
// -----------------------------------------------------------------------------
export const changeOrderTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});
