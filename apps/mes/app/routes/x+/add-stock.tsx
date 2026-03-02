import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { buildStockDimensions } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import type { MaterialStockAttributes } from "~/types/materialStock.types";

const linearSchema = z.object({
  type: z.literal("linear"),
  length: z.number().positive("Length must be positive")
});

const sheetSchema = z.object({
  type: z.literal("sheet"),
  length: z.number().positive("Length must be positive"),
  width: z.number().positive("Width must be positive")
});

const rollSchema = z.object({
  type: z.literal("roll"),
  length: z.number().positive("Length must be positive"),
  width: z.number().positive("Width must be positive")
});

const blockSchema = z.object({
  type: z.literal("block"),
  length: z.number().positive("Length must be positive"),
  width: z.number().positive("Width must be positive"),
  height: z.number().positive("Height must be positive")
});

const addStockValidator = z.object({
  materialId: z.string().min(1, "Material ID is required"),
  locationId: z.string().min(1, "Location is required"),
  shelfId: z.string().optional(),
  stockDimensions: z.discriminatedUnion("type", [
    linearSchema,
    sheetSchema,
    rollSchema,
    blockSchema
  ]),
  stockUnit: z.string().min(1, "Unit is required"),
  quantity: z.number().int().positive().default(1)
});

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId, carbon } = await requirePermissions(request, {});

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return data(
      { success: false, message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const validation = addStockValidator.safeParse(body);

  if (!validation.success) {
    return data(
      {
        success: false,
        message: validation.error.errors.map((e) => e.message).join(", ")
      },
      { status: 400 }
    );
  }

  const { materialId, locationId, shelfId, stockDimensions, stockUnit, quantity } =
    validation.data;

  try {
    const createdIds: string[] = [];
    const fullDimensions = buildStockDimensions(stockDimensions);

    for (let i = 0; i < quantity; i++) {
      const attributes: MaterialStockAttributes = {
        materialId,
        stockDimensions: fullDimensions,
        stockUnit
      };

      const result = await carbon
        .from("trackedEntity")
        .insert({
          quantity: 1,
          status: "Available" as const,
          sourceDocument: "Manual",
          sourceDocumentId: materialId,
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

      const ledgerResult = await carbon.from("itemLedger").insert({
        postingDate: new Date().toISOString(),
        entryType: "Positive Adjmt." as const,
        itemId: materialId,
        quantity: 1,
        locationId,
        shelfId,
        trackedEntityId: result.data.id,
        companyId,
        createdBy: userId
      });

      if (ledgerResult.error) {
        throw new Error(
          `Failed to create item ledger entry: ${ledgerResult.error.message}`
        );
      }

      createdIds.push(result.data.id);
    }

    return data({
      success: true,
      message: `Added ${quantity} stock piece${quantity > 1 ? "s" : ""}`,
      createdIds
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to add stock";
    console.error("Add stock error:", err);
    return data({ success: false, message }, { status: 500 });
  }
}
