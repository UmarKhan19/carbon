// Per-operation classification that drives the MES view router (see issues/prd.md,
// docs/adr/0001). Orthogonal to operationType (Inside/Outside). "Operation" is the
// default and preserves today's single-screen behavior. Kept self-contained (no other
// module imports) so the backfill script can reuse the rubric without pulling in the
// rest of shared.models.
export const operationKinds = ["Operation", "Assembly", "Inspection"] as const;

export type OperationKind = (typeof operationKinds)[number];

/**
 * The BOM/BOP signals the auto-suggest reads off an operation being authored. All are
 * derivable from the method (BOP steps, BOM materials, the item, its tracking, and any
 * inspection artifact) — see the routing doc's rubric and CONTEXT.md.
 */
export type OperationKindSignals = {
  /** `methodOperationStep.type` values for this operation. */
  stepTypes: string[];
  /** Count of component materials (`methodMaterial`) consumed at this operation. */
  materialCount: number;
  /** How many of those components are `methodType = 'Make to Order'` sub-assemblies. */
  makeToOrderCount: number;
  /** A CAD model is present on the item / operation. */
  hasModel: boolean;
  /** The parent item is serial-tracked (`itemTrackingType === 'Serial'`). */
  requiresSerialTracking: boolean;
  /** The part has an inspection artifact (`requiresInspection` or an `inspectionDocument`). */
  hasInspectionPlan: boolean;
};

/**
 * Auto-suggest an operation's classification from its BOM/BOP signals (Workstream C).
 *
 * Pure and overridable: the engineer can always override the stored `operationKind`; this
 * only computes the default that pre-fills the BOP editor (and seeds the methodOperation
 * backfill). Implements the routing-doc rubric:
 *
 *   1. Steps mostly Measurement/Inspection AND (no material consumed OR an inspection plan
 *      exists) → Inspection (you're measuring, not building).
 *   2. Otherwise ≥2 components (especially Make-to-Order sub-assemblies) OR a CAD model on a
 *      serial-tracked parent → Assembly.
 *   3. Otherwise → Operation (today's safe default).
 */
export function suggestOperationKind(
  signals: OperationKindSignals
): OperationKind {
  const {
    stepTypes,
    materialCount,
    makeToOrderCount,
    hasModel,
    requiresSerialTracking,
    hasInspectionPlan
  } = signals;

  const measurementSteps = stepTypes.filter(
    (t) => t === "Measurement" || t === "Inspection"
  ).length;
  const mostlyMeasurement =
    stepTypes.length > 0 && measurementSteps * 2 > stepTypes.length;

  if (mostlyMeasurement && (materialCount === 0 || hasInspectionPlan)) {
    return "Inspection";
  }

  const assemblyByComponents = materialCount >= 2 || makeToOrderCount >= 1;
  const assemblyByModel = hasModel && requiresSerialTracking;
  if (assemblyByComponents || assemblyByModel) {
    return "Assembly";
  }

  return "Operation";
}
