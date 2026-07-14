import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";

// Job Operation Batching — membership lifecycle for a jobOperationBatch, a
// lightweight join over N real jobOperation rows that share one batchable
// process. Jobs are never merged: every member operation stays a first-class row
// on its own job. This function owns create / add / remove / updateWorkCenter /
// dissolve — all pure FK writes with nothing to unwind (they are blocked once any
// production event exists). Completion (event slicing + per-member issue + GL) is
// a separate flow that consumes shared/batch-time-split.ts.
//
// Follows .ai/rules/workflow-edge-function.md: module-scoped Kysely pool,
// requirePermissions gate, companyId + audit fields on every write.

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

// A candidate operation is "unstarted" while in one of these statuses AND with no
// productionEvent recorded (the started gate below checks both).
const UNSTARTED_STATUSES = ["Todo", "Ready", "Waiting"];

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    companyId: z.string(),
    userId: z.string(),
    processId: z.string(),
    locationId: z.string(),
    workCenterId: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    jobOperationIds: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal("add"),
    companyId: z.string(),
    userId: z.string(),
    jobOperationBatchId: z.string(),
    jobOperationIds: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal("remove"),
    companyId: z.string(),
    userId: z.string(),
    jobOperationBatchId: z.string(),
    jobOperationIds: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal("updateWorkCenter"),
    companyId: z.string(),
    userId: z.string(),
    jobOperationBatchId: z.string(),
    workCenterId: z.string().nullable(),
  }),
  z.object({
    type: z.literal("dissolve"),
    companyId: z.string(),
    userId: z.string(),
    jobOperationBatchId: z.string(),
  }),
]);

// Throws if any batch production event exists — the guard for add/remove/dissolve.
// `recoveryNoun` names the action so the error can point at the recovery.
async function assertNoBatchProductionEvent(
  // deno-lint-ignore no-explicit-any
  trx: any,
  jobOperationBatchId: string,
  companyId: string,
  action: string
) {
  const event = await trx
    .selectFrom("productionEvent")
    .select("id")
    .where("jobOperationBatchId", "=", jobOperationBatchId)
    .where("companyId", "=", companyId)
    .limit(1)
    .executeTakeFirst();

  if (event) {
    if (action === "dissolve") {
      throw new Error(
        "Cannot dissolve a batch after production has started — complete the batch to finish it"
      );
    }
    throw new Error(
      `Cannot ${action} a batch after production has started — complete the batch to finish it`
    );
  }
}

// Validates that each candidate operation may join a batch on `processId`, throwing
// a specific error (AC[4]) on the first violation. Returns nothing on success.
async function assertOperationsEligible(
  // deno-lint-ignore no-explicit-any
  trx: any,
  jobOperationIds: string[],
  processId: string,
  companyId: string
) {
  const operations = await trx
    .selectFrom("jobOperation")
    .select(["id", "processId", "status", "jobOperationBatchId"])
    .where("id", "in", jobOperationIds)
    .where("companyId", "=", companyId)
    .execute();

  const found = new Set(operations.map((o: { id: string }) => o.id));
  for (const id of jobOperationIds) {
    if (!found.has(id)) throw new Error(`Operation ${id} was not found`);
  }

  for (const op of operations) {
    if (op.processId !== processId) {
      throw new Error(
        "All operations in a batch must share the same process"
      );
    }
    if (op.jobOperationBatchId) {
      throw new Error(`Operation ${op.id} is already in a batch`);
    }
    if (!UNSTARTED_STATUSES.includes(op.status)) {
      throw new Error(
        `Operation ${op.id} has already started and cannot be batched`
      );
    }
  }

  // No productionEvent recorded against any candidate (started via a timer even
  // if the status has not flipped).
  const startedEvent = await trx
    .selectFrom("productionEvent")
    .select("jobOperationId")
    .where("jobOperationId", "in", jobOperationIds)
    .where("companyId", "=", companyId)
    .limit(1)
    .executeTakeFirst();

  if (startedEvent) {
    throw new Error(
      `Operation ${startedEvent.jobOperationId} has already started and cannot be batched`
    );
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const parsed = payloadValidator.parse(payload);
    const { companyId, userId } = parsed;

    // Batch mutations are production updates.
    await requirePermissions(req, companyId, userId, {
      update: "production",
    });

    const now = new Date().toISOString();

    const result = await db.transaction().execute(async (trx) => {
      switch (parsed.type) {
        case "create": {
          const { processId, jobOperationIds } = parsed;

          const process = await trx
            .selectFrom("process")
            .select(["id", "batchable"])
            .where("id", "=", processId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();

          if (!process) throw new Error(`Process ${processId} was not found`);
          if (!process.batchable) {
            throw new Error(`Process ${processId} is not batchable`);
          }

          await assertOperationsEligible(
            trx,
            jobOperationIds,
            processId,
            companyId
          );

          const readableId = await getNextSequence(
            trx,
            "jobOperationBatch",
            companyId
          );

          const id = nanoid();
          await trx
            .insertInto("jobOperationBatch")
            .values({
              id,
              readableId,
              companyId,
              processId,
              locationId: parsed.locationId,
              workCenterId: parsed.workCenterId ?? null,
              notes: parsed.notes ?? null,
              status: "Active",
              createdBy: userId,
              createdAt: now,
            })
            .execute();

          // Tag members; assigning a work center propagates it to every member
          // operation (batching physically puts the job on that machine).
          const memberUpdate: Record<string, unknown> = {
            jobOperationBatchId: id,
            updatedBy: userId,
            updatedAt: now,
          };
          if (parsed.workCenterId) {
            memberUpdate.workCenterId = parsed.workCenterId;
          }

          await trx
            .updateTable("jobOperation")
            .set(memberUpdate)
            .where("id", "in", jobOperationIds)
            .where("companyId", "=", companyId)
            .execute();

          return { id, readableId };
        }

        case "add": {
          const { jobOperationBatchId, jobOperationIds } = parsed;

          const batch = await trx
            .selectFrom("jobOperationBatch")
            .select(["id", "processId", "workCenterId", "status"])
            .where("id", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();

          if (!batch) {
            throw new Error(`Batch ${jobOperationBatchId} was not found`);
          }
          if (batch.status !== "Active") {
            throw new Error("Cannot modify a batch that is not active");
          }

          await assertNoBatchProductionEvent(
            trx,
            jobOperationBatchId,
            companyId,
            "add operations to"
          );

          await assertOperationsEligible(
            trx,
            jobOperationIds,
            batch.processId,
            companyId
          );

          const memberUpdate: Record<string, unknown> = {
            jobOperationBatchId,
            updatedBy: userId,
            updatedAt: now,
          };
          // Adding to a work-centered batch sets the op's work center.
          if (batch.workCenterId) {
            memberUpdate.workCenterId = batch.workCenterId;
          }

          await trx
            .updateTable("jobOperation")
            .set(memberUpdate)
            .where("id", "in", jobOperationIds)
            .where("companyId", "=", companyId)
            .execute();

          return { id: jobOperationBatchId };
        }

        case "remove": {
          const { jobOperationBatchId, jobOperationIds } = parsed;

          await assertNoBatchProductionEvent(
            trx,
            jobOperationBatchId,
            companyId,
            "remove operations from"
          );

          await trx
            .updateTable("jobOperation")
            .set({
              jobOperationBatchId: null,
              updatedBy: userId,
              updatedAt: now,
            })
            .where("id", "in", jobOperationIds)
            .where("jobOperationBatchId", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .execute();

          // Removing the last member dissolves the batch (a batch never sits empty).
          const remaining = await trx
            .selectFrom("jobOperation")
            .select("id")
            .where("jobOperationBatchId", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .limit(1)
            .executeTakeFirst();

          if (!remaining) {
            await trx
              .deleteFrom("jobOperationBatch")
              .where("id", "=", jobOperationBatchId)
              .where("companyId", "=", companyId)
              .execute();
            return { id: jobOperationBatchId, dissolved: true };
          }

          return { id: jobOperationBatchId };
        }

        case "updateWorkCenter": {
          const { jobOperationBatchId, workCenterId } = parsed;

          const batch = await trx
            .selectFrom("jobOperationBatch")
            .select("id")
            .where("id", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();

          if (!batch) {
            throw new Error(`Batch ${jobOperationBatchId} was not found`);
          }

          await trx
            .updateTable("jobOperationBatch")
            .set({ workCenterId, updatedBy: userId, updatedAt: now })
            .where("id", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .execute();

          // Assigning a work center writes it to every member operation.
          await trx
            .updateTable("jobOperation")
            .set({ workCenterId, updatedBy: userId, updatedAt: now })
            .where("jobOperationBatchId", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .execute();

          return { id: jobOperationBatchId };
        }

        case "dissolve": {
          const { jobOperationBatchId } = parsed;

          await assertNoBatchProductionEvent(
            trx,
            jobOperationBatchId,
            companyId,
            "dissolve"
          );

          await trx
            .updateTable("jobOperation")
            .set({
              jobOperationBatchId: null,
              updatedBy: userId,
              updatedAt: now,
            })
            .where("jobOperationBatchId", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .execute();

          await trx
            .deleteFrom("jobOperationBatch")
            .where("id", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .execute();

          return { id: jobOperationBatchId, dissolved: true };
        }
      }
    });

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("Error in batch-operations:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
