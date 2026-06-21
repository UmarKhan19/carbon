// Per-operation classification that drives the MES view router (see docs/adr/0001,
// docs/adr/0005, and CONTEXT.md). Orthogonal to operationType (Inside/Outside).
// "Operation" is the default and preserves today's single-screen behavior. Set per
// operation in the BOP editor; copied verbatim to jobOperation/quoteOperation by
// get-method.
export const operationKinds = ["Operation", "Assembly", "Inspection"] as const;

export type OperationKind = (typeof operationKinds)[number];
