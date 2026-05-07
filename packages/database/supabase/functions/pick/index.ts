import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
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

async function confirmPickingList(client: any, payload: any) {
  const { pickingListId, shortageReason, companyId, userId } = payload;
  const now = new Date().toISOString();

  const { data: pl } = await client
    .from("pickingList")
    .select("*, pickingListLine(*)")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .single();

  if (!pl) throw new Error("Picking list not found");
  if (!["Released", "In Progress"].includes(pl.status)) {
    throw new Error(`Cannot confirm a ${pl.status} picking list`);
  }

  const lines: any[] = pl.pickingListLine ?? [];
  const hasOutstanding = lines.some((l: any) => l.outstandingQuantity > 0);
  if (hasOutstanding && !shortageReason) {
    throw new Error("A shortage reason is required when confirming with outstanding quantities");
  }

  const ledgerEntries: any[] = [];
  const jobMaterialUpdates: Array<{ id: string; pickedQty: number }> = [];
  const entityConsumes: Array<{ entityId: string; pickedQty: number }> = [];

  for (const line of lines) {
    if (line.pickedQuantity <= 0) continue;

    ledgerEntries.push({
      entryType: "Consumption",
      documentType: "Job Consumption",
      documentId: pl.jobId,
      documentLineId: line.jobMaterialId,
      itemId: line.itemId,
      quantity: -line.pickedQuantity,
      trackedEntityId: line.pickedTrackedEntityId ?? null,
      locationId: pl.locationId,
      companyId,
      createdBy: userId,
    });

    if (line.jobMaterialId) {
      jobMaterialUpdates.push({ id: line.jobMaterialId, pickedQty: line.pickedQuantity });
    }

    if (line.pickedTrackedEntityId) {
      entityConsumes.push({ entityId: line.pickedTrackedEntityId, pickedQty: line.pickedQuantity });
    }
  }

  if (ledgerEntries.length > 0) {
    const { error: ledgerError } = await client.from("itemLedger").insert(ledgerEntries);
    if (ledgerError) throw new Error(ledgerError.message ?? "Failed to post ledger entries");
  }

  for (const { id, pickedQty } of jobMaterialUpdates) {
    const { data: jm } = await client
      .from("jobMaterial")
      .select("quantityIssued")
      .eq("id", id)
      .eq("companyId", companyId)
      .single();

    if (jm) {
      await client
        .from("jobMaterial")
        .update({ quantityIssued: (jm.quantityIssued ?? 0) + pickedQty })
        .eq("id", id)
        .eq("companyId", companyId);
    }
  }

  if (entityConsumes.length > 0) {
    const entityIds = entityConsumes.map((e) => e.entityId);
    const { data: entities } = await client
      .from("trackedEntity")
      .select("*")
      .in("id", entityIds)
      .eq("companyId", companyId);

    const entityMap = new Map<string, any>((entities ?? []).map((e: any) => [e.id, e]));

    // Capture per-entity outcome: original qty, picked qty, and remainder
    // entity id when a split happened. The new activity-write logic below
    // needs all three, so collect everything before mutating the DB.
    type EntityOp = {
      entityId: string;
      originalQty: number;
      pickedQty: number;
      remainderQty: number;
      remainderEntityId?: string;
    };
    const ops: EntityOp[] = entityConsumes
      .map(({ entityId, pickedQty }) => {
        const entity = entityMap.get(entityId);
        if (!entity) return null;
        const originalQty = Number(entity.quantity);
        return {
          entityId,
          originalQty,
          pickedQty,
          remainderQty: Math.max(originalQty - pickedQty, 0),
        } satisfies EntityOp;
      })
      .filter((x): x is EntityOp => x !== null);

    // 1) Shrink + create remainder entities for partial picks. Done one at
    // a time so we can capture the new remainder id and link it through
    // the Split activity below.
    for (const op of ops) {
      if (op.remainderQty <= 0) continue;
      const entity = entityMap.get(op.entityId);
      await client
        .from("trackedEntity")
        .update({ quantity: op.pickedQty })
        .eq("id", op.entityId)
        .eq("companyId", companyId);

      const { data: inserted } = await client
        .from("trackedEntity")
        .insert({
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
        })
        .select("id")
        .single();
      op.remainderEntityId = inserted?.id;
    }

    // 2) Mark every original entity as Consumed.
    await client
      .from("trackedEntity")
      .update({ status: "Consumed" })
      .in("id", entityIds)
      .eq("companyId", companyId);

    // 3) Write traceability activities. Mirrors the MES issue/index.ts
    // pattern so the graph renderer can draw real edges:
    //   Partial:  [original full qty] → Split → {remainder, original-shrunk}
    //                                    then  → Consume({original-shrunk})
    //   Full:     [original full qty] → Consume (no output)
    // Consume activities deliberately have no output rows — the entity
    // is gone after this event, there's nothing to render downstream.
    for (const op of ops) {
      if (op.remainderQty > 0 && op.remainderEntityId) {
        const { data: splitAct } = await client
          .from("trackedActivity")
          .insert({
            type: "Split",
            sourceDocument: "Picking List",
            sourceDocumentId: pickingListId,
            sourceDocumentReadableId: pl.pickingListId,
            companyId,
            createdBy: userId,
          })
          .select()
          .single();

        if (splitAct) {
          await client.from("trackedActivityInput").insert({
            trackedActivityId: splitAct.id,
            trackedEntityId: op.entityId,
            quantity: op.originalQty,
            companyId,
            createdBy: userId,
          });
          await client.from("trackedActivityOutput").insert([
            {
              trackedActivityId: splitAct.id,
              trackedEntityId: op.entityId,
              quantity: op.pickedQty,
              companyId,
              createdBy: userId,
            },
            {
              trackedActivityId: splitAct.id,
              trackedEntityId: op.remainderEntityId,
              quantity: op.remainderQty,
              companyId,
              createdBy: userId,
            },
          ]);
        }
      }

      const { data: consumeAct } = await client
        .from("trackedActivity")
        .insert({
          type: "Consume",
          sourceDocument: "Picking List",
          sourceDocumentId: pickingListId,
          sourceDocumentReadableId: pl.pickingListId,
          companyId,
          createdBy: userId,
        })
        .select()
        .single();

      if (consumeAct) {
        await client.from("trackedActivityInput").insert({
          trackedActivityId: consumeAct.id,
          trackedEntityId: op.entityId,
          quantity: op.pickedQty,
          companyId,
          createdBy: userId,
        });
      }
    }
  }

  const { error: plError } = await client
    .from("pickingList")
    .update({
      status: "Confirmed",
      confirmedAt: now,
      confirmedBy: userId,
      shortageReason: shortageReason ?? null,
      updatedBy: userId,
      updatedAt: now,
    })
    .eq("id", pickingListId)
    .eq("companyId", companyId);

  if (plError) throw new Error(plError.message ?? "Failed to confirm picking list");

  return { success: true };
}

async function reversePickingList(client: any, payload: any) {
  const { pickingListId, companyId, userId } = payload;
  const now = new Date().toISOString();

  const { data: pl } = await client
    .from("pickingList")
    .select("*, pickingListLine(*)")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .single();

  if (!pl) throw new Error("Picking list not found");
  if (pl.status !== "Confirmed") throw new Error("Only Confirmed picking lists can be reversed");

  const lines: any[] = pl.pickingListLine ?? [];

  const reversalEntries: any[] = [];
  const jobMaterialRollbacks: Array<{ id: string; pickedQty: number }> = [];
  const entityRestorations: string[] = [];

  for (const line of lines) {
    if ((line.pickedQuantity ?? 0) <= 0) continue;

    reversalEntries.push({
      entryType: "Positive Adjmt.",
      documentType: "Job Consumption", // reversal of a prior consumption entry
      documentId: pl.jobId,
      documentLineId: line.jobMaterialId ?? null,
      itemId: line.itemId,
      quantity: line.pickedQuantity,
      trackedEntityId: line.pickedTrackedEntityId ?? null,
      locationId: pl.locationId,
      companyId,
      createdBy: userId,
    });

    if (line.jobMaterialId) {
      jobMaterialRollbacks.push({ id: line.jobMaterialId, pickedQty: line.pickedQuantity });
    }

    if (line.pickedTrackedEntityId) {
      entityRestorations.push(line.pickedTrackedEntityId);
    }
  }

  if (reversalEntries.length > 0) {
    const { error: ledgerError } = await client.from("itemLedger").insert(reversalEntries);
    if (ledgerError) throw new Error(ledgerError.message ?? "Failed to post reversal ledger entries");
  }

  for (const { id, pickedQty } of jobMaterialRollbacks) {
    const { data: jm } = await client
      .from("jobMaterial")
      .select("quantityIssued")
      .eq("id", id)
      .eq("companyId", companyId)
      .single();
    if (jm) {
      await client
        .from("jobMaterial")
        .update({ quantityIssued: Math.max(0, (jm.quantityIssued ?? 0) - pickedQty) })
        .eq("id", id)
        .eq("companyId", companyId);
    }
  }

  // Restore tracked entities: merge split remainders back, then mark Available
  if (entityRestorations.length > 0) {
    // Find any remainder entities that were split off from these consumed entities
    const { data: remainders } = await client
      .from("trackedEntity")
      .select("id, quantity, splitFromEntityId")
      .in("splitFromEntityId", entityRestorations)
      .eq("companyId", companyId)
      .eq("status", "Available");

    if (remainders && remainders.length > 0) {
      // Add remainder qty back to each original consumed entity
      for (const remainder of remainders) {
        const { data: original } = await client
          .from("trackedEntity")
          .select("quantity")
          .eq("id", remainder.splitFromEntityId)
          .eq("companyId", companyId)
          .single();
        if (original) {
          await client
            .from("trackedEntity")
            .update({ quantity: Number(original.quantity) + Number(remainder.quantity) })
            .eq("id", remainder.splitFromEntityId)
            .eq("companyId", companyId);
        }
      }
      // Delete the remainder entities
      await client
        .from("trackedEntity")
        .delete()
        .in("id", remainders.map((r: any) => r.id))
        .eq("companyId", companyId);
    }

    await client
      .from("trackedEntity")
      .update({ status: "Available" })
      .in("id", entityRestorations)
      .eq("companyId", companyId)
      .eq("status", "Consumed");
  }

  const { error: plError } = await client
    .from("pickingList")
    .update({ status: "Cancelled", updatedBy: userId, updatedAt: now })
    .eq("id", pickingListId)
    .eq("companyId", companyId);

  if (plError) throw new Error(plError.message ?? "Failed to reverse picking list");

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
