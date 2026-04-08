import {
  getPostgresClient,
  getPostgresConnectionPool,
  type KyselyDatabase
} from "@carbon/database/client";
import type { HandlerType, QueueMessage } from "@carbon/database/event";
import { type Kysely, PostgresDriver, sql } from "kysely";
import { inngest } from "../../client";

const QUEUE_NAME = "event_system"; // Name of the PGMQ queue
const BATCH_SIZE = 100; // Number of messages to process per run
const VISIBILITY_TIMEOUT = 30; // Seconds a message is hidden after being read

const getDatabaseClient = (size: number) => {
  const pool = getPostgresConnectionPool(size);
  return getPostgresClient(
    pool,
    PostgresDriver
  ) as unknown as Kysely<KyselyDatabase>;
};

type QueueJob = {
  msg_id: number;
  message: QueueMessage;
};

/**
 * Event queue cron function - polls PGMQ every minute and routes events to handlers.
 * This is the critical bridge between PostgreSQL events and inngest handlers.
 */
export const eventQueueFunction = inngest.createFunction(
  {
    id: "event-queue",
    retries: 2
  },
  { cron: "* * * * *" }, // Every minute
  async ({ step }) => {
    const pg = getDatabaseClient(1);

    // 1. Read batch from PGMQ
    const { rows: jobs } =
      await sql<QueueJob>`SELECT * FROM pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT}, ${BATCH_SIZE})`.execute(
        pg
      );

    if (jobs.length === 0) {
      return { processed: 0 };
    }

    // Arrays for batching
    const grouped: Record<HandlerType, QueueJob[]> = {
      WEBHOOK: [],
      WORKFLOW: [],
      SYNC: [],
      SEARCH: [],
      AUDIT: [],
      EMBEDDING: []
    };

    // 2. Sort into buckets
    for (const job of jobs) {
      grouped[job.message.handlerType].push(job);
    }

    let total: number[] = [];

    // 3. Dispatch webhooks
    if (grouped.WEBHOOK.length > 0) {
      const ids = grouped.WEBHOOK.map((job) => job.msg_id);
      const events = grouped.WEBHOOK.map((job) => ({
        name: "carbon/event-webhook" as const,
        data: {
          msgId: job.msg_id,
          url: job.message.handlerConfig.url,
          config: job.message.handlerConfig,
          data: job.message.event
        }
      }));

      await step.sendEvent("dispatch-webhooks", events);
      total = total.concat(ids);
    }

    // 4. Dispatch workflows
    if (grouped.WORKFLOW.length > 0) {
      const ids = grouped.WORKFLOW.map((job) => job.msg_id);
      const events = grouped.WORKFLOW.map((job) => ({
        name: "carbon/event-workflow" as const,
        data: {
          msgId: job.msg_id,
          workflowId: job.message.handlerConfig.workflowId,
          data: job.message.event
        }
      }));

      await step.sendEvent("dispatch-workflows", events);
      total = total.concat(ids);
    }

    // 5. Dispatch syncs (batched into single event)
    if (grouped.SYNC.length > 0) {
      const ids = grouped.SYNC.map((job) => job.msg_id);
      const records = grouped.SYNC.map((job) => ({
        event: job.message.event,
        companyId: job.message.companyId,
        handlerConfig: job.message.handlerConfig
      }));

      await step.sendEvent("dispatch-syncs", {
        name: "carbon/event-sync" as const,
        data: { records }
      });
      total = total.concat(ids);
    }

    // 6. Dispatch searches (batched into single event)
    if (grouped.SEARCH.length > 0) {
      const ids = grouped.SEARCH.map((job) => job.msg_id);
      const records = grouped.SEARCH.map((job) => ({
        event: job.message.event,
        companyId: job.message.companyId
      }));

      await step.sendEvent("dispatch-searches", {
        name: "carbon/event-search" as const,
        data: { records }
      });
      total = total.concat(ids);
    }

    // 7. Dispatch audits (batched into single event)
    if (grouped.AUDIT.length > 0) {
      const ids = grouped.AUDIT.map((job) => job.msg_id);
      const records = grouped.AUDIT.map((job) => ({
        event: job.message.event,
        companyId: job.message.companyId,
        actorId: job.message.actorId,
        handlerConfig: job.message.handlerConfig
      }));

      await step.sendEvent("dispatch-audits", {
        name: "carbon/event-audit" as const,
        data: { records }
      });
      total = total.concat(ids);
    }

    // 8. Dispatch embeddings (batched into single event)
    if (grouped.EMBEDDING.length > 0) {
      const ids = grouped.EMBEDDING.map((job) => job.msg_id);
      const records = grouped.EMBEDDING.map((job) => ({
        event: job.message.event,
        companyId: job.message.companyId
      }));

      await step.sendEvent("dispatch-embeddings", {
        name: "carbon/event-embedding" as const,
        data: { records }
      });
      total = total.concat(ids);
    }

    // 9. Delete processed messages from PGMQ
    if (total.length > 0) {
      await sql`SELECT pgmq.delete(${QUEUE_NAME}, id::bigint) FROM unnest(${total}::bigint[]) AS id`.execute(
        pg
      );
    }

    return { routed: total.length };
  }
);
