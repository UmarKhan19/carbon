// The PUBLIC face of a failed operation, for `callOperation`'s callers (MCP, the
// in-app agent, the workflow dispatcher). Kept out of call.server.ts so it can be
// tested without loading the service registry, the same split as
// validation-issues.ts and args-envelope.ts.
//
// Nothing from the underlying error reaches the caller: neither a serialized
// PostgREST body (whose code/details/hint name columns, constraints and values)
// nor an edge function's own message text. The caller gets one of the fixed
// strings below, chosen from the error's STRUCTURED fields only, and the full
// detail is logged server-side where support can read it (CWE-209).
//
// The HTTP surface is a different path and is unchanged: an HTTP caller's 400
// body is serialized from the ORPCError by the oRPC handler, never from
// `CallResult`.

/** What went wrong, at the granularity a caller can act on. */
export type DatabaseFailureKind =
  | "conflict"
  | "reference"
  | "required"
  | "permission"
  | "notFound"
  | "rule"
  | "unknown";

/**
 * The closed set. Every message is a fixed string — no interpolation, ever, or
 * this stops being a closed set.
 */
export const DATABASE_ERROR_MESSAGES: Record<DatabaseFailureKind, string> = {
  conflict: "Database error: a record with these values already exists.",
  // Direction-neutral on purpose: 23503 fires both when a row references a
  // missing parent AND when a delete or update is blocked because dependent rows
  // still reference the target. Naming only the first sends the caller to the
  // wrong correction on the second.
  reference:
    "Database error: the operation would violate a reference between records.",
  required: "Database error: a required field was missing.",
  permission:
    "Database error: this credential is not permitted to perform that operation.",
  notFound: "Database error: no matching record was found.",
  rule: "Database error: the operation was rejected by a server-side rule.",
  unknown: "Database error: the operation could not be completed."
};

/**
 * Classify from structured fields only — a Postgres SQLSTATE, or the error's own
 * constructor name for an edge-function failure. Message text is never parsed: it
 * is the thing being withheld, and matching on it would make the public message a
 * function of private text.
 */
export function classifyDatabaseFailure(error: unknown): DatabaseFailureKind {
  const candidate = error as { code?: unknown; name?: unknown } | null;
  if (candidate?.name === "FunctionsHttpError") return "rule";

  const code = typeof candidate?.code === "string" ? candidate.code : "";
  switch (code) {
    case "23505":
      return "conflict";
    case "23503":
      return "reference";
    case "23502":
      return "required";
    case "42501":
      return "permission";
    case "PGRST116":
      return "notFound";
    default:
      return "unknown";
  }
}

/** The public message for a failure. */
export function publicDatabaseError(error: unknown): string {
  return DATABASE_ERROR_MESSAGES[classifyDatabaseFailure(error)];
}
