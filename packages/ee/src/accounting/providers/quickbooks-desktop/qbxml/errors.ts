import type { JournalEntrySyncFailure } from "../../../core/posting";

/**
 * qbXML status classification + builder-side validation errors.
 *
 * Every qbXML response carries statusCode + statusSeverity
 * (Info/Warn/Error). classifyStatus maps the codes a sync actually meets
 * (research §QuickBooks Desktop Integration Surface) onto the operation
 * outcome the QBWC handler records:
 *
 * - `ok` — write/query succeeded.
 * - `not-found` — statusCode 1, a query that matched nothing. NOT an
 *   error: it is the expected answer to a query-before-insert probe.
 * - `warning` — user-fixable; the operation lands `Warning` with the
 *   errorCode for the inbox (NAME_EXISTS — one shared name namespace
 *   across customers/vendors/employees/other names; OBJECT_NOT_FOUND;
 *   INVALID_REFERENCE; PERIOD_LOCKED — closing-date/condense lock;
 *   QB_WARNING for any other Warn-severity status).
 * - `retryable` — transient QuickBooks-side contention (QB_BUSY:
 *   object-in-use / lock-failed / generic-save-failure family) or a stale
 *   EditSequence (STALE_EDIT_SEQUENCE — retryable exactly ONCE: the
 *   handler re-queries and re-applies, and a second 3200 lands Failed).
 * - `fatal` — everything else at Error severity; errorCode
 *   `QB_ERROR_<code>` keeps the raw code greppable.
 */

export type QbxmlStatusKind =
  | "ok"
  | "not-found"
  | "warning"
  | "retryable"
  | "fatal";

export interface QbxmlStatusClassification {
  kind: QbxmlStatusKind;
  /** null for ok / not-found; a machine-readable code otherwise. */
  errorCode: string | null;
}

const STATUS_CLASSIFICATIONS: ReadonlyMap<number, QbxmlStatusClassification> =
  new Map([
    [3100, { kind: "warning", errorCode: "NAME_EXISTS" }],
    [3120, { kind: "warning", errorCode: "OBJECT_NOT_FOUND" }],
    [3140, { kind: "warning", errorCode: "INVALID_REFERENCE" }],
    [3170, { kind: "warning", errorCode: "PERIOD_LOCKED" }],
    [3171, { kind: "warning", errorCode: "PERIOD_LOCKED" }],
    [3175, { kind: "retryable", errorCode: "QB_BUSY" }],
    [3176, { kind: "retryable", errorCode: "QB_BUSY" }],
    [3180, { kind: "retryable", errorCode: "QB_BUSY" }],
    [3200, { kind: "retryable", errorCode: "STALE_EDIT_SEQUENCE" }]
  ]);

/**
 * Classify a qbXML response status (see module header for the mapping
 * table). Unmapped codes fall back on severity: Error → fatal
 * `QB_ERROR_<code>`, anything else → warning `QB_WARNING`.
 */
export function classifyStatus(
  code: number,
  severity: "Info" | "Warn" | "Error"
): QbxmlStatusClassification {
  if (code === 0) return { kind: "ok", errorCode: null };
  if (code === 1) return { kind: "not-found", errorCode: null };

  const mapped = STATUS_CLASSIFICATIONS.get(code);
  if (mapped) return { ...mapped };

  if (severity === "Error") {
    return { kind: "fatal", errorCode: `QB_ERROR_${code}` };
  }
  return { kind: "warning", errorCode: "QB_WARNING" };
}

/**
 * Thrown by the D4 request builders when a Carbon value cannot be
 * represented in qbXML (name over the per-level cap, address line over 41,
 * unmapped account ref, unbalanced journal). Carries the SAME structured
 * failure envelope as core/posting.ts (`JournalEntrySyncFailure`, typed to
 * the JOURNAL_ENTRY_SYNC_ERROR_CODES union — do not extend it), so the D10
 * syncers convert it to a Warning/Failed operation exactly like the
 * Xero/QBO pre-flight failures; `isJournalEntrySyncFailure(err.failure)`
 * holds. Message is "<errorCode>: <detail>" so string-flattening paths
 * stay greppable.
 */
export class QbxmlValidationError extends Error {
  readonly failure: JournalEntrySyncFailure;

  constructor(failure: JournalEntrySyncFailure) {
    super(`${failure.errorCode}: ${failure.message}`);
    this.name = "QbxmlValidationError";
    this.failure = failure;
  }
}
