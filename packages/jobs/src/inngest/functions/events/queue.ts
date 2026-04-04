import {
  getPostgresClient,
  getPostgresConnectionPool,
  type KyselyDatabase
} from "@carbon/database/client";
import type { HandlerType, QueueMessage } from "@carbon/database/event";
import { type Kysely, PostgresDriver, sql } from "kysely";
import { inngest } from "../../client";

const QUEUE_NAME = "event_system"; // Name of the PGMQ queue
const BATCH_SIZE = 250; // Number of messages to process per run
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
    const jobs = await step.run("read-pgmq-batch", async () => {
      const { rows } =
        await sql<QueueJob>`SELECT * FROM pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT}, ${BATCH_SIZE})`.execute(
          pg
        );
      return rows;
    });

    if (jobs.length === 0) {
      return { processed: 0 };
    }

    // Arrays for batching
    const grouped: Record<HandlerType, QueueJob[]> = {
      WEBHOOK: [],
      WORKFLOW: [],
      SYNC: [],
      SEARCH: [],
      AUDIT: []
    };

    // 2. Sort into buckets
    for (const job of jobs) {
      grouped[job.message.handlerType].push(job);
    }

    let total: number[] = [];

    // 3. Dispatch webhooks
    if (grouped.WEBHOOK.length > 0) {
      const webhookIds = await step.run("dispatch-webhooks", async () => {
        const queue: number[] = [];

        // Send events for each webhook
        const events = grouped.WEBHOOK.map((job) => {
          const event = job.message.event;
          queue.push(job.msg_id);

          return {
            name: "carbon/event-webhook" as const,
            data: {
              msgId: job.msg_id,
              url: job.message.handlerConfig.url,
              config: job.message.handlerConfig,
              data: event
            }
          };
        });

        await inngest.send(events);
        return queue;
      });
      total = total.concat(webhookIds);
    }

    // 4. Dispatch workflows
    if (grouped.WORKFLOW.length > 0) {
      const workflowIds = await step.run("dispatch-workflows", async () => {
        const queue: number[] = [];

        const events = grouped.WORKFLOW.map((job) => {
          const event = job.message.event;
          queue.push(job.msg_id);

          return {
            name: "carbon/event-workflow" as const,
            data: {
              msgId: job.msg_id,
              workflowId: job.message.handlerConfig.workflowId,
              data: event
            }
          };
        });

        await inngest.send(events);
        return queue;
      });
      total = total.concat(workflowIds);
    }

    // 5. Dispatch syncs (batched into single event)
    if (grouped.SYNC.length > 0) {
      const syncIds = await step.run("dispatch-syncs", async () => {
        const queue: number[] = [];

        const records = grouped.SYNC.map((job) => {
          queue.push(job.msg_id);

          return {
            event: job.message.event,
            companyId: job.message.companyId,
            handlerConfig: job.message.handlerConfig
          };
        });

        await inngest.send({
          name: "carbon/event-sync",
          data: { records }
        });

        return queue;
      });
      total = total.concat(syncIds);
    }

    // 6. Dispatch searches (batched into single event)
    if (grouped.SEARCH.length > 0) {
      const searchIds = await step.run("dispatch-searches", async () => {
        const queue: number[] = [];

        const records = grouped.SEARCH.map((job) => {
          queue.push(job.msg_id);

          return {
            event: job.message.event,
            companyId: job.message.companyId
          };
        });

        await inngest.send({
          name: "carbon/event-search",
          data: { records }
        });

        return queue;
      });
      total = total.concat(searchIds);
    }

    // 7. Dispatch audits (batched into single event)
    if (grouped.AUDIT.length > 0) {
      const auditIds = await step.run("dispatch-audits", async () => {
        const queue: number[] = [];

        const records = grouped.AUDIT.map((job) => {
          queue.push(job.msg_id);

          return {
            event: job.message.event,
            companyId: job.message.companyId,
            actorId: job.message.actorId,
            handlerConfig: job.message.handlerConfig
          };
        });

        await inngest.send({
          name: "carbon/event-audit",
          data: { records }
        });

        return queue;
      });
      total = total.concat(auditIds);
    }

    // 8. Delete processed messages from PGMQ
    if (total.length > 0) {
      await step.run("cleanup-pgmq", async () => {
        await sql`SELECT pgmq.delete(${QUEUE_NAME}, id::bigint) FROM unnest(${total}::bigint[]) AS id`.execute(
          pg
        );
      });
    }

    return { routed: total.length };
  }
);
