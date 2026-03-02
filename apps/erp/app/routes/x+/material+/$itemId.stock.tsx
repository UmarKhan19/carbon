import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  buildStockDimensions,
  type MaterialStockAttributes,
  type MaterialStockPiece,
} from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { z } from "zod";
import { path } from "~/utils/path";
import { MaterialStockSection } from "./MaterialStockSection";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  // Fetch both available and consumed stock
  const [availableResult, consumedResult] = await Promise.all([
    client
      .from("trackedEntity")
      .select("*")
      .eq("status", "Available")
      .eq("attributes->>materialId", itemId)
      .not("attributes->stockDimensions", "is", null),
    client
      .from("trackedEntity")
      .select("*")
      .eq("status", "Consumed")
      .eq("attributes->>materialId", itemId)
      .not("attributes->stockDimensions", "is", null)
  ]);

  if (availableResult.error) {
    throw redirect(
      path.to.material(itemId),
      await flash(
        request,
        error(availableResult.error, "Failed to load material stock")
      )
    );
  }

  if (consumedResult.error) {
    throw redirect(
      path.to.material(itemId),
      await flash(
        request,
        error(consumedResult.error, "Failed to load consumed stock")
      )
    );
  }

  const mapEntityToStockPiece = (entity: any): MaterialStockPiece | null => {
    const attrs = entity.attributes as unknown as MaterialStockAttributes;
    if (!attrs?.stockDimensions) return null;
    return {
      trackedEntityId: entity.id,
      stockDimensions: attrs.stockDimensions,
      stockUnit: attrs.stockUnit,
      status: entity.status as "Available" | "Reserved" | "On Hold" | "Consumed",
      shelfId: entity.shelfId,
      locationId: entity.locationId,
      parentStockId: attrs.parentStockId ?? null
    };
  };

  const availableStockPieces: MaterialStockPiece[] = (availableResult.data ?? [])
    .map(mapEntityToStockPiece)
    .filter(Boolean) as MaterialStockPiece[];

  const consumedStockPieces: MaterialStockPiece[] = (consumedResult.data ?? [])
    .map(mapEntityToStockPiece)
    .filter(Boolean) as MaterialStockPiece[];

  return { 
    stockPieces: availableStockPieces, 
    consumedStockPieces,
    itemId 
  };
}

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
  materialId: z.string().min(1),
  locationId: z.string().min(1),
  shelfId: z.string().optional(),
  stockDimensions: z.discriminatedUnion("type", [
    linearSchema,
    sheetSchema,
    rollSchema,
    blockSchema
  ]),
  stockUnit: z.string().min(1),
  quantity: z.number().int().positive().default(1)
});

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client: carbon, companyId, userId } = await requirePermissions(
    request,
    { create: "inventory" }
  );

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw redirect(
      path.to.materialStock(itemId),
      await flash(request, error(null, "Invalid request"))
    );
  }

  const validation = addStockValidator.safeParse(body);

  if (!validation.success) {
    throw redirect(
      path.to.materialStock(itemId),
      await flash(
        request,
        error(null, validation.error.errors.map((e) => e.message).join(", "))
      )
    );
  }

  const { materialId, locationId, shelfId, stockDimensions, stockUnit, quantity } =
    validation.data;

  try {
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
    }

    throw redirect(
      path.to.materialStock(itemId),
      await flash(
        request,
        success(`Added ${quantity} stock piece${quantity > 1 ? "s" : ""}`)
      )
    );
  } catch (err) {
    if (err instanceof Response) throw err;
    const message =
      err instanceof Error ? err.message : "Failed to add stock";
    throw redirect(
      path.to.materialStock(itemId),
      await flash(request, error(null, message))
    );
  }
}

export { MaterialStockSection as default } from "./MaterialStockSection";
