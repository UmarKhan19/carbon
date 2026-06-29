import { z } from "zod";
import { zfd } from "zod-form-data";

// =============================================================================
// Enums — mirror the DB enums defined in
// packages/database/supabase/migrations/20260621143000_plm-change-orders.sql
// =============================================================================

export const changeOrderType = [
  "Engineering",
  "Manufacturing",
  "Documentation"
] as const;

export const changeOrderStatus = [
  "Draft",
  "In Review",
  "Approved",
  "Released",
  "Cancelled"
] as const;

export const changeOrderApprovalType = [
  "Unanimous",
  "Majority",
  "First-In"
] as const;

export const changeOrderDisposition = [
  "No Change",
  "Use Up",
  "Rework",
  "Scrap"
] as const;

export const itemRevisionStatus = [
  "Design",
  "Prototype",
  "Production",
  "Obsolete"
] as const;

// Mirrors nonConformanceTaskStatus (Pending/In Progress/Completed/Skipped).
export const changeOrderTaskStatus = [
  "Pending",
  "In Progress",
  "Completed",
  "Skipped"
] as const;

// changeOrder.priority reuses the nonConformancePriority enum.
export const changeOrderPriority = [
  "Low",
  "Medium",
  "High",
  "Critical"
] as const;

// Mirrors nonConformanceApprovalRequirement (single-value today: "MRB").
export const changeOrderApprovalRequirement = ["MRB"] as const;

// company setting companySettings.plmReleaseControl
export const plmReleaseControl = ["off", "warn", "enforce"] as const;

// =============================================================================
// Lock helper — mirrors isIssueLocked() from quality.models.ts.
// A change order is locked once it is Released or Cancelled (terminal states).
// =============================================================================

export function isChangeOrderLocked(
  status: string | null | undefined
): boolean {
  return status === "Released" || status === "Cancelled";
}

// Affected items (and their staged pending revisions) may only be added or
// removed while the change order is still a Draft. Once it is In Review or later
// the affected-item set is frozen so a post-approval item can't ride to release
// unreviewed. (isChangeOrderLocked is too narrow — it only blocks terminal
// Released/Cancelled, leaving In Review / Approved editable.)
export function canEditChangeOrderItems(
  status: string | null | undefined
): boolean {
  return status === "Draft";
}

// =============================================================================
// Status-transition map + threshold evaluator (PURE — unit-tested in
// changeOrder.models.test.ts; consumed by the status action + the reviewer
// decision service). No I/O here.
// =============================================================================

// Allowed forward/backward status changes for a change order. Anything not
// listed (including from === to and terminal states) is rejected.
export const changeOrderStatusTransitions: Record<
  (typeof changeOrderStatus)[number],
  (typeof changeOrderStatus)[number][]
> = {
  Draft: ["In Review", "Cancelled"],
  "In Review": ["Approved", "Draft", "Cancelled"],
  // NOTE: Approved → Released is intentionally NOT listed. Release is reached
  // ONLY via the release route / releaseChangeOrder (which guards
  // status === "Approved" directly inside its transaction). Excluding it here
  // stops the generic status route from flipping Approved → Released and
  // bypassing the release transaction (revision promotion + make-method flip).
  Approved: ["Draft", "Cancelled"],
  Released: [],
  Cancelled: []
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

// Peer-review threshold. A "decision" is a reviewer row; an approval counts
// only when that reviewer reached the terminal Completed state. Zero reviewers
// can never satisfy a threshold.
//
// A Skipped reviewer is treated as a RECUSAL: they neither approve nor block, so
// they are excluded from the denominator entirely (the Skip button would
// otherwise make Unanimous/Majority unreachable forever). If EVERY reviewer is
// Skipped (or there are no reviewers), no threshold can be met.
//   - Unanimous: every NON-skipped reviewer Completed.
//   - Majority: strictly more than half of the NON-skipped reviewers Completed.
//   - First-In: at least one Completed decision carries.
export function evaluateApprovalThreshold(
  approvalType: (typeof changeOrderApprovalType)[number],
  decisions: { status: (typeof changeOrderTaskStatus)[number] }[]
): boolean {
  const considered = decisions.filter((d) => d.status !== "Skipped");
  const total = considered.length;
  if (total === 0) return false;
  const completed = considered.filter((d) => d.status === "Completed").length;
  switch (approvalType) {
    case "Unanimous":
      return completed === total;
    case "Majority":
      return completed * 2 > total;
    case "First-In":
      return completed >= 1;
    default:
      return false;
  }
}

// =============================================================================
// Validators (clone quality.models.ts shapes; use zfd for form payloads)
// =============================================================================

export const changeOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  description: zfd.text(z.string().optional()),
  type: z.enum(changeOrderType),
  priority: z.enum(changeOrderPriority).optional(),
  approvalType: z.enum(changeOrderApprovalType),
  changeOrderTypeId: zfd.text(z.string().optional()),
  changeOrderWorkflowId: zfd.text(z.string().optional()),
  openDate: z.string().min(1, { message: "Open date is required" }),
  dueDate: zfd.text(z.string().optional()),
  effectiveDate: zfd.text(z.string().optional()),
  // Repurposed: free-form list of the picked approver GROUP ids (no longer the
  // static MRB enum). Populated server-side from the approver picker.
  approvalRequirements: z.array(z.string()).optional(),
  sourceType: zfd.text(z.string().optional()),
  sourceId: zfd.text(z.string().optional()),
  assignee: zfd.text(z.string().optional()),
  // Approver picker output: a mix of verbose-prefixed group ids ("group_…")
  // and individual user ids ("user_…"). Resolved to reviewers on insert.
  approvers: z.array(z.string()).optional(),
  items: z.array(z.string()).optional()
});

export const changeOrderItemValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  disposition: z.enum(changeOrderDisposition).optional(),
  dispositionNotes: zfd.text(z.string().optional())
});

export const changeOrderTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});

// A change order workflow is a TEMPLATE/PRESET that pre-fills a new change
// order — it is NOT a state machine. It carries the default priority, the
// default approvalType, and a default set of approver GROUP ids (the same
// verbose-prefixed "group_…"/"user_…" picker the ECO ChangeOrderForm uses).
//
// Storage note: priority/approvalType/approvers are persisted inside the
// existing `content` JSON column (the only template payload column that
// already exists in the generated types). No new migration column is
// referenced in TypeScript. See changeOrderWorkflowContentValidator for the
// read-side shape.
export const changeOrderWorkflowValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  priority: z.enum(changeOrderPriority).optional(),
  approvalType: z.enum(changeOrderApprovalType),
  // Verbose-prefixed approver picker output ("group_…"/"user_…").
  approvers: z.array(z.string()).optional()
});

// Read-side shape of changeOrderWorkflow.content. content is stored as `Json`
// in the DB, so we safely parse it into the template fields.
export const changeOrderWorkflowContentValidator = z.object({
  priority: z.enum(changeOrderPriority).nullish(),
  approvalType: z.enum(changeOrderApprovalType).nullish(),
  approvers: z.array(z.string()).nullish()
});

export type ChangeOrderWorkflowContent = z.infer<
  typeof changeOrderWorkflowContentValidator
>;

export function parseChangeOrderWorkflowContent(
  content: unknown
): ChangeOrderWorkflowContent {
  const result = changeOrderWorkflowContentValidator.safeParse(content);
  return result.success ? result.data : {};
}

export const changeOrderApprovalTaskValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  status: z.enum(changeOrderTaskStatus).optional(),
  dueDate: zfd.text(z.string().optional()),
  assignee: zfd.text(z.string().optional())
});

// Status transition validator (used by $id.status routes).
export const changeOrderStatusValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  status: z.enum(changeOrderStatus),
  assignee: zfd.text(z.string().optional()),
  effectiveDate: zfd.text(z.string().optional())
});

// Reviewer decision validator (used by the $id.decision route + decision modal).
export const changeOrderDecisionValidator = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(1, { message: "A reason is required" })
});
