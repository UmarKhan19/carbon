import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("rfqId required");

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");

  const { data: lines } = await client
    .from("salesRfqLine")
    .select("id, customerPartId, description, quantity")
    .eq("salesRfqId", rfqId)
    .is("itemId", null);

  if (!lines || lines.length === 0) {
    return { data: [] };
  }

  const suggestions = [];

  for (const line of lines) {
    let suggestedItemId = null;
    let suggestedItemName = null;

    if (customerId && line.customerPartId) {
      // Auto match from customerPartToItem
      const { data: mapping } = await client
        .from("customerPartToItem")
        .select("itemId, item(name)")
        .eq("customerId", customerId)
        .eq("customerPartId", line.customerPartId)
        .maybeSingle();

      if (mapping) {
        suggestedItemId = mapping.itemId;
        suggestedItemName = mapping.item?.name;
      }
    }

    if (!suggestedItemId && line.customerPartId) {
      // Fallback: search item by ID, readableId, or name
      const { data: itemMatch } = await client
        .from("item")
        .select("id, name")
        .eq("companyId", companyId)
        .or(
          `id.eq.${line.customerPartId},readableId.eq.${line.customerPartId},name.ilike.%${line.customerPartId}%`
        )
        .maybeSingle();

      if (itemMatch) {
        suggestedItemId = itemMatch.id;
        suggestedItemName = itemMatch.name;
      }
    }

    suggestions.push({
      lineId: line.id,
      customerPartId: line.customerPartId,
      description: line.description,
      quantity: line.quantity,
      suggestedItemId,
      suggestedItemName,
      action: suggestedItemId ? "map" : "create" // "map" | "create" | "ignore"
    });
  }

  return { data: suggestions };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("rfqId required");

  const formData = await request.formData();
  const customerId = formData.get("customerId") as string;
  const mappingsStr = formData.get("mappings") as string;
  if (!mappingsStr) return { success: false, error: "No mappings provided" };

  const mappings = JSON.parse(mappingsStr);
  const serviceRole = await getCarbonServiceRole();

  for (const map of mappings) {
    if (map.action === "ignore") continue;

    let finalItemId = map.itemId;

    if (map.action === "create") {
      const cleanPartId = map.customerPartId
        .replace(/[^a-zA-Z0-9-_.]/g, "-")
        .toUpperCase();
      const createName =
        map.createName || map.description || map.customerPartId;

      // Smart Map: Check if item already exists by ID or exact Name to prevent duplicates
      const { data: existingItem } = await client
        .from("item")
        .select("id")
        .eq("companyId", companyId)
        .or(`id.eq.${cleanPartId},name.eq.${createName}`)
        .maybeSingle();

      if (existingItem) {
        // Auto-switch to mapping to the existing item
        finalItemId = existingItem.id;
      } else {
        // Create new item
        const { data: newItem, error: itemError } = await client
          .from("item")
          .insert({
            id: cleanPartId,
            readableId: cleanPartId,
            companyId,
            name: createName,
            type: "Part",
            itemTrackingType: "Inventory",
            replenishmentSystem: "Make",
            defaultMethodType: "Make to Order",
            sourcingType: "Specified",
            unitOfMeasureCode: "EA",
            description: map.description,
            createdBy: userId
          })
          .select("id")
          .single();

        if (!itemError && newItem) {
          finalItemId = newItem.id;
        } else {
          // Fallback check if it was inserted just now by a race condition
          const { data: fallbackExisting } = await client
            .from("item")
            .select("id")
            .eq("companyId", companyId)
            .eq("id", cleanPartId)
            .maybeSingle();

          if (fallbackExisting) {
            finalItemId = fallbackExisting.id;
          }
          // Note: We no longer create duplicate items with random number suffixes!
        }
      }
    }

    if (finalItemId) {
      // Update salesRfqLine
      await client
        .from("salesRfqLine")
        .update({
          itemId: finalItemId,
          updatedBy: userId
        })
        .eq("id", map.lineId);

      // Upsert customerPartToItem
      if (customerId && map.customerPartId) {
        await serviceRole.from("customerPartToItem").upsert(
          {
            customerId,
            customerPartId: map.customerPartId,
            itemId: finalItemId,
            companyId,
            createdBy: userId
          },
          { onConflict: "customerId, itemId" }
        );
      }
    }
  }

  return { success: true };
}
