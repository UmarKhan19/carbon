import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("invoiceId required");

  const { data: lines } = await client
    .from("purchaseInvoiceLine")
    .select("id, description, quantity, supplierUnitPrice, invoiceLineType")
    .eq("invoiceId", invoiceId)
    .is("itemId", null)
    .eq("invoiceLineType", "Comment");

  if (!lines || lines.length === 0) {
    return { data: [] };
  }

  const suggestions = [];

  for (const line of lines) {
    let suggestedItemId = null;
    let suggestedItemName = null;

    if (line.description) {
      // Search item by name or readableId
      const { data: itemMatch } = await client
        .from("item")
        .select("id, name")
        .eq("companyId", companyId)
        .or(
          `name.ilike.%${line.description}%,readableId.ilike.%${line.description}%`
        )
        .maybeSingle();

      if (itemMatch) {
        suggestedItemId = itemMatch.id;
        suggestedItemName = itemMatch.name;
      }
    }

    suggestions.push({
      lineId: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.supplierUnitPrice,
      suggestedItemId,
      suggestedItemName,
      action: suggestedItemId ? "map" : "create" // "map" | "create" | "ignore"
    });
  }

  return { data: suggestions };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("invoiceId required");

  const formData = await request.formData();
  const mappingsStr = formData.get("mappings") as string;
  if (!mappingsStr) return { success: false, error: "No mappings provided" };

  const mappings = JSON.parse(mappingsStr);

  for (const map of mappings) {
    if (map.action === "ignore") continue;

    let finalItemId = map.itemId;

    if (map.action === "create") {
      const createName = map.createName || map.description || "New Item";
      const cleanPartId = createName
        .replace(/[^a-zA-Z0-9-_.]/g, "-")
        .toUpperCase();

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
            replenishmentSystem: "Buy",
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
          // Fallback check if it was inserted by a race condition
          const { data: fallbackExisting } = await client
            .from("item")
            .select("id")
            .eq("companyId", companyId)
            .eq("id", cleanPartId)
            .maybeSingle();

          if (fallbackExisting) {
            finalItemId = fallbackExisting.id;
          }
        }
      }
    }

    if (finalItemId) {
      // Update purchaseInvoiceLine: set itemId and change type from Comment to Item
      await client
        .from("purchaseInvoiceLine")
        .update({
          itemId: finalItemId,
          invoiceLineType: "Part",
          updatedBy: userId
        })
        .eq("id", map.lineId);
    }
  }

  return { success: true };
}
