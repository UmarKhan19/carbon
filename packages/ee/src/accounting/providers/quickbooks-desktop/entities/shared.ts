import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getAccountMappings } from "../../../core/account-mapping";
import { createMappingService } from "../../../core/external-mapping";
import {
  JournalEntrySyncError,
  type JournalEntrySyncFailure
} from "../../../core/posting";
import {
  BaseEntitySyncer,
  type BatchSyncResult,
  type SyncOperation,
  type SyncResult
} from "../../../core/types";
import { withTriggersDisabled } from "../../../core/utils";
import type { QbdListRet, QbdRef, QbdTxnRet } from "../qbxml/entities/shared";
import { classifyStatus, QbxmlValidationError } from "../qbxml/errors";
import type { QbxmlResponse } from "../qbxml/parse";

/**
 * QuickBooks Desktop entity syncers — the TWO-PHASE POLLED-TRANSPORT
 * CONTRACT (read this before writing the QBWC work loop, D7/D8).
 *
 * QBD syncers do NOT implement synchronous push: `pushToAccounting` /
 * `pullFromAccounting` return descriptive errors ("polled transport —
 * operations are drained by the Web Connector poll"). Instead each syncer
 * implements two halves the QBWC session loop drives:
 *
 *   syncer = SyncFactory.getSyncer({ database, companyId, provider,
 *     config: provider.getSyncConfig(entityType), entityType })
 *
 *   buildRequest(op)              → QbdBuildRequestResult
 *   processResponse(op, response) → QbdProcessResponseResult
 *
 * `op` is the claimed accountingSyncOperation row (id, entityId, metadata).
 * The SyncContext (database/companyId/provider/config) is supplied at
 * construction via SyncFactory — the halves take no separate ctx argument.
 *
 * buildRequest (runs at claim time, so pre-flights see the freshest data):
 * - `{ outcome: "request", requestXml, phase }` — a `<*Rq>` element (its
 *   requestID attribute is op.id) ready for buildMessageSet. The handler
 *   MUST persist `phase` to `op.metadata.qbdPhase` BEFORE sending, so a
 *   crash-recovered batch resumes at the right phase.
 * - `{ outcome: "completed", reason, externalId? }` — nothing to send:
 *   idempotent skip (already mapped) or a shouldSync-style gate (wrong
 *   status, posting sync disabled, excluded sourceType). The handler
 *   closes the operation via completeOperation (with externalId when
 *   present), exactly like the REST drain closes skips.
 * - `{ outcome: "failed", failure }` — a structured pre-flight failure
 *   (JournalEntrySyncFailure: UNMAPPED_ACCOUNTS, NAME_TOO_LONG,
 *   PERIOD_LOCKED, UNBALANCED_JOURNAL, ...). The handler records it via
 *   failOperation({ errorCode, errorMessage: failure.message, warning:
 *   failure.warning, metadata }) and the op drops out of the batch.
 * - THROWS a plain Error for programmer/sequencing bugs (entity not found,
 *   dependency with neither mapping nor name). The handler catches per-op
 *   and fails the operation with the flattened message (non-warning).
 *
 * processResponse — call ONLY for statuses classifyStatus maps to `ok` or
 * `not-found`; the handler owns `warning`/`retryable`/`fatal` statuses
 * (fail/retry per the D8 table) and MUST NOT forward them here (a plain
 * Error is thrown if it does). The syncer branches on `response.rqType`
 * (e.g. "CustomerQuery" vs "CustomerAdd"), not on stored phase, and
 * performs its own mapping writes (externalIntegrationMapping link with
 * ListID/TxnID as externalId and EditSequence in mapping metadata):
 * - `{ outcome: "completed", externalId, editSequence }` — the op is done;
 *   the handler calls completeOperation({ externalId }).
 * - `{ outcome: "needs-followup", nextPhase }` — persist
 *   `op.metadata.qbdPhase = nextPhase` and keep the op claimed: its next
 *   buildRequest (same session loop, next sendRequestXML) continues the
 *   flow.
 * - `{ outcome: "failed", failure }` — reserved for entity-level failures;
 *   current syncers throw plain Errors for malformed payloads instead, but
 *   the handler must support it (failOperation with the envelope).
 *
 * MULTI-PHASE FLOWS (the op's CURRENT phase lives in
 * `op.metadata.qbdPhase`; buildRequest reads it, processResponse returns
 * nextPhase for the handler to persist):
 *
 * Lists (customer/vendor/item) — query-before-insert by FullName:
 * - unmapped op → phase "query". Query hit → link mapping (ListID +
 *   EditSequence) + `needs-followup` nextPhase "mod" — Carbon owns push
 *   data, so the matched QB object is updated with Carbon's fields (all
 *   three list entities use query→mod on match; none complete on the bare
 *   link). Query miss (statusCode 1) → `needs-followup` nextPhase "add".
 * - mapped op with a stored EditSequence → phase "mod" directly.
 * - mapped op with no stored EditSequence, or enqueued with
 *   `metadata.editSequenceRetry: true` (the D8 STALE_EDIT_SEQUENCE retry)
 *   → phase "query" first to refresh ListID/EditSequence, then "mod".
 * - The FullName probe is the Carbon name/code verbatim (top-level names
 *   only — hierarchical QB customers/jobs are not matched in v1).
 *
 * Transactions (invoice/bill/purchaseOrder/journalEntry) — NO query phase:
 * - mapping exists → buildRequest returns `completed` (already pushed,
 *   idempotent). Otherwise phase "add" directly. The RefNumber/Memo stamp
 *   (`Carbon <readableId> <entityId>`, D4) is the dedupe belt and
 *   newMessageSetID error recovery (D3/D8) is the true double-post guard —
 *   a query round trip per transaction is not worth it in v1.
 *
 * Dependency references (customer/vendor on documents, item on lines)
 * resolve mapping-first with a FullName fallback: if the dependency has no
 * QBD mapping yet, the request carries `<FullName>` (the Carbon name/code)
 * and QuickBooks resolves it by name — an unknown name comes back 3140
 * INVALID_REFERENCE (Warning, user-fixable, retryable after the dependency
 * syncs). There is NO JIT dependency push (ensureDependencySynced) on a
 * polled transport.
 */

// /********************************************************\
// *              Two-phase contract types                   *
// \********************************************************/

/** Request phases a polled operation can be in. */
export type QbdRequestPhase = "query" | "add" | "mod";

/** Operation-metadata key the QBWC handler persists the phase under. */
export const QBD_PHASE_METADATA_KEY = "qbdPhase";

/**
 * Operation-metadata flag D8 sets on the ONE automatic retry it enqueues
 * after a 3200 STALE_EDIT_SEQUENCE: forces the list flow back through
 * "query" so the Mod uses a fresh EditSequence.
 */
export const QBD_EDIT_SEQUENCE_RETRY_METADATA_KEY = "editSequenceRetry";

/** The slice of a claimed sync operation the polled halves need. */
export type QbdOperationInput = Pick<SyncOperation, "id" | "entityId"> & {
  metadata?: SyncOperation["metadata"];
};

export type QbdBuildRequestResult =
  | {
      outcome: "request";
      /** A `<*Rq requestID="{op.id}">` element for buildMessageSet. */
      requestXml: string;
      /** Persist to op.metadata.qbdPhase BEFORE sending. */
      phase: QbdRequestPhase;
    }
  | {
      outcome: "completed";
      /** Why nothing was sent (idempotent skip or eligibility gate). */
      reason: string;
      /** Present on idempotent skips — pass to completeOperation. */
      externalId?: string;
    }
  | { outcome: "failed"; failure: JournalEntrySyncFailure };

export type QbdProcessResponseResult =
  | {
      outcome: "completed";
      /** ListID (lists) or TxnID (transactions). */
      externalId: string;
      editSequence: string | null;
    }
  | { outcome: "needs-followup"; nextPhase: QbdRequestPhase }
  | { outcome: "failed"; failure: JournalEntrySyncFailure };

/** Read + validate the stored phase off operation metadata. */
export function getQbdPhase(op: QbdOperationInput): QbdRequestPhase | null {
  const stored = op.metadata?.[QBD_PHASE_METADATA_KEY];
  return stored === "query" || stored === "add" || stored === "mod"
    ? stored
    : null;
}

/**
 * Resolve the phase for a LIST entity operation (see the module header for
 * the flow): the stored phase wins; otherwise unmapped → "query", mapped
 * with a stored EditSequence → "mod", mapped without one (or flagged
 * editSequenceRetry) → "query" to refresh it.
 */
export function resolveQbdListPhase(
  op: QbdOperationInput,
  mapping: {
    externalId: string | null;
    metadata: Record<string, unknown> | null;
  } | null
): QbdRequestPhase {
  const stored = getQbdPhase(op);
  if (stored) return stored;

  if (!mapping?.externalId) return "query";
  if (op.metadata?.[QBD_EDIT_SEQUENCE_RETRY_METADATA_KEY] === true) {
    return "query";
  }
  return readEditSequence(mapping) ? "mod" : "query";
}

/** The EditSequence stored in mapping metadata by persistLink, if any. */
export function readEditSequence(
  mapping: { metadata: Record<string, unknown> | null } | null
): string | null {
  const value = mapping?.metadata?.editSequence;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The message every direct push/pull entry point returns. */
export const QBD_POLLED_TRANSPORT_ERROR =
  "QuickBooks Desktop is a polled transport — operations are drained by the Web Connector poll (buildRequest/processResponse), not pushed synchronously";

/**
 * Carbon account.id → QuickBooks ListID from the account-mapping rows
 * (entityType "account", integration "quickbooks-desktop" — the mapping's
 * externalId is the QB account ListID). Mappings without a stored
 * externalId are treated as unmapped. Same resolution path as
 * loadQboAccountRefsById, returning the bare ListID the qbXML builders
 * take.
 */
export async function loadQbdAccountListIdsById(
  database: Kysely<KyselyDatabase>,
  args: { companyId: string; integration: string }
): Promise<Map<string, string>> {
  const mappings = await getAccountMappings(database, {
    companyId: args.companyId,
    integration: args.integration
  });

  if (mappings.error) {
    throw new Error(`Failed to load account mappings: ${mappings.error}`);
  }

  const listIdsById = new Map<string, string>();
  for (const mapping of mappings.data ?? []) {
    if (mapping.externalId) {
      listIdsById.set(mapping.accountId, mapping.externalId);
    }
  }
  return listIdsById;
}

/** Builders a list-entity syncer supplies to the shared list flow. */
export interface QbdListRequestBuilders {
  buildQueryRq(requestID: string): string;
  buildAddRq(requestID: string): string;
  buildModRq(requestID: string, listId: string, editSequence: string): string;
}

/**
 * Base class for the QuickBooks Desktop entity syncers. Extends
 * BaseEntitySyncer so SyncFactory constructs them with the standard
 * SyncContext and the mapping service plumbing is inherited — but the
 * entire remote surface is stubbed: this provider has no synchronous API.
 */
export abstract class QbdEntitySyncer<TLocal> extends BaseEntitySyncer<
  TLocal,
  Record<string, unknown>,
  never
> {
  // =================================================================
  // 1. THE TWO POLLED HALVES (implemented per entity)
  // =================================================================

  abstract buildRequest(op: QbdOperationInput): Promise<QbdBuildRequestResult>;

  abstract processResponse(
    op: QbdOperationInput,
    response: QbxmlResponse
  ): Promise<QbdProcessResponseResult>;

  // =================================================================
  // 2. SHARED PLUMBING
  // =================================================================

  /**
   * Wrap a buildRequest body: structured builder/pre-flight throws
   * (QbxmlValidationError from the D4 builders, JournalEntrySyncError from
   * the shared pre-flights) become `{ outcome: "failed", failure }`; plain
   * Errors propagate (the handler fails the op with the flattened message).
   */
  protected async runBuild(
    fn: () => Promise<QbdBuildRequestResult>
  ): Promise<QbdBuildRequestResult> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof QbxmlValidationError ||
        error instanceof JournalEntrySyncError
      ) {
        return { outcome: "failed", failure: error.failure };
      }
      throw error;
    }
  }

  /** The operation entity's own mapping row (this.entityType). */
  protected getMapping(entityId: string) {
    return this.mappingService.getByEntity(
      this.entityType,
      entityId,
      this.provider.id
    );
  }

  /**
   * Link the entity to its QuickBooks object: ListID/TxnID as the mapping
   * externalId, EditSequence in mapping metadata (the Mod path and the
   * stale-EditSequence retry read it back). Wrapped in withTriggersDisabled
   * like every sync-time DB write. Overridden in tests to observe links.
   */
  protected async persistLink(
    entityId: string,
    externalId: string,
    editSequence: string | null
  ): Promise<void> {
    await withTriggersDisabled(this.database, async (tx) => {
      const txMappingService = createMappingService(tx, this.companyId);
      await txMappingService.link(
        this.entityType,
        entityId,
        this.provider.id,
        externalId,
        editSequence !== null ? { metadata: { editSequence } } : {}
      );
    });
  }

  /**
   * Reference to a dependency (customer/vendor/item) for a `*Ref` block:
   * the dependency's mapped ListID when it exists, else the FullName
   * fallback (see the module header — no JIT dependency push on a polled
   * transport).
   */
  protected buildDependencyRef(
    externalId: string | null | undefined,
    fullName: string | null | undefined
  ): QbdRef {
    return { listId: externalId ?? null, fullName: fullName ?? null };
  }

  /**
   * Guard: processResponse only owns `ok` and `not-found` statuses — the
   * QBWC handler routes warning/retryable/fatal statuses through its own
   * classifyStatus table and must not forward them here.
   */
  protected assertProcessableStatus(
    response: QbxmlResponse
  ): "ok" | "not-found" {
    const { kind } = classifyStatus(
      response.statusCode,
      response.statusSeverity
    );
    if (kind === "ok" || kind === "not-found") return kind;
    throw new Error(
      `processResponse received a ${kind} status (${response.statusCode}) for ${response.rqType}; the QBWC handler owns warning/retryable/fatal statuses via classifyStatus`
    );
  }

  /**
   * Shared list-entity flow: resolve the phase (query-before-insert /
   * add / mod per the module header) and build the request. The caller
   * validates entity-specific constraints (name caps) BEFORE calling so a
   * NAME_TOO_LONG surfaces without a wasted query round trip.
   */
  protected async buildListRequest(
    op: QbdOperationInput,
    builders: QbdListRequestBuilders
  ): Promise<QbdBuildRequestResult> {
    const mapping = await this.getMapping(op.entityId);
    const phase = resolveQbdListPhase(op, mapping);

    if (phase === "query") {
      return {
        outcome: "request",
        requestXml: builders.buildQueryRq(op.id),
        phase
      };
    }

    if (phase === "add") {
      return {
        outcome: "request",
        requestXml: builders.buildAddRq(op.id),
        phase
      };
    }

    // mod — needs the mapped ListID + a stored EditSequence; a stored
    // "mod" phase without them (defensive) falls back to a fresh query
    const listId = mapping?.externalId ?? null;
    const editSequence = readEditSequence(mapping);
    if (!listId || !editSequence) {
      return {
        outcome: "request",
        requestXml: builders.buildQueryRq(op.id),
        phase: "query"
      };
    }

    return {
      outcome: "request",
      requestXml: builders.buildModRq(op.id, listId, editSequence),
      phase
    };
  }

  /**
   * Shared list-entity response flow (see the module header): Query miss →
   * add; Query hit → link + mod; Add/Mod → link + completed.
   */
  protected async processListResponse(
    op: QbdOperationInput,
    response: QbxmlResponse,
    args: {
      parseRet: (payload: unknown) => QbdListRet | null;
      entityLabel: string;
    }
  ): Promise<QbdProcessResponseResult> {
    this.assertProcessableStatus(response);

    const ret = args.parseRet(response.payload);

    if (response.rqType.endsWith("Query")) {
      if (!ret) {
        return { outcome: "needs-followup", nextPhase: "add" };
      }
      await this.persistLink(op.entityId, ret.listId, ret.editSequence);
      return { outcome: "needs-followup", nextPhase: "mod" };
    }

    if (!ret) {
      throw new Error(
        `${response.rqType} for ${args.entityLabel} ${op.entityId} succeeded but returned no Ret`
      );
    }

    await this.persistLink(op.entityId, ret.listId, ret.editSequence);
    return {
      outcome: "completed",
      externalId: ret.listId,
      editSequence: ret.editSequence
    };
  }

  /**
   * Shared transaction response flow: transactions only ever send Add in
   * v1, so a processable response is a completed write to link.
   */
  protected async processTxnResponse(
    op: QbdOperationInput,
    response: QbxmlResponse,
    args: {
      parseRet: (payload: unknown) => QbdTxnRet | null;
      entityLabel: string;
    }
  ): Promise<QbdProcessResponseResult> {
    this.assertProcessableStatus(response);

    const ret = args.parseRet(response.payload);
    if (!ret) {
      throw new Error(
        `${response.rqType} for ${args.entityLabel} ${op.entityId} succeeded but returned no Ret`
      );
    }

    await this.persistLink(op.entityId, ret.txnId, ret.editSequence);
    return {
      outcome: "completed",
      externalId: ret.txnId,
      editSequence: ret.editSequence
    };
  }

  // =================================================================
  // 3. LOCAL FETCH — batch composes the per-entity single fetch
  // =================================================================

  protected async fetchLocalBatch(ids: string[]): Promise<Map<string, TLocal>> {
    const result = new Map<string, TLocal>();
    for (const id of ids) {
      const local = await this.fetchLocal(id);
      if (local) result.set(id, local);
    }
    return result;
  }

  // =================================================================
  // 4. REMOTE SURFACE — none (polled transport)
  // =================================================================

  protected async fetchRemote(): Promise<Record<string, unknown> | null> {
    throw new Error(QBD_POLLED_TRANSPORT_ERROR);
  }

  protected async fetchRemoteBatch(): Promise<
    Map<string, Record<string, unknown>>
  > {
    throw new Error(QBD_POLLED_TRANSPORT_ERROR);
  }

  protected async mapToRemote(): Promise<Record<string, unknown>> {
    throw new Error(QBD_POLLED_TRANSPORT_ERROR);
  }

  protected async mapToLocal(): Promise<Partial<TLocal>> {
    throw new Error(QBD_POLLED_TRANSPORT_ERROR);
  }

  protected getRemoteUpdatedAt(): Date | null {
    return null;
  }

  protected async upsertLocal(): Promise<string> {
    throw new Error(QBD_POLLED_TRANSPORT_ERROR);
  }

  protected async upsertRemote(): Promise<string> {
    throw new Error(QBD_POLLED_TRANSPORT_ERROR);
  }

  protected async upsertRemoteBatch(): Promise<Map<string, string>> {
    throw new Error(QBD_POLLED_TRANSPORT_ERROR);
  }

  // =================================================================
  // 5. DIRECT PUSH/PULL — descriptive errors (drained by the poll)
  // =================================================================

  async pushToAccounting(entityId: string): Promise<SyncResult> {
    return {
      status: "error",
      action: "none",
      localId: entityId,
      error: QBD_POLLED_TRANSPORT_ERROR
    };
  }

  async pullFromAccounting(remoteId: string): Promise<SyncResult> {
    return {
      status: "error",
      action: "none",
      remoteId,
      error: QBD_POLLED_TRANSPORT_ERROR
    };
  }

  async pushBatchToAccounting(entityIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = entityIds.map((localId) => ({
      status: "error",
      action: "none",
      localId,
      error: QBD_POLLED_TRANSPORT_ERROR
    }));
    return {
      results,
      successCount: 0,
      errorCount: results.length,
      skippedCount: 0
    };
  }

  async pullBatchFromAccounting(remoteIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = remoteIds.map((remoteId) => ({
      status: "error",
      action: "none",
      remoteId,
      error: QBD_POLLED_TRANSPORT_ERROR
    }));
    return {
      results,
      successCount: 0,
      errorCount: results.length,
      skippedCount: 0
    };
  }
}
