import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/nanoid.ts";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { getSupabase, getSupabaseServiceRole } from "../lib/supabase.ts";
import { corsHeaders } from "../lib/headers.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

// ─── Payload schemas ──────────────────────────────────────────

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("generatePickingList"),
    jobId: z.string(),
    locationId: z.string(),
    destinationStorageUnitId: z.string().optional(),
    dueDate: z.string().optional(),
    assignee: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("regeneratePickingList"),
    pickingListId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("pickInventoryLine"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    pickedQuantity: z.number().min(0),
    acknowledgeOverpick: z.boolean().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("pickTrackedEntityLine"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    trackedEntityId: z.string(),
    pickedQuantity: z.number().positive(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("unpickLine"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("releasePickingList"),
    pickingListId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("confirmPickingList"),
    pickingListId: z.string(),
    shortageReason: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("cancelPickingList"),
    pickingListId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("reversePickingList"),
    pickingListId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("stageJob"),
    jobId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("generateStockTransfer"),
    jobId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
]);

// ─── Helpers ──────────────────────────────────────────────────

async function getNextPickingListId(
  client: any,
  companyId: string,
): Promise<string> {
  const { data, error } = await client
    .from("sequence")
    .select("prefix, next, size")
    .eq("table", "pickingList")
    .eq("companyId", companyId)
    .single();

  if (error || !data) throw new Error("Could not get picking list sequence");

  const readable = `${data.prefix ?? ""}${String(data.next).padStart(data.size, "0")}`;

  await client
    .from("sequence")
    .update({ next: data.next + 1 })
    .eq("table", "pickingList")
    .eq("companyId", companyId);

  return readable;
}

// ─── Operations ───────────────────────────────────────────────

async function generatePickingList(client: any, payload: any) {
  const { jobId, locationId, destinationStorageUnitId, dueDate, assignee, companyId, userId } = payload;

  const { data: settings } = await client
    .from("companySettings")
    .select("usePickingLists")
    .eq("id", companyId)
    .single();

  if (settings?.usePickingLists === false) {
    throw new Error("Picking lists are disabled for this company");
  }

  // Guard: don't create a draft PL shell when the job has no eligible
  // pull-from-inventory materials for picking.
  const { count: eligibleCount, error: eligibleError } = await client
    .from("jobMaterial")
    .select("id", { count: "exact", head: true })
    .eq("jobId", jobId)
    .eq("companyId", companyId)
    .eq("methodType", "Pull from Inventory")
    .gt("quantityToIssue", 0)
    .eq("requiresPicking", true);

  if (eligibleError) {
    throw new Error(eligibleError.message ?? "Failed to evaluate picking requirements");
  }

  if (!eligibleCount || eligibleCount <= 0) {
    throw new Error(
      "No pickable materials found for this job. Ensure BOM lines are Pull from Inventory, requiresPicking=true, and quantityToIssue > 0."
    );
  }

  const pickingListId = await getNextPickingListId(client, companyId);

  const { data: pl, error: plError } = await client
    .from("pickingList")
    .insert({
      pickingListId,
      jobId,
      locationId,
      destinationStorageUnitId: destinationStorageUnitId ?? null,
      dueDate: dueDate ?? null,
      assignee: assignee ?? null,
      status: "Draft",
      companyId,
      createdBy: userId,
    })
    .select()
    .single();

  if (plError || !pl) throw new Error(plError?.message ?? "Failed to create picking list");

  const { error: rpcError } = await client.rpc("generate_picking_list_lines", {
    p_picking_list_id: pl.id,
    p_job_id: jobId,
    p_company_id: companyId,
    p_user_id: userId,
  });

  if (rpcError) {
    await client
      .from("pickingList")
      .delete()
      .eq("id", pl.id)
      .eq("companyId", companyId);
    throw new Error(rpcError.message ?? "Failed to generate picking list lines");
  }

  const { count: lineCount, error: lineCountError } = await client
    .from("pickingListLine")
    .select("id", { count: "exact", head: true })
    .eq("pickingListId", pl.id)
    .eq("companyId", companyId);

  if (lineCountError) {
    await client
      .from("pickingList")
      .delete()
      .eq("id", pl.id)
      .eq("companyId", companyId);
    throw new Error(lineCountError.message ?? "Failed to validate generated picking list lines");
  }

  if (!lineCount || lineCount <= 0) {
    await client
      .from("pickingList")
      .delete()
      .eq("id", pl.id)
      .eq("companyId", companyId);
    throw new Error(
      "No picking list lines were generated. Review job materials and picking configuration before retrying."
    );
  }

  return pl;
}

async function regeneratePickingList(client: any, payload: any) {
  const { pickingListId, companyId, userId } = payload;

  const { data: pl } = await client
    .from("pickingList")
    .select("*, pickingListLine(*)")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .single();

  if (!pl) throw new Error("Picking list not found");
  if (["Confirmed", "Cancelled"].includes(pl.status)) {
    throw new Error(`Cannot regenerate a ${pl.status} picking list`);
  }

  const hasAnyPick = (pl.pickingListLine ?? []).some((l: any) => l.pickedQuantity > 0);
  if (pl.status === "In Progress" && hasAnyPick) {
    throw new Error("Cannot regenerate: lines have been picked. Confirm or cancel first.");
  }

  const { error: rpcError } = await client.rpc("generate_picking_list_lines", {
    p_picking_list_id: pickingListId,
    p_job_id: pl.jobId,
    p_company_id: companyId,
    p_user_id: userId,
  });

  if (rpcError) throw new Error(rpcError.message ?? "Failed to regenerate lines");

  return { success: true };
}

async function pickInventoryLine(client: any, payload: any) {
  const { pickingListId, pickingListLineId, pickedQuantity, acknowledgeOverpick, companyId, userId } = payload;

  const { data: pl } = await client
    .from("pickingList")
    .select("status")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .single();

  if (!pl || !["Released", "In Progress"].includes(pl.status)) {
    throw new Error("Picking list must be Released or In Progress to pick lines");
  }

  // Over-pick guard: hard block at 2× estimated/adjusted qty unless an
  // approver-permission caller passed acknowledgeOverpick=true. The caller
  // (action route) is responsible for enforcing inventory_approve before
  // setting that flag — see $id.line.quantity.tsx.
  const { data: lineCheck } = await client
    .from("pickingListLine")
    .select("estimatedQuantity, adjustedQuantity")
    .eq("id", pickingListLineId)
    .eq("companyId", companyId)
    .single();

  if (lineCheck) {
    const effectiveQty = (lineCheck.adjustedQuantity ?? lineCheck.estimatedQuantity) as number;
    if (pickedQuantity > effectiveQty * 2 && !acknowledgeOverpick) {
      throw new Error(
        `Cannot pick more than 2× the required quantity (${effectiveQty * 2}). Approver override required.`
      );
    }
  }

  const { error: lineError } = await client
    .from("pickingListLine")
    .update({ pickedQuantity, updatedBy: userId, updatedAt: new Date().toISOString() })
    .eq("id", pickingListLineId)
    .eq("companyId", companyId);

  if (lineError) throw new Error(lineError.message);

  if (pl.status === "Released") {
    await client
      .from("pickingList")
      .update({ status: "In Progress", updatedBy: userId, updatedAt: new Date().toISOString() })
      .eq("id", pickingListId)
      .eq("companyId", companyId);
  }

  return { success: true };
}

async function pickTrackedEntityLine(client: any, payload: any) {
  const { pickingListId, pickingListLineId, trackedEntityId, pickedQuantity, companyId, userId } = payload;

  const { data: pl } = await client
    .from("pickingList")
    .select("status")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .single();

  if (!pl || !["Released", "In Progress"].includes(pl.status)) {
    throw new Error("Picking list must be Released or In Progress to pick lines");
  }

  const { data: entity } = await client
    .from("trackedEntity")
    .select("*")
    .or(`id.eq.${trackedEntityId},readableId.eq.${trackedEntityId}`)
    .eq("companyId", companyId)
    .maybeSingle();

  if (!entity) throw new Error("Tracked entity not found");
  if (entity.status !== "Available") throw new Error(`Entity is ${entity.status}`);

  const { data: line } = await client
    .from("pickingListLine")
    .select("*")
    .eq("id", pickingListLineId)
    .eq("companyId", companyId)
    .single();

  if (!line) throw new Error("Picking list line not found");

  if (entity.sourceDocumentId !== line.itemId) {
    throw new Error("Scanned entity belongs to a different item");
  }

  if (entity.unitOfMeasureCode && line.unitOfMeasureCode &&
      entity.unitOfMeasureCode !== line.unitOfMeasureCode) {
    throw new Error(`UoM mismatch: entity is ${entity.unitOfMeasureCode}, line expects ${line.unitOfMeasureCode}`);
  }

  // Prevent duplicate use of the same tracked entity on multiple lines of the same PL.
  // Re-scan on the same line is allowed (excluded by line id).
  const duplicateEntityIds = [entity.id, entity.readableId].filter(Boolean);
  if (duplicateEntityIds.length > 0) {
    const { data: duplicateRows } = await client
      .from("pickingListLine")
      .select("id, pickedTrackedEntityId, pickedQuantity")
      .eq("pickingListId", pickingListId)
      .eq("companyId", companyId)
      .neq("id", pickingListLineId)
      .in("pickedTrackedEntityId", duplicateEntityIds as string[]);

    const hasDuplicate = (duplicateRows ?? []).some((r: any) => Number(r.pickedQuantity ?? 0) > 0);
    if (hasDuplicate) {
      throw new Error("Tracked entity already picked on another line in this picking list");
    }
  }

  const effectiveQty = (line.adjustedQuantity ?? line.estimatedQuantity) as number;
  const alreadyPicked = (line.pickedQuantity as number) ?? 0;
  const outstanding = Math.max(effectiveQty - alreadyPicked, 0);

  // Auto-split: if entity qty < outstanding, close this line and create a sibling for remainder
  if (pickedQuantity < outstanding) {
    const remainder = outstanding - pickedQuantity;
    const { error: splitError } = await client.from("pickingListLine").insert({
      pickingListId: line.pickingListId,
      jobMaterialId: line.jobMaterialId,
      itemId: line.itemId,
      storageUnitId: line.storageUnitId,
      destinationStorageUnitId: line.destinationStorageUnitId,
      estimatedQuantity: remainder,
      requiresBatchTracking: line.requiresBatchTracking,
      requiresSerialTracking: line.requiresSerialTracking,
      unitOfMeasureCode: line.unitOfMeasureCode,
      companyId,
      createdBy: userId,
    });
    if (splitError) throw new Error(splitError.message ?? "Failed to split picking list line");
  }

  const { error: lineError } = await client
      .from("pickingListLine")
      .update({
      pickedTrackedEntityId: entity.id,
      pickedQuantity,
      // When splitting, shrink this line's estimatedQuantity to exactly what was picked
      // so outstandingQuantity = GREATEST(estimatedQty - pickedQty, 0) = 0
      // adjustedQuantity is intentionally left alone (reserved for P3 supervisor overrides)
      ...(pickedQuantity < outstanding ? { estimatedQuantity: pickedQuantity } : {}),
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", pickingListLineId)
    .eq("companyId", companyId);

  if (lineError) throw new Error(lineError.message);

  if (pl.status === "Released") {
    await client
      .from("pickingList")
      .update({ status: "In Progress", updatedBy: userId, updatedAt: new Date().toISOString() })
      .eq("id", pickingListId)
      .eq("companyId", companyId);
  }

  return { success: true };
}

async function unpickLine(client: any, payload: any) {
  const { pickingListId, pickingListLineId, companyId, userId } = payload;

  const { data: pl } = await client
    .from("pickingList")
    .select("status")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .single();

  if (!pl || pl.status !== "In Progress") {
    throw new Error("Can only unpick lines on an In Progress picking list");
  }

  await client
    .from("pickingListLine")
    .update({
      pickedQuantity: 0,
      pickedTrackedEntityId: null,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", pickingListLineId)
    .eq("companyId", companyId);

  return { success: true };
}

async function releasePickingList(client: any, payload: any) {
  const { pickingListId, companyId, userId } = payload;

  const { data: pl } = await client
    .from("pickingList")
    .select("status")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .single();

  if (!pl) throw new Error("Picking list not found");
  if (pl.status !== "Draft") throw new Error("Only Draft picking lists can be released");

  await client
    .from("pickingList")
    .update({ status: "Released", updatedBy: userId, updatedAt: new Date().toISOString() })
    .eq("id", pickingListId)
    .eq("companyId", companyId);

  return { success: true };
}

async function confirmPickingList(_client: any, payload: any) {
  const { pickingListId, shortageReason, companyId, userId } = payload;
  const now = new Date().toISOString();

  // Wraps the entire operation in a single Postgres transaction via the
  // shared Kysely pool. Mirrors apps/erp issue/index.ts so a partial
  // failure rolls back ledger + jobMaterial + trackedEntity + activity
  // writes together. companyId is enforced explicitly on every where
  // clause since this connection bypasses RLS.
  await db.transaction().execute(async (trx) => {
    const pl = await trx
      .selectFrom("pickingList")
      .selectAll()
      .where("id", "=", pickingListId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    if (!pl) throw new Error("Picking list not found");
    if (!["Released", "In Progress"].includes(pl.status as string)) {
      throw new Error(`Cannot confirm a ${pl.status} picking list`);
    }

    const lines = await trx
      .selectFrom("pickingListLine")
      .selectAll()
      .where("pickingListId", "=", pickingListId)
      .where("companyId", "=", companyId)
      .execute();

    const hasOutstanding = lines.some(
      (l) => Number(l.outstandingQuantity ?? 0) > 0,
    );
    if (hasOutstanding && !shortageReason) {
      throw new Error(
        "A shortage reason is required when confirming with outstanding quantities",
      );
    }

    const ledgerEntries: any[] = [];
    const jobMaterialUpdates: Array<{ id: string; pickedQty: number }> = [];
    const entityConsumes: Array<{
      entityId: string;
      pickedQty: number;
      jobMaterialId: string | null;
    }> = [];

    for (const line of lines) {
      const pickedQty = Number(line.pickedQuantity ?? 0);
      if (pickedQty <= 0) continue;

      ledgerEntries.push({
        entryType: "Consumption",
        documentType: "Job Consumption",
        documentId: pl.jobId,
        documentLineId: line.jobMaterialId,
        itemId: line.itemId,
        quantity: -pickedQty,
        trackedEntityId: line.pickedTrackedEntityId ?? null,
        locationId: pl.locationId,
        companyId,
        createdBy: userId,
      });

      if (line.jobMaterialId) {
        jobMaterialUpdates.push({ id: line.jobMaterialId, pickedQty });
      }

      if (line.pickedTrackedEntityId) {
        entityConsumes.push({
          entityId: line.pickedTrackedEntityId,
          pickedQty,
          jobMaterialId: line.jobMaterialId ?? null,
        });
      }
    }

    if (ledgerEntries.length > 0) {
      await trx.insertInto("itemLedger").values(ledgerEntries).execute();
    }

    for (const { id, pickedQty } of jobMaterialUpdates) {
      const jm = await trx
        .selectFrom("jobMaterial")
        .select("quantityIssued")
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (jm) {
        await trx
          .updateTable("jobMaterial")
          .set({ quantityIssued: Number(jm.quantityIssued ?? 0) + pickedQty })
          .where("id", "=", id)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    if (entityConsumes.length > 0) {
      const entityIds = entityConsumes.map((e) => e.entityId);
      const entities = await trx
        .selectFrom("trackedEntity")
        .selectAll()
        .where("id", "in", entityIds)
        .where("companyId", "=", companyId)
        .execute();

      const entityMap = new Map<string, any>(
        entities.map((e: any) => [e.id, e]),
      );

      // Resolve job parent batch per jobMaterial. Mirrors
      // issue/index.ts: the Consume activity outputs into the parent
      // tracked entity (jobMakeMethod.trackedEntityId) so traceability
      // RPCs descend parent → Consume → child source entities. A
      // synthetic per-pick output entity (the previous shape) is a
      // dead-end leaf that never connects to the finished batch.
      const jobMaterialIds = Array.from(
        new Set(
          entityConsumes
            .map((e) => e.jobMaterialId)
            .filter((id): id is string => !!id),
        ),
      );
      const parentByMaterialId = new Map<string, string | null>();
      if (jobMaterialIds.length > 0) {
        const rows = await trx
          .selectFrom("jobMaterial")
          .innerJoin(
            "jobMakeMethod",
            "jobMakeMethod.id",
            "jobMaterial.jobMakeMethodId",
          )
          .select([
            "jobMaterial.id as jobMaterialId",
            "jobMakeMethod.trackedEntityId as parentTrackedEntityId",
          ])
          .where("jobMaterial.id", "in", jobMaterialIds)
          .where("jobMaterial.companyId", "=", companyId)
          .execute();
        for (const r of rows) {
          parentByMaterialId.set(
            r.jobMaterialId as string,
            (r.parentTrackedEntityId as string | null) ?? null,
          );
        }
      }

      type EntityOp = {
        entityId: string;
        originalQty: number;
        pickedQty: number;
        remainderQty: number;
        remainderEntityId?: string;
        jobMaterialId: string | null;
      };
      const ops: EntityOp[] = entityConsumes
        .map(({ entityId, pickedQty, jobMaterialId }) => {
          const entity = entityMap.get(entityId);
          if (!entity) return null;
          const originalQty = Number(entity.quantity);
          return {
            entityId,
            originalQty,
            pickedQty,
            remainderQty: Math.max(originalQty - pickedQty, 0),
            jobMaterialId,
          } satisfies EntityOp;
        })
        .filter((x): x is EntityOp => x !== null);

      // 1) Split (partial only) — shrink orig + materialise remainder.
      for (const op of ops) {
        if (op.remainderQty <= 0) continue;
        const entity = entityMap.get(op.entityId);

        const remainderId = nanoid();
        await trx
          .insertInto("trackedEntity")
          .values({
            id: remainderId,
            readableId: entity.readableId ?? null,
            itemId: entity.itemId ?? null,
            sourceDocument: entity.sourceDocument,
            sourceDocumentId: entity.sourceDocumentId,
            sourceDocumentReadableId: entity.sourceDocumentReadableId ?? null,
            attributes: entity.attributes ?? {},
            expirationDate: entity.expirationDate ?? null,
            quantity: op.remainderQty,
            status: "Available",
            splitFromEntityId: op.entityId,
            companyId,
            createdBy: userId,
          } as any)
          .execute();
        op.remainderEntityId = remainderId;

        await trx
          .updateTable("trackedEntity")
          .set({ quantity: op.pickedQty })
          .where("id", "=", op.entityId)
          .where("companyId", "=", companyId)
          .execute();

        const splitId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: splitId,
            type: "Split",
            sourceDocument: "Picking List",
            sourceDocumentId: pickingListId,
            sourceDocumentReadableId: pl.pickingListId,
            attributes: {
              "Original Quantity": op.originalQty,
              "Consumed Quantity": op.pickedQty,
              "Remaining Quantity": op.remainderQty,
              "Split Entity ID": remainderId,
            },
            companyId,
            createdBy: userId,
          } as any)
          .execute();

        await trx
          .insertInto("trackedActivityInput")
          .values({
            trackedActivityId: splitId,
            trackedEntityId: op.entityId,
            quantity: op.originalQty,
            companyId,
            createdBy: userId,
          })
          .execute();

        await trx
          .insertInto("trackedActivityOutput")
          .values([
            {
              trackedActivityId: splitId,
              trackedEntityId: op.entityId,
              quantity: op.pickedQty,
              companyId,
              createdBy: userId,
            },
            {
              trackedActivityId: splitId,
              trackedEntityId: remainderId,
              quantity: op.remainderQty,
              companyId,
              createdBy: userId,
            },
          ])
          .execute();
      }

      // 2) Mark every original Consumed in a single statement.
      await trx
        .updateTable("trackedEntity")
        .set({ status: "Consumed" })
        .where("id", "in", entityIds)
        .where("companyId", "=", companyId)
        .execute();

      // 3) One Consume activity per jobMaterial group.
      // Inputs = picked source entities, output = job parent batch (when tracked).
      // Always write the activity + inputs so traceability can find the edge even
      // when the finished good is not batch/serial tracked (no parent entity).
      const opsByMaterial = new Map<string, EntityOp[]>();
      for (const op of ops) {
        if (!op.jobMaterialId) continue;
        const arr = opsByMaterial.get(op.jobMaterialId) ?? [];
        arr.push(op);
        opsByMaterial.set(op.jobMaterialId, arr);
      }

      for (const [jobMaterialId, materialOps] of opsByMaterial) {
        const parentEntityId = parentByMaterialId.get(jobMaterialId) ?? null;

        const consumeId = nanoid();
        const totalPicked = materialOps.reduce(
          (sum, op) => sum + op.pickedQty,
          0,
        );

        await trx
          .insertInto("trackedActivity")
          .values({
            id: consumeId,
            type: "Consume",
            sourceDocument: "Job Material",
            sourceDocumentId: jobMaterialId,
            sourceDocumentReadableId: pl.pickingListId,
            attributes: {
              "Picking List": pl.pickingListId,
              "Job Material": jobMaterialId,
            },
            companyId,
            createdBy: userId,
          } as any)
          .execute();

        await trx
          .insertInto("trackedActivityInput")
          .values(
            materialOps.map((op) => ({
              trackedActivityId: consumeId,
              trackedEntityId: op.entityId,
              quantity: op.pickedQty,
              companyId,
              createdBy: userId,
            })),
          )
          .execute();

        // Consume MUST have an output for the strict descendants RPC to
        // traverse forward from the picked entity. When the finished good is
        // batch/serial-tracked, that output is the real parent batch. When
        // it isn't, we synthesize a pickResult entity (sourceDocument =
        // "Picking List") that acts as the destination — this matches the
        // MES Issue pattern so the traceability graph renders identically
        // for tracked and untracked jobs. pickResult entities are filtered
        // out of inventory listings by getTrackedEntities.
        const outputEntityId: string = parentEntityId ?? nanoid();
        if (!parentEntityId) {
          await trx
            .insertInto("trackedEntity")
            .values({
              id: outputEntityId,
              quantity: totalPicked,
              status: "Consumed",
              sourceDocument: "Picking List",
              sourceDocumentId: pickingListId,
              sourceDocumentReadableId: pl.pickingListId,
              attributes: {
                "Picking List": pl.pickingListId,
                "Job Material": jobMaterialId,
              },
              companyId,
              createdBy: userId,
            } as any)
            .execute();
        }

        await trx
          .insertInto("trackedActivityOutput")
          .values({
            trackedActivityId: consumeId,
            trackedEntityId: outputEntityId,
            quantity: totalPicked,
            companyId,
            createdBy: userId,
          })
          .execute();
      }
    }

    await trx
      .updateTable("pickingList")
      .set({
        status: "Confirmed",
        confirmedAt: now,
        confirmedBy: userId,
        shortageReason: shortageReason ?? null,
        updatedBy: userId,
        updatedAt: now,
      })
      .where("id", "=", pickingListId)
      .where("companyId", "=", companyId)
      .execute();
  });

  return { success: true };
}

async function reversePickingList(_client: any, payload: any) {
  const { pickingListId, companyId, userId } = payload;
  const now = new Date().toISOString();

  // Same atomicity guarantees as confirmPickingList — ledger reversal,
  // jobMaterial rollback, child-entity cleanup, and orig restore happen
  // in one transaction. All scoped explicitly by companyId because the
  // direct connection bypasses RLS.
  await db.transaction().execute(async (trx) => {
    const pl = await trx
      .selectFrom("pickingList")
      .selectAll()
      .where("id", "=", pickingListId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    if (!pl) throw new Error("Picking list not found");
    if (pl.status !== "Confirmed") {
      throw new Error("Only Confirmed picking lists can be reversed");
    }

    if (pl.jobId) {
      const job = await trx
        .selectFrom("job")
        .select("status")
        .where("id", "=", pl.jobId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (job && ["Completed", "Closed"].includes(job.status as string)) {
        throw new Error(
          `Cannot reverse a picking list for a ${job.status} job`
        );
      }
    }

    const lines = await trx
      .selectFrom("pickingListLine")
      .selectAll()
      .where("pickingListId", "=", pickingListId)
      .where("companyId", "=", companyId)
      .execute();

    const reversalEntries: any[] = [];
    const jobMaterialRollbacks: Array<{ id: string; pickedQty: number }> = [];
    const entityRestorations: Array<{ entityId: string; pickedQty: number }> =
      [];

    for (const line of lines) {
      const pickedQty = Number(line.pickedQuantity ?? 0);
      if (pickedQty <= 0) continue;

      reversalEntries.push({
        entryType: "Positive Adjmt.",
        documentType: "Job Consumption",
        documentId: pl.jobId,
        documentLineId: line.jobMaterialId ?? null,
        itemId: line.itemId,
        quantity: pickedQty,
        trackedEntityId: line.pickedTrackedEntityId ?? null,
        locationId: pl.locationId,
        companyId,
        createdBy: userId,
      });

      if (line.jobMaterialId) {
        jobMaterialRollbacks.push({ id: line.jobMaterialId, pickedQty });
      }

      if (line.pickedTrackedEntityId) {
        entityRestorations.push({
          entityId: line.pickedTrackedEntityId,
          pickedQty,
        });
      }
    }

    if (reversalEntries.length > 0) {
      await trx.insertInto("itemLedger").values(reversalEntries).execute();
    }

    for (const { id, pickedQty } of jobMaterialRollbacks) {
      const jm = await trx
        .selectFrom("jobMaterial")
        .select("quantityIssued")
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (jm) {
        await trx
          .updateTable("jobMaterial")
          .set({
            quantityIssued: Math.max(
              0,
              Number(jm.quantityIssued ?? 0) - pickedQty,
            ),
          })
          .where("id", "=", id)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    if (entityRestorations.length > 0) {
      const restoredEntityIds = entityRestorations.map((r) => r.entityId);

      // Always flip status back to Available first — covers every
      // restored orig regardless of which activities the confirm wrote
      // (e.g. an old full-picked serial only got a Consume, never a
      // Split, so it'd otherwise be skipped).
      await trx
        .updateTable("trackedEntity")
        .set({ status: "Available" })
        .where("id", "in", restoredEntityIds)
        .where("companyId", "=", companyId)
        .where("status", "=", "Consumed")
        .execute();

      // Delete pickResult entities — these are the synthetic Consume
      // outputs created at confirm time when the finished good wasn't
      // batch/serial-tracked (sourceDocument = "Picking List"). They
      // exist only for this PL's traversal and are safe to drop on
      // reverse. Real parent-batch Consume outputs (tracked jobs) are
      // never selected here because their sourceDocument is not
      // "Picking List".
      await trx
        .deleteFrom("trackedEntity")
        .where("sourceDocument", "=", "Picking List")
        .where("sourceDocumentId", "=", pickingListId)
        .where("companyId", "=", companyId)
        .execute();

      // Pull Split activities for this PL so we can undo qty shrinkage
      // and delete remainder entities. Consume outputs for tracked jobs
      // point at the job parent batch and must NOT be touched here.
      const splitActivities = await trx
        .selectFrom("trackedActivity")
        .select(["id"])
        .where("sourceDocument", "=", "Picking List")
        .where("sourceDocumentId", "=", pickingListId)
        .where("type", "=", "Split")
        .where("companyId", "=", companyId)
        .execute();

      const splitActivityIds = splitActivities.map((a: any) => a.id);

      // Restore originalQty on each orig from its Split input row, so a
      // partial pick that shrunk orig.quantity is undone. Full picks
      // skip this branch entirely (no Split was written).
      if (splitActivityIds.length > 0) {
        const splitInputs = await trx
          .selectFrom("trackedActivityInput")
          .select(["trackedActivityId", "trackedEntityId", "quantity"])
          .where("trackedActivityId", "in", splitActivityIds)
          .where("companyId", "=", companyId)
          .execute();

        // Delete Split remainder entities (every Split output that
        // isn't orig itself). Consume outputs are job parent batches
        // and are intentionally excluded.
        const splitOutputs = await trx
          .selectFrom("trackedActivityOutput")
          .select(["trackedActivityId", "trackedEntityId"])
          .where("trackedActivityId", "in", splitActivityIds)
          .where("companyId", "=", companyId)
          .execute();

        const remainderRows = splitOutputs.filter(
          (o) => !restoredEntityIds.includes(o.trackedEntityId as string),
        );
        const remainderEntityIds = remainderRows.map((r) => r.trackedEntityId as string);

        // Check whether each remainder entity is still Available. If a later
        // PL already consumed a remainder (status=Consumed) we must not delete
        // it — doing so would corrupt that PL's history and create phantom qty.
        const remainderStatusMap = new Map<string, string>();
        if (remainderEntityIds.length > 0) {
          const statuses = await trx
            .selectFrom("trackedEntity")
            .select(["id", "status"])
            .where("id", "in", remainderEntityIds)
            .where("companyId", "=", companyId)
            .execute();
          for (const e of statuses) {
            remainderStatusMap.set(e.id as string, e.status as string);
          }
        }

        // Any split activity whose remainder has been consumed by another PL
        // cannot be fully merged back — track which activities those are.
        const activitiesWithUnsafeRemainder = new Set<string>();
        for (const r of remainderRows) {
          if (remainderStatusMap.get(r.trackedEntityId as string) !== "Available") {
            activitiesWithUnsafeRemainder.add(r.trackedActivityId as string);
          }
        }

        // Restore qty on each original entity.
        // Safe case (remainder Available): restore full pre-split qty — the
        //   remainder is about to be deleted so it's fine to absorb it back.
        // Unsafe case (remainder Consumed): restore only what this PL picked
        //   so we don't double-count the portion another PL already consumed.
        for (const row of splitInputs) {
          const qtyToRestore = activitiesWithUnsafeRemainder.has(row.trackedActivityId as string)
            ? (entityRestorations.find((r) => r.entityId === row.trackedEntityId)?.pickedQty ??
                Number(row.quantity ?? 0))
            : Number(row.quantity ?? 0);

          await trx
            .updateTable("trackedEntity")
            .set({ quantity: qtyToRestore })
            .where("id", "=", row.trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();
        }

        // Only delete remainders that are still Available (safe to reclaim).
        const safeToDeleteIds = remainderRows
          .filter((r) => remainderStatusMap.get(r.trackedEntityId as string) === "Available")
          .map((r) => r.trackedEntityId as string);

        if (safeToDeleteIds.length > 0) {
          await trx
            .deleteFrom("trackedEntity")
            .where("id", "in", safeToDeleteIds)
            .where("companyId", "=", companyId)
            .execute();
        }
      }

      // Traceability: emit one Reverse activity per restored entity so
      // the graph shows the reversal event.
      for (const { entityId, pickedQty } of entityRestorations) {
        const reverseId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: reverseId,
            type: "Reverse",
            sourceDocument: "Picking List",
            sourceDocumentId: pickingListId,
            sourceDocumentReadableId: pl.pickingListId,
            companyId,
            createdBy: userId,
          } as any)
          .execute();

        await trx
          .insertInto("trackedActivityOutput")
          .values({
            trackedActivityId: reverseId,
            trackedEntityId: entityId,
            quantity: pickedQty,
            companyId,
            createdBy: userId,
          })
          .execute();
      }
    }

    await trx
      .updateTable("pickingList")
      .set({ status: "Cancelled", updatedBy: userId, updatedAt: now })
      .where("id", "=", pickingListId)
      .where("companyId", "=", companyId)
      .execute();
  });

  return { success: true };
}

async function cancelPickingList(client: any, payload: any) {
  const { pickingListId, companyId, userId } = payload;

  const { data: pl } = await client
    .from("pickingList")
    .select("status")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .single();

  if (!pl) throw new Error("Picking list not found");
  if (pl.status === "Confirmed") {
    throw new Error("Cannot cancel a Confirmed picking list");
  }

  await client
    .from("pickingList")
    .update({ status: "Cancelled", updatedBy: userId, updatedAt: new Date().toISOString() })
    .eq("id", pickingListId)
    .eq("companyId", companyId);

  return { success: true };
}

// ─── Job Staging (P1) ─────────────────────────────────────────

async function stageJob(client: any, payload: any) {
  const { jobId, companyId } = payload;

  const { data: assessment, error: rpcError } = await client.rpc(
    "get_job_staging_assessment",
    { p_job_id: jobId, p_company_id: companyId },
  );

  if (rpcError) throw new Error(rpcError.message ?? "Staging assessment failed");

  return {
    jobId,
    materials: assessment ?? [],
    totalShortageMaterials: (assessment ?? []).filter((m: any) => Number(m.shortage) > 0).length,
  };
}

async function generateStockTransfer(client: any, payload: any) {
  const { jobId, companyId, userId } = payload;

  const { data: job, error: jobError } = await client
    .from("job")
    .select("id, locationId, jobId")
    .eq("id", jobId)
    .eq("companyId", companyId)
    .single();

  if (jobError || !job) throw new Error("Job not found");
  if (!job.locationId) throw new Error("Job has no location — cannot stage");

  const { data: assessment, error: rpcError } = await client.rpc(
    "get_job_staging_assessment",
    { p_job_id: jobId, p_company_id: companyId },
  );
  if (rpcError) throw new Error(rpcError.message ?? "Staging assessment failed");

  const shortages = (assessment ?? []).filter(
    (m: any) =>
      Number(m.shortage) > 0 &&
      m.sourceStorageUnitId &&
      m.pickStorageUnitId &&
      m.sourceStorageUnitId !== m.pickStorageUnitId,
  );

  if (shortages.length === 0) {
    return { stockTransferId: null, lineCount: 0, message: "No actionable shortages" };
  }

  // Generate readable stockTransferId via the shared sequence helper.
  const { data: stockTransferReadable, error: seqError } = await client.rpc(
    "get_next_sequence",
    { sequence_name: "stockTransfer", company_id: companyId },
  );
  if (seqError) throw new Error(seqError.message ?? "Could not get stock transfer sequence");

  const { data: st, error: stError } = await client
    .from("stockTransfer")
    .insert({
      stockTransferId: stockTransferReadable,
      locationId: job.locationId,
      status: "Draft",
      companyId,
      createdBy: userId,
    })
    .select()
    .single();

  if (stError || !st) throw new Error(stError?.message ?? "Failed to create stock transfer");

  const lineInserts = shortages.map((s: any) => ({
    stockTransferId: st.id,
    jobId,
    jobMaterialId: s.jobMaterialId,
    itemId: s.itemId,
    fromStorageUnitId: s.sourceStorageUnitId,
    toStorageUnitId: s.pickStorageUnitId,
    quantity: Math.min(Number(s.shortage), Number(s.sourceStorageUnitQuantity ?? 0)),
    companyId,
    createdBy: userId,
  }));

  const { error: lineError } = await client
    .from("stockTransferLine")
    .insert(lineInserts);
  if (lineError) throw new Error(lineError.message ?? "Failed to create stock transfer lines");

  return {
    stockTransferId: st.id,
    stockTransferReadableId: st.stockTransferId,
    lineCount: lineInserts.length,
  };
}

// ─── Server ───────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();

  try {
    const validated = payloadValidator.parse(payload);
    const { type, companyId, userId } = validated;

    console.log({ function: "pick", type, companyId, userId });

    const authorizationHeader = req.headers.get("Authorization");
    const apiKeyHeader = req.headers.get("carbon-key");
    const client =
      apiKeyHeader && companyId
        ? await getSupabaseServiceRole(
            authorizationHeader,
            apiKeyHeader,
            companyId,
          )
        : getSupabase(authorizationHeader);

    switch (type) {
      case "generatePickingList":
        return Response.json(await generatePickingList(client, validated), { headers: corsHeaders });
      case "regeneratePickingList":
        return Response.json(await regeneratePickingList(client, validated), { headers: corsHeaders });
      case "pickInventoryLine":
        return Response.json(await pickInventoryLine(client, validated), { headers: corsHeaders });
      case "pickTrackedEntityLine":
        return Response.json(await pickTrackedEntityLine(client, validated), { headers: corsHeaders });
      case "unpickLine":
        return Response.json(await unpickLine(client, validated), { headers: corsHeaders });
      case "releasePickingList":
        return Response.json(await releasePickingList(client, validated), { headers: corsHeaders });
      case "confirmPickingList":
        return Response.json(await confirmPickingList(client, validated), { headers: corsHeaders });
      case "cancelPickingList":
        return Response.json(await cancelPickingList(client, validated), { headers: corsHeaders });
      case "reversePickingList":
        return Response.json(await reversePickingList(client, validated), { headers: corsHeaders });
      case "stageJob":
        return Response.json(await stageJob(client, validated), { headers: corsHeaders });
      case "generateStockTransfer":
        return Response.json(await generateStockTransfer(client, validated), { headers: corsHeaders });
      default:
        return new Response(
          JSON.stringify({ error: "Invalid operation type" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
  } catch (error) {
    console.error("Error in pick:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
