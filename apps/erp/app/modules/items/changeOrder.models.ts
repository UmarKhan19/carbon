// =============================================================================
// Enums — mirror the DB enums defined in the plm-change-orders migration.
// Phase 0 (foundation) ships ONLY these enum mirror arrays. Validators, the
// status-transition DAG, the approval evaluator, and lock helpers are deferred
// to their consuming feature phase and added to this same file in place.
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

// NOTE: changeOrder.priority is the DB enum `nonConformancePriority`. Its TS
// mirror is the canonical `nonConformancePriority` in quality.models.ts — import
// that where a validator/UI needs it rather than re-declaring the values here.

// company setting companySettings.plmReleaseControl
export const plmReleaseControl = ["off", "warn", "enforce"] as const;
