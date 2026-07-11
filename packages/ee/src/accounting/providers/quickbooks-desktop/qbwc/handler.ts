import { randomUUID } from "node:crypto";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import eePackage from "../../../../../package.json";
import { ProviderID } from "../../../core/models";
import {
  claimPendingOperations,
  completeOperation,
  failOperation,
  getSyncOperations,
  getSyncOperationsByIds,
  updateOperationMetadata
} from "../../../core/operations";
import type { JournalEntrySyncFailure } from "../../../core/posting";
import {
  getAccountingIntegration,
  getProviderIntegration
} from "../../../core/service";
import { SyncFactory } from "../../../core/sync";
import type {
  AccountingEntityType,
  SyncContext,
  SyncOperation
} from "../../../core/types";
import {
  getQbdPhase,
  QBD_EDIT_SEQUENCE_RETRY_METADATA_KEY,
  QBD_PHASE_METADATA_KEY,
  type QbdBuildRequestResult,
  type QbdOperationInput,
  type QbdProcessResponseResult
} from "../entities/shared";
import type { QbdProvider } from "../provider";
import { buildMessageSet } from "../qbxml/envelope";
import { classifyStatus } from "../qbxml/errors";
import {
  parseMessageSetResponse,
  parseMessageSetStatus,
  type QbxmlResponse
} from "../qbxml/parse";
import { verifyPassword } from "./credentials";
import {
  clearSessionBatch,
  closeSession,
  createSession,
  findInterruptedBatch,
  getOpenSession,
  getSession,
  type QbwcSession,
  setSessionBatch
} from "./session";
import {
  buildQbwcSoapFault,
  buildQbwcSoapResponse,
  parseQbwcSoapRequest,
  QbwcSoapFaultError,
  type QbwcSoapRequest,
  type QbwcSoapResult
} from "./soap";

/**
 * QBWC protocol handler — the state machine behind the eight SOAP
 * callbacks. Pure with respect to transport: it takes the raw SOAP XML and
 * a context, and returns the SOAP XML to answer with; the D9 resource
 * route owns HTTP.
 *
 * Session lifecycle (D7): authenticate resolves the `carbon-<companyId>`
 * username to the quickbooks-desktop companyIntegration, verifies the
 * scrypt password, and opens a qbwcSession row whose id is the ticket.
 * "" second element = work available (use the currently-open company
 * file); "none" = nothing to do (no session row); "nvu" = invalid user;
 * "busy" = a transient server-side failure QBWC should retry later.
 *
 * Work loop (D8): sendRequestXML drains the accountingSyncOperation ledger
 * through each entity's polled syncer halves (buildRequest /
 * processResponse — the D10 contract in entities/shared.ts), batching up
 * to 20 requests per qbXML message set with requestID = operation id and
 * a fresh newMessageSetID persisted on the session. receiveResponseXML
 * matches responses by requestID, routes ok/not-found statuses to the
 * syncer and owns warning/retryable/fatal itself (classifyStatus).
 *
 * Crash recovery: an uncleared session batch (claimedOperationIds) means
 * we never learned whether that batch's writes landed. sendRequestXML
 * ALWAYS probes for one before claiming new work — claimed operations go
 * stale-reclaimable after 10 minutes (operations.ts) while a crashed Open
 * session only expires after 30, so probing first is what prevents a
 * blind re-send (the double-post guard). The probe asks QuickBooks for
 * the stored response via oldMessageSetID: statusCode 9002 = the batch
 * never reached QuickBooks (re-send it); anything else = the stored
 * response, processed exactly like a live batch response.
 */

/** QBWC login names embed the company id: `carbon-<companyId>` (D5). */
const QBWC_USERNAME_PREFIX = "carbon-";

/** authenticate() second-element sentinels (QBWC contract). */
const AUTH_INVALID_USER = "nvu";
const AUTH_NO_WORK = "none";
const AUTH_BUSY = "busy";

/** Max requests per qbXML message set (mirrors the drain's claim limit). */
const QBWC_BATCH_LIMIT = 20;

/**
 * How many claim rounds one sendRequestXML may run when every candidate
 * resolves at build time (idempotent skips / pre-flight failures) — keeps
 * one SOAP callback bounded; anything left continues on the next poll.
 */
const MAX_CLAIM_ROUNDS = 10;

/** Message-set statusCode for "no stored response" on a recovery probe. */
const QBXML_NO_STORED_RESPONSE_STATUS = 9002;

/**
 * Fallback qbXML version. QBWC sends qbXMLMajorVers/qbXMLMinorVers on
 * every sendRequestXML in practice; this only guards a malformed client
 * before the session has stored a handshake version.
 */
const DEFAULT_QBXML_VERSION = "16.0";

/**
 * The two polled halves the work loop drives per operation (implemented by
 * every syncer in the quickbooks-desktop registry — entities/shared.ts).
 */
export interface QbwcPolledSyncer {
  buildRequest(op: QbdOperationInput): Promise<QbdBuildRequestResult>;
  processResponse(
    op: QbdOperationInput,
    response: QbxmlResponse
  ): Promise<QbdProcessResponseResult>;
}

export interface QbwcHandlerContext {
  client: SupabaseClient<Database>;
  /**
   * Kysely handle for constructing entity syncers (SyncContext.database) —
   * the D9 route passes the same pooled client the jobs drain uses.
   */
  database: SyncContext["database"];
  now(): Date;
  /**
   * Test seam: resolve the polled syncer for a SyncContext. Defaults to
   * SyncFactory.getSyncer over the registered quickbooks-desktop registry.
   */
  getSyncer?(context: SyncContext): QbwcPolledSyncer;
}

/**
 * Handle one QBWC SOAP request. Never throws: malformed envelopes and
 * unknown operations answer with a soap:Client fault, unexpected handler
 * errors with a soap:Server fault (the D9 route returns those with
 * status 500).
 */
export async function handleQbwcRequest(
  soapXml: string,
  ctx: QbwcHandlerContext
): Promise<{ soapXml: string }> {
  let request: QbwcSoapRequest;
  try {
    request = parseQbwcSoapRequest(soapXml);
  } catch (error) {
    if (error instanceof QbwcSoapFaultError) {
      return { soapXml: buildQbwcSoapFault(error.faultCode, error.message) };
    }
    return { soapXml: buildQbwcSoapFault("Client", toErrorMessage(error)) };
  }

  try {
    const result = await dispatch(request, ctx);
    return { soapXml: buildQbwcSoapResponse(request.operation, result) };
  } catch (error) {
    console.error(`QBWC ${request.operation} failed:`, error);
    return { soapXml: buildQbwcSoapFault("Server", toErrorMessage(error)) };
  }
}

async function dispatch(
  request: QbwcSoapRequest,
  ctx: QbwcHandlerContext
): Promise<QbwcSoapResult> {
  const { params } = request;

  switch (request.operation) {
    case "serverVersion":
      return eePackage.version;
    case "clientVersion":
      // "" = any QBWC client version is accepted
      return "";
    case "authenticate":
      return authenticate(ctx, params);
    case "sendRequestXML":
      return sendRequestXML(ctx, params);
    case "receiveResponseXML":
      return receiveResponseXML(ctx, params);
    case "connectionError":
      return connectionError(ctx, params);
    case "getLastError":
      return getLastError(ctx, params);
    case "closeConnection":
      return closeConnection(ctx, params);
  }
}

// /********************************************************\
// *            D7 — authenticate + session lifecycle        *
// \********************************************************/

async function authenticate(
  ctx: QbwcHandlerContext,
  params: Record<string, string>
): Promise<string[]> {
  const username = params.strUserName ?? "";
  const password = params.strPassword ?? "";

  if (!username.startsWith(QBWC_USERNAME_PREFIX)) {
    return ["", AUTH_INVALID_USER];
  }
  const companyId = username.slice(QBWC_USERNAME_PREFIX.length);
  if (!companyId) return ["", AUTH_INVALID_USER];

  const integration = await loadIntegration(ctx, companyId);
  if (!integration || !integration.active) return ["", AUTH_INVALID_USER];

  const credentials = integration.metadata.credentials;
  if (
    !credentials ||
    credentials.type !== "webConnector" ||
    credentials.username !== username ||
    !verifyPassword(password, credentials.passwordHash)
  ) {
    return ["", AUTH_INVALID_USER];
  }

  const pending = await getSyncOperations(ctx.client, {
    companyId,
    integration: ProviderID.QUICKBOOKS_DESKTOP,
    status: "Pending",
    limit: 1
  });
  if (pending.error) return ["", AUTH_BUSY];

  const interrupted = await findInterruptedBatch(ctx.client, companyId);
  if (interrupted.error) return ["", AUTH_BUSY];

  // No pending work AND no interrupted batch to recover → nothing to do;
  // QBWC skips the update pass entirely (no session row is opened)
  if ((pending.count ?? 0) === 0 && !interrupted.data) {
    return ["", AUTH_NO_WORK];
  }

  const session = await createSession(ctx.client, {
    companyId,
    integration: ProviderID.QUICKBOOKS_DESKTOP,
    // The QBWC agent has no user; sessions are attributed to whoever last
    // configured the integration (the credentials issuer in practice)
    createdBy: integration.updatedBy ?? "system"
  });
  if (session.error || !session.data) return ["", AUTH_BUSY];

  // Empty second element = proceed against the currently-open company file
  return [session.data.id, ""];
}

async function connectionError(
  ctx: QbwcHandlerContext,
  params: Record<string, string>
): Promise<string> {
  const message =
    params.message?.trim() || params.hresult?.trim() || "connection error";

  // closeSession preserves the in-flight batch: if a batch was pending on
  // this session, findInterruptedBatch recovers it next conversation. A
  // failed lookup (unknown ticket) is swallowed — the answer is "DONE"
  // regardless: never retry alternate company-file paths.
  const closed = await closeSession(
    ctx.client,
    params.ticket ?? "",
    "Error",
    message
  );
  if (closed.error) {
    console.error(`QBWC connectionError for unknown ticket: ${closed.error}`);
  }

  return "DONE";
}

async function getLastError(
  ctx: QbwcHandlerContext,
  params: Record<string, string>
): Promise<string> {
  // Any-status lookup: the session is usually already Closed/Error when
  // QBWC asks for the message (hresult / connectionError close it first)
  const session = await getSession(ctx.client, params.ticket ?? "");
  if (session.error) throw new Error(session.error);

  // "NoOp" makes QBWC pause 5 seconds and retry the update pass
  return session.data?.errorMessage || "NoOp";
}

async function closeConnection(
  ctx: QbwcHandlerContext,
  params: Record<string, string>
): Promise<string> {
  const open = await getOpenSession(ctx.client, params.ticket ?? "");
  if (open.error) throw new Error(open.error);

  // Only an Open session is marked Closed — a session that already ended
  // in Error keeps its status and stored message for the health surface
  if (open.data) {
    const closed = await closeSession(ctx.client, open.data.id, "Closed");
    if (closed.error) throw new Error(closed.error);
  }

  return "Sync complete";
}

// /********************************************************\
// *            D8 — work loop + crash recovery              *
// \********************************************************/

async function sendRequestXML(
  ctx: QbwcHandlerContext,
  params: Record<string, string>
): Promise<string> {
  const ticket = params.ticket ?? "";
  const open = await getOpenSession(ctx.client, ticket);
  if (open.error) throw new Error(open.error);
  const session = open.data;
  // Expired/unknown ticket → empty string; QBWC re-authenticates next poll
  if (!session) return "";

  const version = resolveQbxmlVersion(
    params.qbXMLMajorVers,
    params.qbXMLMinorVers,
    session.qbxmlMajorVersion
  );
  // The session's first call stores the handshake major version
  const versionUpdate =
    !session.qbxmlMajorVersion && params.qbXMLMajorVers?.trim()
      ? { qbxmlMajorVersion: params.qbXMLMajorVers.trim() }
      : {};

  // 1) CRASH RECOVERY — always before claiming new work: claimed ops go
  //    stale-reclaimable at 10 minutes while a crashed Open session only
  //    expires at 30 (session.ts note), so the probe must win that race.
  const interrupted = await findInterruptedBatch(ctx.client, session.companyId);
  if (interrupted.error) throw new Error(interrupted.error);
  const batch = interrupted.data;
  if (batch && batch.id !== session.id) {
    if (batch.currentMessageSetId) {
      // Adopt the batch onto THIS session first, then clear the dead
      // session's marker: if we crash in between, both sessions carry the
      // batch and the newest (this one) wins the next recovery scan —
      // clearing first would lose the marker and re-open the double-post
      // window.
      const moved = await setSessionBatch(ctx.client, session.id, {
        messageSetId: batch.currentMessageSetId,
        operationIds: batch.claimedOperationIds ?? [],
        ...versionUpdate
      });
      if (moved.error) throw new Error(moved.error);

      const cleared = await clearSessionBatch(ctx.client, batch.id);
      if (cleared.error) throw new Error(cleared.error);

      // The recovery probe: an EMPTY message set asking for the stored
      // response of the interrupted batch. receiveResponseXML branches on
      // the answer (9002 = never landed vs the stored response).
      return buildMessageSet({
        version,
        oldMessageSetID: batch.currentMessageSetId,
        requests: []
      });
    }

    // A batch marker without a message-set id cannot be probed (should not
    // happen — setSessionBatch always writes both). Drop the marker; its
    // operations become stale-reclaimable in 10 minutes.
    const cleared = await clearSessionBatch(ctx.client, batch.id);
    if (cleared.error) throw new Error(cleared.error);
  }

  // 2) Gather work: (a) operations pinned to this session mid-flow
  //    (follow-up phases persisted by receiveResponseXML), then (b) new
  //    Pending claims up to the batch cap.
  const followUps = await loadSessionOperations(ctx.client, session);

  let provider: QbdProvider | null = null;
  const requests: string[] = [];
  const batchOperationIds: string[] = [];

  let candidates = followUps;
  for (let round = 0; round < MAX_CLAIM_ROUNDS; round++) {
    const capacity = QBWC_BATCH_LIMIT - candidates.length;
    if (capacity > 0) {
      const claimed = await claimPendingOperations(ctx.client, {
        companyId: session.companyId,
        integration: ProviderID.QUICKBOOKS_DESKTOP,
        limit: capacity
      });
      if (claimed.error) throw new Error(claimed.error);
      candidates = [...candidates, ...claimed.data];
    }
    if (candidates.length === 0) break;

    provider ??= await loadProvider(ctx, session.companyId);
    for (const op of candidates) {
      const requestXml = await buildOperationRequest(ctx, provider, op);
      if (requestXml !== null) {
        requests.push(requestXml);
        batchOperationIds.push(op.id);
      }
    }
    candidates = [];

    // Every candidate resolved at build time (idempotent skips, eligibility
    // gates, pre-flight failures) — try the next slice of Pending work
    if (requests.length > 0) break;
  }

  if (requests.length === 0) {
    // Nothing pending anywhere. Drop a stale batch pointer if the session
    // carried follow-ups that all resolved at build time.
    if ((session.claimedOperationIds ?? []).length > 0) {
      const cleared = await clearSessionBatch(ctx.client, ticket);
      if (cleared.error) throw new Error(cleared.error);
    }
    return "";
  }

  // Persist the batch on the session BEFORE handing it to QBWC — the
  // uncleared marker is exactly what crash recovery probes for.
  const messageSetId = randomUUID();
  const stored = await setSessionBatch(ctx.client, ticket, {
    messageSetId,
    operationIds: batchOperationIds,
    ...versionUpdate
  });
  if (stored.error) throw new Error(stored.error);

  return buildMessageSet({ version, newMessageSetID: messageSetId, requests });
}

async function receiveResponseXML(
  ctx: QbwcHandlerContext,
  params: Record<string, string>
): Promise<number> {
  const ticket = params.ticket ?? "";
  const open = await getOpenSession(ctx.client, ticket);
  if (open.error) throw new Error(open.error);
  const session = open.data;
  // Negative = error; QBWC calls getLastError and gives up this pass
  if (!session) return -1;

  const hresult = params.hresult?.trim() ?? "";
  if (hresult) {
    // QB-side COM failure. The claimed operations stay In Flight and the
    // batch marker stays on the session (closeSession preserves it), so
    // the NEXT conversation probes this exact batch with oldMessageSetID
    // before anything is re-sent — the probe, not a return-to-Pending, is
    // the double-post guard (D6 contract).
    const closed = await closeSession(
      ctx.client,
      ticket,
      "Error",
      params.message?.trim() || hresult
    );
    if (closed.error) throw new Error(closed.error);
    return -1;
  }

  const responseXml = params.response ?? "";
  const claimedIds = session.claimedOperationIds ?? [];

  if (!responseXml.trim() || claimedIds.length === 0) {
    // Nothing to process: no batch outstanding or an empty response body
    return percentDone(ctx, session.companyId, {
      resolved: 0,
      followUpCount: claimedIds.length
    });
  }

  // Recovery probe answered "no stored response" (9002): the interrupted
  // batch never reached QuickBooks. The operations stay pinned to this
  // session — the next sendRequestXML rebuilds their requests from the
  // persisted phases and re-sends them under a fresh newMessageSetID.
  const setStatus = parseMessageSetStatus(responseXml);
  if (setStatus.statusCode === QBXML_NO_STORED_RESPONSE_STATUS) {
    return percentDone(ctx, session.companyId, {
      resolved: 0,
      followUpCount: claimedIds.length
    });
  }

  // A live batch response — or a recovery probe that returned the STORED
  // response (the writes DID land): either way QuickBooks answered our
  // requests and the per-request statuses are processed identically.
  const ops = await loadSessionOperations(ctx.client, session);
  const opsById = new Map(ops.map((op) => [op.id, op]));
  // Everything still mid-flow rides to the next loop unless this response
  // resolves it (claimed ids without a live row are already settled)
  const followUpIds = new Set(opsById.keys());

  let provider: QbdProvider | null = null;
  let resolved = 0;

  for (const response of parseMessageSetResponse(responseXml)) {
    const op = response.requestID ? opsById.get(response.requestID) : undefined;
    if (!op) continue; // not part of this batch, or resolved elsewhere

    provider ??= await loadProvider(ctx, session.companyId);
    const outcome = await applyResponse(ctx, provider, op, response);
    if (outcome === "resolved") {
      followUpIds.delete(op.id);
      resolved++;
    }
  }

  // Remove resolved operations from the session batch; keep follow-ups
  // pinned for the next sendRequestXML of this loop.
  const followUps = claimedIds.filter((id) => followUpIds.has(id));
  if (followUps.length > 0 && session.currentMessageSetId) {
    // Re-using the answered messageSetId keeps the recovery invariant
    // sound: if the session dies here, the probe replays QuickBooks'
    // stored response and the follow-up handling above is idempotent.
    // (setSessionBatch increments requestsSent — an accepted overcount;
    // the counter tracks batch-state writes, not distinct message sets.)
    const pinned = await setSessionBatch(ctx.client, ticket, {
      messageSetId: session.currentMessageSetId,
      operationIds: followUps
    });
    if (pinned.error) throw new Error(pinned.error);
  } else {
    const cleared = await clearSessionBatch(ctx.client, ticket);
    if (cleared.error) throw new Error(cleared.error);
  }

  return percentDone(ctx, session.companyId, {
    resolved,
    followUpCount: followUps.length
  });
}

// /********************************************************\
// *                    Work-loop helpers                    *
// \********************************************************/

/**
 * Build one operation's request via its syncer. Returns the request XML,
 * or null when the operation resolved at build time (completed / failed) —
 * resolution is written to the ledger here.
 */
async function buildOperationRequest(
  ctx: QbwcHandlerContext,
  provider: QbdProvider,
  op: SyncOperation
): Promise<string | null> {
  let result: QbdBuildRequestResult;
  try {
    const syncer = resolveSyncer(ctx, provider, op.entityType);
    result = await syncer.buildRequest(op);
  } catch (error) {
    // Plain throws are programmer/sequencing bugs (entity not found,
    // unknown entity type) — the operation fails non-warning (D10 contract)
    const failed = await failOperation(ctx.client, {
      id: op.id,
      companyId: op.companyId,
      errorMessage: toErrorMessage(error)
    });
    if (failed.error) throw new Error(failed.error);
    return null;
  }

  if (result.outcome === "completed") {
    const completed = await completeOperation(ctx.client, {
      id: op.id,
      companyId: op.companyId,
      ...(result.externalId ? { externalId: result.externalId } : {})
    });
    if (completed.error) throw new Error(completed.error);
    return null;
  }

  if (result.outcome === "failed") {
    const failed = await failOperation(ctx.client, {
      id: op.id,
      companyId: op.companyId,
      ...toFailureRecord(op, result.failure)
    });
    if (failed.error) throw new Error(failed.error);
    return null;
  }

  // outcome === "request": persist the phase BEFORE the request is sent so
  // a crash-recovered batch resumes at the right phase (D10 contract)
  if (getQbdPhase(op) !== result.phase) {
    const updated = await updateOperationMetadata(ctx.client, {
      id: op.id,
      companyId: op.companyId,
      metadata: {
        ...(op.metadata ?? {}),
        [QBD_PHASE_METADATA_KEY]: result.phase
      }
    });
    if (updated.error) throw new Error(updated.error);
  }

  return result.requestXml;
}

type ResponseOutcome = "resolved" | "follow-up";

/**
 * Apply one qbXML response to its operation. ok/not-found statuses route
 * to the syncer's processResponse; the handler owns warning / retryable /
 * fatal statuses per the classifyStatus table.
 */
async function applyResponse(
  ctx: QbwcHandlerContext,
  provider: QbdProvider,
  op: SyncOperation,
  response: QbxmlResponse
): Promise<ResponseOutcome> {
  const classification = classifyStatus(
    response.statusCode,
    response.statusSeverity
  );

  if (classification.kind === "ok" || classification.kind === "not-found") {
    let result: QbdProcessResponseResult;
    try {
      const syncer = resolveSyncer(ctx, provider, op.entityType);
      result = await syncer.processResponse(op, response);
    } catch (error) {
      const failed = await failOperation(ctx.client, {
        id: op.id,
        companyId: op.companyId,
        errorMessage: toErrorMessage(error)
      });
      if (failed.error) throw new Error(failed.error);
      return "resolved";
    }

    if (result.outcome === "completed") {
      // processResponse already linked the externalIntegrationMapping
      const completed = await completeOperation(ctx.client, {
        id: op.id,
        companyId: op.companyId,
        externalId: result.externalId
      });
      if (completed.error) throw new Error(completed.error);
      return "resolved";
    }

    if (result.outcome === "needs-followup") {
      // The op stays In Flight and rides the session's claimedOperationIds
      // into the next sendRequestXML at the persisted phase
      const updated = await updateOperationMetadata(ctx.client, {
        id: op.id,
        companyId: op.companyId,
        metadata: {
          ...(op.metadata ?? {}),
          [QBD_PHASE_METADATA_KEY]: result.nextPhase
        }
      });
      if (updated.error) throw new Error(updated.error);
      return "follow-up";
    }

    const failed = await failOperation(ctx.client, {
      id: op.id,
      companyId: op.companyId,
      ...toFailureRecord(op, result.failure)
    });
    if (failed.error) throw new Error(failed.error);
    return "resolved";
  }

  if (
    classification.kind === "retryable" &&
    classification.errorCode === "STALE_EDIT_SEQUENCE" &&
    op.metadata?.[QBD_EDIT_SEQUENCE_RETRY_METADATA_KEY] !== true
  ) {
    // Retry exactly once: flag the operation and strip the stored phase so
    // the list flow re-queries for a fresh EditSequence (resolveQbdListPhase
    // gives a stored phase precedence over the retry flag). A second 3200
    // falls through to the Failed branch below.
    const { [QBD_PHASE_METADATA_KEY]: _stalePhase, ...metadata } =
      op.metadata ?? {};
    const updated = await updateOperationMetadata(ctx.client, {
      id: op.id,
      companyId: op.companyId,
      metadata: { ...metadata, [QBD_EDIT_SEQUENCE_RETRY_METADATA_KEY]: true }
    });
    if (updated.error) throw new Error(updated.error);
    return "follow-up";
  }

  // warning → Warning (user-fixable, e.g. NAME_EXISTS / INVALID_REFERENCE);
  // retryable → Failed (QB_BUSY contention and a second stale EditSequence
  // — the inbox Retry re-enqueues, or the next backfill absorbs it);
  // fatal → Failed with the raw QB_ERROR_<code>.
  const failed = await failOperation(ctx.client, {
    id: op.id,
    companyId: op.companyId,
    ...(classification.errorCode
      ? { errorCode: classification.errorCode }
      : {}),
    errorMessage:
      response.statusMessage ||
      `QuickBooks returned status ${response.statusCode}`,
    warning: classification.kind === "warning"
  });
  if (failed.error) throw new Error(failed.error);
  return "resolved";
}

/**
 * Percent-done for receiveResponseXML: no remaining work → 100 (QBWC ends
 * the update pass); anything else → 0–99 (QBWC calls sendRequestXML
 * again), proportional to what this response resolved out of the work we
 * know about.
 */
async function percentDone(
  ctx: QbwcHandlerContext,
  companyId: string,
  args: { resolved: number; followUpCount: number }
): Promise<number> {
  const pending = await getSyncOperations(ctx.client, {
    companyId,
    integration: ProviderID.QUICKBOOKS_DESKTOP,
    status: "Pending",
    limit: 1
  });
  if (pending.error) throw new Error(pending.error);

  const remaining = args.followUpCount + (pending.count ?? 0);
  if (remaining === 0) return 100;

  const knownTotal = args.resolved + remaining;
  return Math.min(99, Math.floor((args.resolved / knownTotal) * 100));
}

/**
 * The operations pinned to a session (claimedOperationIds), re-loaded from
 * the ledger in session order. Only rows still "In Flight" belong to the
 * loop — anything already resolved (or reclaimed elsewhere) drops out.
 */
async function loadSessionOperations(
  client: SupabaseClient<Database>,
  session: QbwcSession
): Promise<SyncOperation[]> {
  const ids = session.claimedOperationIds ?? [];
  if (ids.length === 0) return [];

  const result = await getSyncOperationsByIds(client, {
    companyId: session.companyId,
    ids
  });
  if (result.error) throw new Error(result.error);

  const byId = new Map(result.data.map((op) => [op.id, op]));
  return ids
    .map((id) => byId.get(id))
    .filter((op): op is SyncOperation => !!op && op.status === "In Flight");
}

function resolveSyncer(
  ctx: QbwcHandlerContext,
  provider: QbdProvider,
  entityType: string
): QbwcPolledSyncer {
  const context: SyncContext = {
    database: ctx.database,
    companyId: provider.config.companyId,
    provider,
    config: provider.getSyncConfig(entityType as AccountingEntityType),
    entityType: entityType as AccountingEntityType
  };

  if (ctx.getSyncer) return ctx.getSyncer(context);

  const syncer = SyncFactory.getSyncer(context);
  if (!isPolledSyncer(syncer)) {
    throw new Error(
      `Syncer for entity type "${entityType}" does not implement the polled buildRequest/processResponse contract`
    );
  }
  return syncer;
}

function isPolledSyncer(value: unknown): value is QbwcPolledSyncer {
  const candidate = value as Partial<QbwcPolledSyncer> | null;
  return (
    typeof candidate?.buildRequest === "function" &&
    typeof candidate?.processResponse === "function"
  );
}

async function loadIntegration(ctx: QbwcHandlerContext, companyId: string) {
  try {
    return await getAccountingIntegration(
      ctx.client,
      companyId,
      ProviderID.QUICKBOOKS_DESKTOP
    );
  } catch {
    // Missing row / inactive parse → authenticate answers "nvu"
    return null;
  }
}

async function loadProvider(
  ctx: QbwcHandlerContext,
  companyId: string
): Promise<QbdProvider> {
  const integration = await getAccountingIntegration(
    ctx.client,
    companyId,
    ProviderID.QUICKBOOKS_DESKTOP
  );
  return getProviderIntegration(
    ctx.client,
    companyId,
    ProviderID.QUICKBOOKS_DESKTOP,
    integration.metadata
  );
}

/** Mirrors the jobs drain's structured-failure record composition. */
function toFailureRecord(
  op: Pick<SyncOperation, "metadata">,
  failure: JournalEntrySyncFailure
): {
  errorCode: string;
  errorMessage: string;
  warning: boolean;
  metadata?: Record<string, unknown>;
} {
  return {
    errorCode: failure.errorCode,
    errorMessage: failure.message,
    warning: failure.warning,
    ...(failure.metadata
      ? { metadata: { ...(op.metadata ?? {}), ...failure.metadata } }
      : {})
  };
}

function resolveQbxmlVersion(
  major: string | undefined,
  minor: string | undefined,
  stored: string | null
): string {
  const cleanMajor = major?.trim();
  if (cleanMajor) return `${cleanMajor}.${minor?.trim() || "0"}`;

  const cleanStored = stored?.trim();
  if (cleanStored) {
    return cleanStored.includes(".") ? cleanStored : `${cleanStored}.0`;
  }

  return DEFAULT_QBXML_VERSION;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
