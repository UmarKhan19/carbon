// =============================================================================
// Request-safe OnShape translation poll budget (Batch-B fix · request-safe poll).
//
// The orchestrator entrypoint currently runs INSIDE a synchronous React Router
// action (apps/erp/app/routes/api+/integrations.onshape.import.ts). The client's
// default poll budget (maxAttempts 150 × 2000ms ≈ 5 min) far exceeds a typical
// request timeout, so a slow OnShape translation would hang the request until the
// platform kills it — losing the already-landed ECO + BOM result.
//
// We therefore pass a SHORT, request-safe budget (≈40s) for the drawing +
// geometry pulls and treat a poll TIMEOUT as a NON-FATAL warning ("still
// processing — re-sync later"), NOT a hard error: the ECO + BOM are the core
// deliverable and have already been written by the time these pulls run.
//
// VERIFY-LIVE / TODO(job): production must move the drawing/geometry pull to a
// background job (Inngest) where the full ≈5-min budget is safe and the user is
// not blocked. Until then this bounded budget keeps the request responsive.
// =============================================================================

export const REQUEST_SAFE_POLL = { maxAttempts: 20, delayMs: 2000 } as const;

// The client throws `Onshape translation {id} did not complete within N attempts`
// from pollTranslationUntilDone when the budget is exhausted. Distinguish that
// (re-sync later) from a genuine translate/download failure (surface the error).
export function isTranslationTimeout(err: unknown): boolean {
  return err instanceof Error && /did not complete within/i.test(err.message);
}
