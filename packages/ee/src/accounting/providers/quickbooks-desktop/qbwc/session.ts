import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Service for the "qbwcSession" table: one row per QuickBooks Web
 * Connector session. The ERP runs serverless, so session state (the
 * opaque ticket, the in-flight batch, the message-set recovery id) lives
 * in the database, not instance memory. The row id doubles as the QBWC
 * session ticket returned by authenticate().
 */

/**
 * A session whose lastSeenAt is older than this is expired: QBWC sessions
 * are minutes-long serial SOAP loops, so a stale ticket forces
 * re-authentication. This is also the point at which an Open session's
 * in-flight batch is considered abandoned (see findInterruptedBatch).
 */
export const QBWC_SESSION_EXPIRY_MS = 30 * 60_000;

/**
 * findInterruptedBatch scans at most this many batch-carrying sessions —
 * a batch is cleared as soon as it is processed or recovered, so more
 * than a handful of uncleared batches per company never accumulates.
 */
const INTERRUPTED_BATCH_SCAN_LIMIT = 25;

export type QbwcSessionStatus = "Open" | "Closed" | "Error";

export type QbwcSession = {
  /** Doubles as the opaque QBWC session ticket. */
  id: string;
  companyId: string;
  integration: string;
  status: QbwcSessionStatus;
  /** newMessageSetID of the in-flight batch (crash recovery). */
  currentMessageSetId: string | null;
  /** accountingSyncOperation ids in the in-flight batch. */
  claimedOperationIds: string[] | null;
  requestsSent: number;
  /** From the session's sendRequestXML handshake. */
  qbxmlMajorVersion: string | null;
  lastSeenAt: string;
  closedAt: string | null;
  errorMessage: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

// TODO: remove the cast once generate:types picks up the
// 20260709191928_qbwc-sessions.sql migration and "qbwcSession" exists in
// the generated Database types. Until then the query builder is untyped;
// row payloads are typed locally via QbwcSession.
function qbwcSessionTable(client: SupabaseClient<Database>): any {
  return client.from("qbwcSession" as any);
}

/**
 * Decide whether a session ticket has expired. Boundary: exactly
 * QBWC_SESSION_EXPIRY_MS old is expired. A missing/invalid timestamp is
 * treated as expired (fail closed — force re-authentication).
 */
export function isSessionExpired(args: {
  lastSeenAt: string | null | undefined;
  now?: Date;
  expiryMs?: number;
}): boolean {
  if (!args.lastSeenAt) return true;

  const lastSeenMs = new Date(args.lastSeenAt).getTime();
  if (Number.isNaN(lastSeenMs)) return true;

  const nowMs = (args.now ?? new Date()).getTime();
  return nowMs - lastSeenMs >= (args.expiryMs ?? QBWC_SESSION_EXPIRY_MS);
}

/**
 * Interrupted-batch selection rule (crash-recovery input for the QBWC
 * work loop): a session's non-empty claimedOperationIds is the
 * "unfinished batch" marker — the batch is cleared whenever its response
 * is processed (or its ops are released), so an uncleared batch means we
 * never learned whether the writes landed and MUST probe QuickBooks with
 * oldMessageSetID before any of those operations are re-sent.
 *
 * - `Closed`/`Error` sessions are conclusively dead (connectionError,
 *   hresult failure, or a user cancelling QBWC mid-batch) — their batch
 *   is recoverable immediately. Waiting would let the next work loop
 *   re-claim the batch's ops as fresh work and double-post.
 * - `Open` sessions may still be live (QBWC mid-loop), so their batch
 *   only counts once lastSeenAt passes the session expiry — before that
 *   the ticket is still valid and stealing the batch could hijack an
 *   in-progress loop.
 */
export function isInterruptedBatchCandidate(
  session: Pick<QbwcSession, "status" | "claimedOperationIds" | "lastSeenAt">,
  now?: Date,
  expiryMs?: number
): boolean {
  if (
    !session.claimedOperationIds ||
    session.claimedOperationIds.length === 0
  ) {
    return false;
  }

  if (session.status === "Open") {
    return isSessionExpired({ lastSeenAt: session.lastSeenAt, now, expiryMs });
  }

  return true;
}

/**
 * Pick the interrupted batch to recover: candidates per
 * isInterruptedBatchCandidate, most recently seen first (one batch is
 * recovered per work-loop cycle; older ones surface on later cycles once
 * the newer batch is cleared).
 */
export function selectInterruptedBatch(
  sessions: QbwcSession[],
  now?: Date,
  expiryMs?: number
): QbwcSession | null {
  const candidates = sessions
    .filter((session) => isInterruptedBatchCandidate(session, now, expiryMs))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  return candidates[0] ?? null;
}

/**
 * Open a session for an authenticated QBWC connection. The returned row's
 * id is the ticket handed back from authenticate(). id, status ('Open'),
 * lastSeenAt, and requestsSent come from the table defaults.
 */
export async function createSession(
  client: SupabaseClient<Database>,
  args: { companyId: string; integration: string; createdBy: string }
): Promise<{ data: QbwcSession | null; error: string | null }> {
  const inserted = await qbwcSessionTable(client)
    .insert({
      companyId: args.companyId,
      integration: args.integration,
      createdBy: args.createdBy
    })
    .select("*")
    .single();

  if (inserted.error) return { data: null, error: inserted.error.message };
  return { data: inserted.data as QbwcSession, error: null };
}

/**
 * Resolve a QBWC callback's ticket to its Open session and bump
 * lastSeenAt. The QBWC callbacks carry only the ticket, so lookup works
 * by id alone (ids are globally unique nanoids; pass companyId to
 * additionally scope when the caller knows it). Closed/Error sessions and
 * Open sessions not seen within QBWC_SESSION_EXPIRY_MS resolve to
 * not-found ({ data: null, error: null }) — an expired ticket forces QBWC
 * to re-authenticate.
 */
export async function getOpenSession(
  client: SupabaseClient<Database>,
  ticket: string,
  companyId?: string
): Promise<{ data: QbwcSession | null; error: string | null }> {
  let query = qbwcSessionTable(client).select("*").eq("id", ticket);
  if (companyId) query = query.eq("companyId", companyId);

  const result = await query.maybeSingle();
  if (result.error) return { data: null, error: result.error.message };

  const session = result.data as QbwcSession | null;
  if (!session || session.status !== "Open") {
    return { data: null, error: null };
  }

  const now = new Date();
  if (isSessionExpired({ lastSeenAt: session.lastSeenAt, now })) {
    return { data: null, error: null };
  }

  const bumped = await qbwcSessionTable(client)
    .update({
      lastSeenAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    .eq("id", session.id)
    .eq("companyId", session.companyId)
    .eq("status", "Open")
    .select("*")
    .single();

  if (bumped.error) return { data: null, error: bumped.error.message };
  return { data: bumped.data as QbwcSession, error: null };
}

/**
 * Fetch a session by ticket regardless of status, without bumping
 * lastSeenAt. getLastError needs this: QBWC asks for the error text AFTER
 * receiveResponseXML's hresult branch (or connectionError) already closed
 * the session with status 'Error', so the lookup must see Closed/Error
 * rows that getOpenSession deliberately hides.
 */
export async function getSession(
  client: SupabaseClient<Database>,
  ticket: string
): Promise<{ data: QbwcSession | null; error: string | null }> {
  const result = await qbwcSessionTable(client)
    .select("*")
    .eq("id", ticket)
    .maybeSingle();

  if (result.error) return { data: null, error: result.error.message };
  return { data: (result.data as QbwcSession | null) ?? null, error: null };
}

/**
 * Persist the in-flight batch on the session: the message set's
 * newMessageSetID (the crash-recovery handle) and the claimed operation
 * ids, incrementing requestsSent (one batch = one request payload handed
 * to QBWC). `qbxmlMajorVersion` is stored when provided — the work loop
 * passes it on the session's first sendRequestXML.
 */
export async function setSessionBatch(
  client: SupabaseClient<Database>,
  ticket: string,
  batch: {
    messageSetId: string;
    operationIds: string[];
    qbxmlMajorVersion?: string;
  }
): Promise<{ data: QbwcSession | null; error: string | null }> {
  const existing = await qbwcSessionTable(client)
    .select("*")
    .eq("id", ticket)
    .maybeSingle();

  if (existing.error) return { data: null, error: existing.error.message };

  const session = existing.data as QbwcSession | null;
  if (!session) {
    return { data: null, error: `QBWC session ${ticket} not found` };
  }

  const updated = await qbwcSessionTable(client)
    .update({
      currentMessageSetId: batch.messageSetId,
      claimedOperationIds: batch.operationIds,
      requestsSent: session.requestsSent + 1,
      updatedAt: new Date().toISOString(),
      ...(batch.qbxmlMajorVersion
        ? { qbxmlMajorVersion: batch.qbxmlMajorVersion }
        : {})
    })
    .eq("id", session.id)
    .eq("companyId", session.companyId)
    .select("*")
    .single();

  if (updated.error) return { data: null, error: updated.error.message };
  return { data: updated.data as QbwcSession, error: null };
}

/**
 * Clear the in-flight batch after its response is processed (or its
 * operations are released back to Pending) — an uncleared batch is what
 * findInterruptedBatch treats as needing recovery.
 */
export async function clearSessionBatch(
  client: SupabaseClient<Database>,
  ticket: string
): Promise<{ data: QbwcSession | null; error: string | null }> {
  const updated = await qbwcSessionTable(client)
    .update({
      currentMessageSetId: null,
      claimedOperationIds: null,
      updatedAt: new Date().toISOString()
    })
    .eq("id", ticket)
    .select("*")
    .single();

  if (updated.error) return { data: null, error: updated.error.message };
  return { data: updated.data as QbwcSession, error: null };
}

/**
 * Close a session — 'Closed' from closeConnection, 'Error' from
 * connectionError / an hresult failure (with the QBWC-supplied message).
 * Deliberately does NOT clear the batch: an uncleared batch on a dead
 * session is exactly what findInterruptedBatch recovers.
 */
export async function closeSession(
  client: SupabaseClient<Database>,
  ticket: string,
  status: "Closed" | "Error",
  errorMessage?: string
): Promise<{ data: QbwcSession | null; error: string | null }> {
  const now = new Date().toISOString();

  const updated = await qbwcSessionTable(client)
    .update({
      status,
      closedAt: now,
      errorMessage: errorMessage ?? null,
      updatedAt: now
    })
    .eq("id", ticket)
    .select("*")
    .single();

  if (updated.error) return { data: null, error: updated.error.message };
  return { data: updated.data as QbwcSession, error: null };
}

/**
 * Crash-recovery lookup: the most recent session whose in-flight batch
 * was never cleared (selection rule documented on
 * isInterruptedBatchCandidate). The work loop probes QuickBooks with an
 * oldMessageSetID query for the returned session's currentMessageSetId
 * BEFORE claiming new work, so operations from an interrupted batch are
 * never blindly re-sent (the double-post guard). NOTE: claimed operations
 * become independently re-claimable as stale "In Flight" rows after 10
 * minutes (operations.ts), before an Open session's 30-minute expiry —
 * the work loop must always run this recovery check first.
 */
export async function findInterruptedBatch(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{ data: QbwcSession | null; error: string | null }> {
  const result = await qbwcSessionTable(client)
    .select("*")
    .eq("companyId", companyId)
    .not("claimedOperationIds", "is", null)
    .order("lastSeenAt", { ascending: false })
    .limit(INTERRUPTED_BATCH_SCAN_LIMIT);

  if (result.error) return { data: null, error: result.error.message };

  return {
    data: selectInterruptedBatch((result.data ?? []) as QbwcSession[]),
    error: null
  };
}

/**
 * Most recent poll across the company's sessions (max lastSeenAt, any
 * status) for the connection-health display. Null when the Web Connector
 * has never polled. Pass `integration` to scope when a company ever runs
 * more than one polled integration.
 */
export async function getLastPollAt(
  client: SupabaseClient<Database>,
  companyId: string,
  integration?: string
): Promise<{ data: string | null; error: string | null }> {
  let query = qbwcSessionTable(client)
    .select("lastSeenAt")
    .eq("companyId", companyId);
  if (integration) query = query.eq("integration", integration);

  const result = await query
    .order("lastSeenAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) return { data: null, error: result.error.message };

  const row = result.data as Pick<QbwcSession, "lastSeenAt"> | null;
  return { data: row?.lastSeenAt ?? null, error: null };
}
