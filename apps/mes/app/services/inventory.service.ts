import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zfd } from "zod-form-data";

export const inventoryAdjustmentValidator = z
  .object({
    itemId: z.string().min(1, { message: "Item ID is required" }),
    locationId: z.string().min(1, { message: "Location is required" }),
    shelfId: zfd.text(z.string().optional()),
    originalShelfId: zfd.text(z.string().optional()),
    adjustmentType: z.enum(["Positive Adjmt.", "Negative Adjmt.", "Set Quantity"]),
    quantity: zfd.numeric(z.number()),
    trackedEntityId: zfd.text(z.string().optional()),
    readableId: zfd.text(z.string().optional())
  })
  .superRefine((data, ctx) => {
    if (data.adjustmentType === "Set Quantity") {
      if (data.quantity < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Quantity must be 0 or greater",
          path: ["quantity"]
        });
      }
      return;
    }

    if (data.quantity < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quantity is required",
        path: ["quantity"]
      });
    }
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
  const { adjustmentType, readableId, originalShelfId, ...rest } =
    inventoryAdjustment;
  const data = {
    ...rest,
    entryType:
      adjustmentType === "Set Quantity" ? "Positive Adjmt." : adjustmentType // overwritten below if needed
  };

  const shelfQuantities = await client.rpc(
    "get_item_quantities_by_tracking_id",
    {
      item_id: data.itemId,
      company_id: data.companyId,
      location_id: data.locationId
    }
  );

  const currentQuantity = inventoryAdjustment.trackedEntityId
    ? shelfQuantities?.data?.find(
        (quantity) =>
          quantity.trackedEntityId == inventoryAdjustment.trackedEntityId
      )
    : shelfQuantities?.data?.find(
        // null == undefined - so we use == instead of === here
        (quantity) => quantity.shelfId == data.shelfId
      );

  const currentQuantityOnHand = currentQuantity?.quantity ?? 0;

  const isShelfTransfer =
    inventoryAdjustment.trackedEntityId &&
    originalShelfId &&
    originalShelfId !== data.shelfId;

  if (isShelfTransfer) {
    if (readableId !== undefined) {
      const trackedEntityUpdate = await client
        .from("trackedEntity")
        .update({ readableId })
        .eq("id", inventoryAdjustment.trackedEntityId);

      if (trackedEntityUpdate.error) {
        return trackedEntityUpdate;
      }
    }

    const negativeAdjustment = await client
      .from("itemLedger")
      .insert([
        {
          itemId: data.itemId,
          locationId: data.locationId,
          shelfId: originalShelfId,
          trackedEntityId: inventoryAdjustment.trackedEntityId,
          entryType: "Negative Adjmt." as const,
          quantity: -currentQuantityOnHand,
          companyId: data.companyId,
          createdBy: data.createdBy
        }
      ])
      .select("*")
      .single();

    if (negativeAdjustment.error) {
      return negativeAdjustment;
    }

    return client
      .from("itemLedger")
      .insert([
        {
          itemId: data.itemId,
          locationId: data.locationId,
          shelfId: data.shelfId,
          trackedEntityId: inventoryAdjustment.trackedEntityId,
          entryType: "Positive Adjmt." as const,
          quantity: currentQuantityOnHand,
          companyId: data.companyId,
          createdBy: data.createdBy
        }
      ])
      .select("*")
      .single();
  }

  if (adjustmentType === "Set Quantity" && currentQuantity) {
    const quantityDifference = data.quantity - currentQuantityOnHand;
    if (quantityDifference > 0) {
      data.entryType = "Positive Adjmt.";
      data.quantity = quantityDifference;
    } else if (quantityDifference < 0) {
      data.entryType = "Negative Adjmt.";
      data.quantity = -Math.abs(quantityDifference);
    } else {
      if (inventoryAdjustment.trackedEntityId && readableId !== undefined) {
        return client
          .from("trackedEntity")
          .update({ readableId })
          .eq("id", inventoryAdjustment.trackedEntityId);
      }
      return { data: null };
    }
  }

  if (data.entryType === "Negative Adjmt.") {
    if (data.quantity > currentQuantityOnHand) {
      return {
        error: "Insufficient quantity for negative adjustment"
      };
    }
    data.quantity = -Math.abs(data.quantity);
  }

  if (inventoryAdjustment.trackedEntityId) {
    if (currentQuantity) {
      const trackedEntityUpdate = await client
        .from("trackedEntity")
        .update({
          quantity: data.quantity + currentQuantityOnHand,
          readableId
        })
        .eq("id", inventoryAdjustment.trackedEntityId);

      if (trackedEntityUpdate.error) {
        return trackedEntityUpdate;
      }
    } else {
      const item = await client
        .from("item")
        .select("*")
        .eq("id", data.itemId)
        .single();

      const trackedEntityInsert = await client
        .from("trackedEntity")
        .insert([
          {
            id: inventoryAdjustment.trackedEntityId,
            sourceDocument: "Item",
            sourceDocumentId: data.itemId,
            sourceDocumentReadableId: item.data?.readableIdWithRevision,
            readableId,
            quantity: data.quantity,
            status: "Available",
            companyId: data.companyId,
            createdBy: data.createdBy
          }
        ])
        .select("*")
        .single();

      if (trackedEntityInsert.error) {
        return trackedEntityInsert;
      }
    }
  }

  return client.from("itemLedger").insert([data]).select("*").single();
}
