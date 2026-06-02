import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getAssignedPickingLists(
  client: SupabaseClient<Database>,
  userId: string
) {
  return client
    .from("pickingLists")
    .select("*")
    .eq("assignee", userId)
    .in("status", ["Draft", "In Progress"])
    .order("dueDate", { ascending: true, nullsFirst: false });
}

export async function getPickingListForExecution(
  client: SupabaseClient<Database>,
  pickingListId: string
) {
  const { data: pickingList, error: plError } = await client
    .from("pickingList")
    .select("*, location:location(name)")
    .eq("id", pickingListId)
    .single();

  if (plError || !pickingList) return { data: null, error: plError };

  const { data: lines, error: lineError } = await client
    .from("pickingListLine")
    .select(
      "*, item:item(name, readableId), job:job(jobId), jobOperation:jobOperation(order, processId, workCenterId, process:process(name), workCenter:workCenter(name)), storageUnit:storageUnit(name)"
    )
    .eq("pickingListId", pickingListId)
    .order("jobOperationId")
    .order("storageUnitId");

  if (lineError) return { data: null, error: lineError };

  const lineIds = lines?.map((l) => l.id) ?? [];
  const { data: trackedEntities } =
    lineIds.length > 0
      ? await client
          .from("pickingListLineTrackedEntity")
          .select("*, trackedEntity:trackedEntity(readableId, quantity)")
          .in("pickingListLineId", lineIds)
      : { data: [] };

  return {
    data: {
      ...pickingList,
      lines: lines?.map((line) => ({
        ...line,
        trackedEntities:
          trackedEntities?.filter((te) => te.pickingListLineId === line.id) ??
          []
      }))
    },
    error: null
  };
}

export async function updatePickingListStatus(
  client: SupabaseClient<Database>,
  pickingListId: string,
  status: Database["public"]["Enums"]["pickingListStatus"],
  updatedBy: string
) {
  return client
    .from("pickingList")
    .update({
      status,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", pickingListId);
}

export async function confirmPickingListLine(
  client: SupabaseClient<Database>,
  args: {
    pickingListLineId: string;
    quantityPicked: number;
    trackedEntities?: Array<{
      trackedEntityId: string;
      quantityPicked: number;
    }>;
    userId: string;
  }
) {
  // 1. Get the line with jobMaterial join
  const lineResult = await client
    .from("pickingListLine")
    .select(
      "*, jobMaterial:jobMaterial!pickingListLine_jobMaterialId_fkey(id, jobId, itemId, quantityIssued, storageUnitId), pickingList(locationId, companyId)"
    )
    .eq("id", args.pickingListLineId)
    .single();

  if (lineResult.error || !lineResult.data) {
    return { data: null, error: lineResult.error ?? "Line not found" };
  }

  const line = lineResult.data;
  const jobMaterial = line.jobMaterial;
  const pickingList = line.pickingList;

  if (!jobMaterial || !pickingList) {
    return { data: null, error: "Missing related data" };
  }

  const quantityToPick = Number(line.quantityToPick);

  // 2. Determine line status
  const lineStatus: "Picked" | "Short" =
    args.quantityPicked >= quantityToPick ? "Picked" : "Short";

  // Update line quantityPicked and status
  const lineUpdate = await client
    .from("pickingListLine")
    .update({
      quantityPicked: args.quantityPicked,
      status: lineStatus,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.pickingListLineId);

  if (lineUpdate.error) {
    return { data: null, error: lineUpdate.error };
  }

  // 3. Update tracked entity quantities if applicable
  if (args.trackedEntities?.length) {
    for (const te of args.trackedEntities) {
      await client
        .from("pickingListLineTrackedEntity")
        .update({ quantityPicked: te.quantityPicked })
        .eq("pickingListLineId", args.pickingListLineId)
        .eq("trackedEntityId", te.trackedEntityId);
    }
  }

  // 4. Create itemLedger consumption entry
  if (args.quantityPicked > 0) {
    await client.from("itemLedger").insert([
      {
        entryType: "Consumption" as const,
        documentType:
          "Job Consumption" as Database["public"]["Enums"]["itemLedgerDocumentType"],
        documentId: jobMaterial.jobId,
        itemId: line.itemId,
        locationId: pickingList.locationId,
        storageUnitId: line.storageUnitId,
        quantity: -args.quantityPicked,
        companyId: pickingList.companyId,
        createdBy: args.userId
      }
    ]);
  }

  // 5. Update jobMaterial.quantityIssued
  const currentIssued = Number(jobMaterial.quantityIssued ?? 0);
  await client
    .from("jobMaterial")
    .update({
      quantityIssued: currentIssued + args.quantityPicked,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", jobMaterial.id);

  // 6. Check if all lines resolved — auto-complete the picking list
  const allLines = await client
    .from("pickingListLine")
    .select("id, status")
    .eq("pickingListId", line.pickingListId);

  if (!allLines.error && allLines.data) {
    const allResolved = allLines.data.every(
      (l) =>
        l.status === "Picked" ||
        l.status === "Short" ||
        l.status === "Cancelled"
    );
    if (allResolved) {
      await updatePickingListStatus(
        client,
        line.pickingListId,
        "Completed",
        args.userId
      );
    }
  }

  return {
    data: { id: args.pickingListLineId, status: lineStatus },
    error: null
  };
}
