import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { buildStockDimensions } from "@carbon/utils";
import type { MaterialStockAttributes } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

const linearSchema = z.object({
  type: z.literal("linear"),
  length: z.number().positive()
});

const sheetSchema = z.object({
  type: z.literal("sheet"),
  length: z.number().positive(),
  width: z.number().positive()
});

const rollSchema = z.object({
  type: z.literal("roll"),
  length: z.number().positive(),
  width: z.number().positive()
});

const blockSchema = z.object({
  type: z.literal("block"),
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive()
});

const stockDimensionsValidator = z.object({
  receiptId: z.string().min(1),
  receiptLineId: z.string().min(1),
  itemId: z.string().min(1),
  stockDimensions: z.discriminatedUnion("type", [
    linearSchema,
    sheetSchema,
    rollSchema,
    blockSchema
  ]),
  stockUnit: z.string().min(1),
  quantity: z.number().int().positive().default(1)
});

/**
 * Creates trackedEntity records with stock dimensions for a receipt line.
 * These entities start with status "On Hold" and are updated to "Available"
 * when the receipt is posted (the post-receipt function picks up entities
 * with matching receipt attributes).
 */
export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return data({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = stockDimensionsValidator.safeParse(body);

  if (!validation.success) {
    return data(
      { error: validation.error.errors.map((e) => e.message).join(", ") },
      { status: 400 }
    );
  }

  const {
    receiptId,
    receiptLineId,
    itemId,
    stockDimensions,
    stockUnit,
    quantity
  } = validation.data;

  try {
    const serviceRole = await getCarbonServiceRole();
    const fullDimensions = buildStockDimensions(stockDimensions);
    const createdIds: string[] = [];

    // TODO: Remove these debugging logs after rollout validation.
    console.log("📦 Stock dimensions input:", stockDimensions);
    console.log("📦 Built dimensions:", fullDimensions);

    for (let i = 0; i < quantity; i++) {
      const materialStockAttrs: MaterialStockAttributes = {
        materialId: itemId,
        stockDimensions: fullDimensions,
        stockUnit
      };

      // Merge stock attributes with receipt tracking attributes
      // so the post-receipt function can find these entities
      const attributes = {
        Receipt: receiptId,
        "Receipt Line": receiptLineId,
        ...materialStockAttrs
      };

      console.log("📦 Attributes to save:", JSON.stringify(attributes, null, 2));

      const result = await serviceRole
        .from("trackedEntity")
        .insert({
          quantity: 1,
          status: "On Hold",
          sourceDocument: "Receipt",
          sourceDocumentId: itemId,
          attributes: attributes as unknown as Record<string, unknown>,
          companyId,
          createdBy: userId
        })
        .select("id")
        .single();

      if (result.error) {
        throw new Error(
          `Failed to create stock entity: ${result.error.message}`
        );
      }

      createdIds.push(result.data.id);
    }

    return data({
      success: true,
      message: `Added ${quantity} stock piece${quantity > 1 ? "s" : ""} for receipt`,
      createdIds
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to add stock dimensions";
    console.error("Stock dimensions error:", err);
    return data({ error: message }, { status: 500 });
  }
}
