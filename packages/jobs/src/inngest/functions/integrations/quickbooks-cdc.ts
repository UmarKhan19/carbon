/**
 * QuickBooks Online CDC pull cron (spec Phase C, Task C9).
 *
 * QBO has no webhook wiring in Carbon (capabilities.supportsWebhooks =
 * false), so remote changes are polled every 30 minutes through Intuit's
 * Change Data Capture endpoint. Per company with an ACTIVE `quickbooks`
 * integration:
 *
 * 1. Resolve the QBO entity names whose RESOLVED sync config direction
 *    includes pull (getCdcPullEntityNames) — push-only types (item and
 *    purchaseOrder under the defaults) never flow back and are not fetched.
 * 2. Read the cursor from `metadata.settings.cdcCursor`; default = the
 *    integration row's `updatedAt` (the closest thing to connect time —
 *    companyIntegration has no createdAt; updatedAt is at-or-after the
 *    OAuth connect, so pre-connect history is never pulled). Cursors older
 *    than 29 days are clamped (CDC's 30-day cap) and noted in the run
 *    summary. DEVIATION from the plan: the per-entity
 *    `query(... LastUpdatedTime > cursor)` fallback for >30-day gaps was
 *    dropped as overkill — a 30-minute cron only lags that far after a
 *    month-long outage, clamping loses at most the pre-window tail, and
 *    two-way owner semantics plus the backfill path recover it naturally.
 * 3. changeDataCapture → for each change: `status: "Deleted"` stubs are
 *    logged and skipped (DELETE sync is deliberately unimplemented, house
 *    rule); everything else enqueues a pull-from-accounting ledger
 *    operation with trigger "webhook" (the established remote-change
 *    trigger), entityId = the REMOTE id, and idempotencyKey
 *    `<entityType>:<remoteId>:pull-from-accounting:cdc:<LastUpdatedTime>`
 *    — stable across cron retries, so re-runs absorb into the same rows.
 * 4. Drain via the shared Task 6 machinery (drainSyncOperations).
 * 5. Advance the cursor ONLY when every enqueue succeeded and the drain
 *    returned (Celigo rule: the cursor moves over provably-covered work),
 *    to max(changedSince, every LastUpdatedTime seen) — never to the CDC
 *    response's server time, which could outrun a lagging snapshot. The
 *    write uses the same raw-metadata read-modify-write contract as the
 *    reconciliation report (mergeCdcCursor) so sibling keys survive.
 *
 * A RatelimitError (or any throw) fails the company's step before the
 * cursor write → Inngest retries → the same window is re-fetched and
 * re-absorbed. Drain failures land Failed ledger rows (visible in Sync
 * Activity, retryable there) — they do NOT hold the cursor back; the
 * ledger row is the durable record of the change.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import {
  enqueueSyncOperation,
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  type SyncContext
} from "@carbon/ee/accounting";
import { PostgresDriver } from "kysely";
import { inngest } from "../../client";
import {
  drainSyncOperations,
  getAdvancedCdcCursor,
  getCdcCursorDecision,
  getCdcEntityType,
  getCdcIdempotencyScope,
  getCdcPullEntityNames,
  getSyncOperationActor,
  getSyncOperationIdempotencyKey,
  mergeCdcCursor,
  QBO_CDC_MAX_LOOKBACK_DAYS
} from "./accounting-sync-operations";

type CdcSummary = {
  entityNames: string[];
  changedSince: string | null;
  clamped: boolean;
  changes: number;
  deletedSkipped: number;
  enqueued: number;
  cooldownSkipped: number;
  enqueueErrors: number;
  drain: {
    claimed: number;
    completed: number;
    failed: number;
    skipped: number;
  } | null;
  cursorAdvancedTo: string | null;
  skippedReason?: string;
};

const emptySummary = (): CdcSummary => ({
  entityNames: [],
  changedSince: null,
  clamped: false,
  changes: 0,
  deletedSkipped: 0,
  enqueued: 0,
  cooldownSkipped: 0,
  enqueueErrors: 0,
  drain: null,
  cursorAdvancedTo: null
});

async function pullChangesForCompany(args: {
  companyId: string;
  database: SyncContext["database"];
}): Promise<CdcSummary> {
  const { companyId, database } = args;
  const client = getCarbonServiceRole();
  const summary = emptySummary();

  const integration = await getAccountingIntegration(
    client,
    companyId,
    ProviderID.QUICKBOOKS
  );

  // Re-check inside the step: the sync config may have changed between
  // enumeration and execution
  const entityNames = getCdcPullEntityNames(integration.metadata);
  summary.entityNames = entityNames;
  if (entityNames.length === 0) {
    return { ...summary, skippedReason: "no entities with a pull direction" };
  }

  const cursorDecision = getCdcCursorDecision({
    integrationMetadata: integration.metadata,
    integrationUpdatedAt: integration.updatedAt ?? null
  });
  summary.changedSince = cursorDecision.changedSince;
  summary.clamped = cursorDecision.clamped;
  if (cursorDecision.clamped) {
    console.warn(
      `[QBO CDC] ${companyId}: cursor predates the ${QBO_CDC_MAX_LOOKBACK_DAYS}-day CDC window; clamped to ${cursorDecision.changedSince} — changes before the window are recovered by two-way owner semantics or a backfill`
    );
  }

  const provider = getProviderIntegration(
    client,
    companyId,
    integration.id,
    integration.metadata
  );

  const changes = await provider.changeDataCapture(
    entityNames,
    cursorDecision.changedSince
  );
  summary.changes = changes.length;

  const createdBy = getSyncOperationActor(integration);
  const lastUpdatedTimes: Array<string | null> = [];

  for (const change of changes) {
    lastUpdatedTimes.push(change.lastUpdatedTime);

    const entityType = getCdcEntityType(change.entityName);
    if (!entityType) {
      console.warn(
        `[QBO CDC] ${companyId}: ignoring change for unmapped entity "${change.entityName}"`
      );
      continue;
    }

    if (change.deleted) {
      // House rule: DELETE sync is deliberately unimplemented — log + skip
      summary.deletedSkipped++;
      console.info(
        `[QBO CDC] ${companyId}: skipping deleted ${entityType} ${change.id} (remote deletions are not synced)`
      );
      continue;
    }

    const enqueued = await enqueueSyncOperation(client, {
      companyId,
      integration: ProviderID.QUICKBOOKS,
      entityType,
      entityId: change.id,
      direction: "pull-from-accounting",
      trigger: "webhook",
      idempotencyKey: getSyncOperationIdempotencyKey({
        entityType,
        entityId: change.id,
        direction: "pull-from-accounting",
        scope: getCdcIdempotencyScope(
          change.lastUpdatedTime,
          cursorDecision.changedSince
        )
      }),
      createdBy
    });

    if (enqueued.error) {
      summary.enqueueErrors++;
      console.error(
        `[QBO CDC] ${companyId}: failed to enqueue ${entityType} ${change.id}: ${enqueued.error}`
      );
    } else if (enqueued.data) {
      summary.enqueued++;
    } else {
      summary.cooldownSkipped++;
    }
  }

  // Drain through the shared machinery (a RatelimitError propagates so the
  // step retries; claimed rows stay In Flight and become re-claimable once
  // stale)
  const drain = await drainSyncOperations({
    client,
    database,
    companyId,
    integration: ProviderID.QUICKBOOKS,
    provider,
    integrationMetadata: integration.metadata
  });
  summary.drain = {
    claimed: drain.claimed,
    completed: drain.completed,
    failed: drain.failed,
    skipped: drain.skipped
  };

  // Celigo cursor rule: advance only over provably-covered work — every
  // change either enqueued into the ledger (drain failures are durable
  // Failed rows with UI retry, so they do not hold the cursor back) or was
  // a logged-and-skipped deletion.
  if (summary.enqueueErrors > 0) {
    console.warn(
      `[QBO CDC] ${companyId}: ${summary.enqueueErrors} enqueue error(s); holding the cursor at ${cursorDecision.changedSince} so the next run re-fetches the window`
    );
    return summary;
  }

  const nextCursor = getAdvancedCdcCursor({
    changedSince: cursorDecision.changedSince,
    lastUpdatedTimes
  });

  // Skip the no-op write when an unclamped stored cursor saw no newer
  // changes; clamps and first runs persist so the default/clamp becomes
  // the durable cursor
  const shouldStore =
    nextCursor !== cursorDecision.changedSince ||
    cursorDecision.clamped ||
    cursorDecision.source !== "cursor";

  if (shouldStore) {
    await storeCdcCursor(client, { companyId, cursor: nextCursor });
    summary.cursorAdvancedTo = nextCursor;
  }

  return summary;
}

/**
 * Read-modify-write against the RAW stored metadata (not the zod-parsed
 * copy from getAccountingIntegration) so no sibling key can be clobbered —
 * same contract as the reconciliation report store.
 */
async function storeCdcCursor(
  client: ReturnType<typeof getCarbonServiceRole>,
  args: { companyId: string; cursor: string }
): Promise<void> {
  const current = await client
    .from("companyIntegration")
    .select("metadata")
    .eq("id", ProviderID.QUICKBOOKS)
    .eq("companyId", args.companyId)
    .single();

  if (current.error) {
    throw new Error(
      `Failed to read integration metadata: ${current.error.message}`
    );
  }

  const merged = mergeCdcCursor(current.data?.metadata, args.cursor);

  const updated = await client
    .from("companyIntegration")
    .update({ metadata: merged as any })
    .eq("id", ProviderID.QUICKBOOKS)
    .eq("companyId", args.companyId);

  if (updated.error) {
    throw new Error(`Failed to store CDC cursor: ${updated.error.message}`);
  }
}

export const quickbooksCdcFunction = inngest.createFunction(
  { id: "quickbooks-cdc", retries: 2 },
  { cron: "*/30 * * * *" }, // every 30 minutes
  async ({ step }) => {
    const client = getCarbonServiceRole();

    // Companies with an ACTIVE quickbooks integration that has at least one
    // pull-direction entity (re-checked inside each company step)
    const targets = await step.run("find-quickbooks-cdc-targets", async () => {
      const integrations = await client
        .from("companyIntegration")
        .select("companyId, metadata")
        .eq("id", ProviderID.QUICKBOOKS)
        .eq("active", true);

      if (integrations.error) {
        throw new Error(
          `Failed to list QuickBooks integrations: ${integrations.error.message}`
        );
      }

      return (integrations.data ?? [])
        .filter((row) => getCdcPullEntityNames(row.metadata).length > 0)
        .map((row) => ({ companyId: row.companyId }));
    });

    if (targets.length === 0) {
      return { targets: 0, results: [] };
    }

    const results: Array<{ companyId: string } & CdcSummary> = [];

    for (const target of targets) {
      const result = await step.run(`cdc-${target.companyId}`, async () => {
        const pool = getPostgresConnectionPool(5);
        const database = getPostgresClient(pool, PostgresDriver);
        try {
          return await pullChangesForCompany({
            companyId: target.companyId,
            database
          });
        } finally {
          await pool.end();
        }
      });

      results.push({ companyId: target.companyId, ...result });
    }

    return { targets: targets.length, results };
  }
);
