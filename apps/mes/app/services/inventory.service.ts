import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zfd } from "zod-form-data";

export const inventoryAdjustmentValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  storageUnitId: zfd.text(z.string().optional()),
  entryType: z.enum(["Positive Adjmt.", "Negative Adjmt."]),
  quantity: zfd.numeric(z.number().min(1, { message: "Quantity is required" }))
});

export async function getBatchNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    isReadOnly?: boolean;
  }
) {
  let itemIds = [args.itemId];
  const item = await client
    .from("item")
    .select("*")
    .eq("id", args.itemId)
    .single();
  if (item.data?.type === "Material") {
    const items = await client
      .from("item")
      .select("id")
      .eq("readableId", item.data.readableId)
      .eq("companyId", args.companyId);
    if (items.data?.length) {
      itemIds = items.data.map((item) => item.id);
    }
  }

  return client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .in("sourceDocumentId", itemIds)
    .eq("companyId", args.companyId)
    .gt("quantity", 0);
}

export async function getCompanySettings(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companySettings")
    .select("*")
    .eq("id", companyId)
    .single();
}

export async function getPickingListsForOperator(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { userId: string; locationId?: string }
) {
  // Show every status the operator might care about — Released/In Progress
  // are pickable, Confirmed/Cancelled stay visible read-only so the operator
  // can audit recently completed work without bouncing back to ERP.
  //
  // Note: locationId filter is intentionally NOT applied here. The "My Picks"
  // screen lists everything assigned to (or available for) this operator
  // across all locations they belong to — matching the design spec. Filter by
  // location at the UI layer if needed.
  const query = client
    .from("pickingList")
    .select(
      `id, pickingListId, jobId, locationId, status, assignee, dueDate,
       confirmedAt, createdAt,
       job:jobId(jobId, itemId, item:itemId(name, readableId)),
       location:locationId(name),
       pickingListLine(estimatedQuantity, adjustedQuantity, pickedQuantity)`
    )
    .eq("companyId", companyId)
    .in("status", ["Released", "In Progress", "Confirmed", "Cancelled"])
    .or(`assignee.eq.${args.userId},assignee.is.null`)
    .order("dueDate", { ascending: true, nullsFirst: false })
    .order("createdAt", { ascending: false });

  return query;
}

export async function getPickingListForOperator(
  client: SupabaseClient<Database>,
  pickingListId: string,
  companyId: string
) {
  const { data: pl, error: plError } = await client
    .from("pickingList")
    .select(
      `id, pickingListId, jobId, locationId, status, assignee, dueDate,
       confirmedAt, shortageReason,
       job:jobId(id, jobId, itemId, item:itemId(name, readableId)),
       location:locationId(name)`
    )
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .single();

  if (plError || !pl) return { data: null, error: plError };

  const { data: lines, error: linesError } = await client
    .from("pickingListLine")
    .select("*")
    .eq("pickingListId", pickingListId)
    .order("createdAt", { ascending: true });

  if (linesError) return { data: null, error: linesError };

  const itemIds = [
    ...new Set((lines ?? []).map((l) => l.itemId).filter(Boolean))
  ];
  const storageUnitIds = [
    ...new Set(
      (lines ?? [])
        .flatMap((l) => [l.storageUnitId, l.destinationStorageUnitId])
        .filter(Boolean)
    )
  ];

  const [itemsRes, storageUnitsRes] = await Promise.all([
    itemIds.length
      ? client
          .from("item")
          .select("id, name, readableId, unitOfMeasureCode, itemTrackingType")
          .in("id", itemIds)
      : Promise.resolve({ data: [], error: null } as const),
    storageUnitIds.length
      ? client.from("storageUnit").select("id, name").in("id", storageUnitIds)
      : Promise.resolve({ data: [], error: null } as const)
  ]);

  if (itemsRes.error || storageUnitsRes.error)
    return {
      data: null,
      error: itemsRes.error ?? storageUnitsRes.error
    };

  const itemById = new Map((itemsRes.data ?? []).map((row) => [row.id, row]));
  const suById = new Map(
    (storageUnitsRes.data ?? []).map((row) => [row.id, row])
  );

  const merged = (lines ?? []).map((line) => ({
    ...line,
    item: line.itemId ? (itemById.get(line.itemId) ?? null) : null,
    storageUnit: line.storageUnitId
      ? (suById.get(line.storageUnitId) ?? null)
      : null,
    destinationStorageUnit: line.destinationStorageUnitId
      ? (suById.get(line.destinationStorageUnitId) ?? null)
      : null
  }));

  return { data: { pickingList: pl, lines: merged }, error: null };
}

export async function getSerialNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
  }
) {
  let itemIds = [args.itemId];
  const item = await client
    .from("item")
    .select("*")
    .eq("id", args.itemId)
    .single();
  if (item.data?.type === "Material") {
    const items = await client
      .from("item")
      .select("id")
      .eq("readableId", item.data.readableId)
      .eq("companyId", args.companyId);
    if (items.data?.length) {
      itemIds = items.data.map((item) => item.id);
    }
  }

  return client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .in("sourceDocumentId", itemIds)
    .eq("companyId", args.companyId)
    .eq("status", "Available")
    .gt("quantity", 0);
}

export async function insertManualInventoryAdjustment(
  client: SupabaseClient<Database>,
  inventoryAdjustment: z.infer<typeof inventoryAdjustmentValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  // Check if it's a negative adjustment and if the quantity is sufficient
  if (inventoryAdjustment.entryType === "Negative Adjmt.") {
    inventoryAdjustment.quantity = -Math.abs(inventoryAdjustment.quantity);
  }

  return client
    .from("itemLedger")
    .insert([inventoryAdjustment])
    .select("*")
    .single();
}
