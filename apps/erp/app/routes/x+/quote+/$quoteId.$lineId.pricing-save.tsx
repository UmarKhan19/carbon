import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { quoteLineAdditionalChargesValidator } from "~/modules/sales";

const priceUpdateValidator = z.object({
  leadTime: z.number().optional(),
  unitPrice: z.number().optional(),
  discountPercent: z.number().optional(),
  shippingCost: z.number().optional(),
  categoryMarkups: z.record(z.number()).optional()
});

const pricingDataValidator = z.object({
  prices: z.record(z.coerce.number(), priceUpdateValidator),
  unitCost: z.number().optional(),
  additionalCharges: quoteLineAdditionalChargesValidator.optional(),
  taxPercent: z.number().optional()
});

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const rawData = formData.get("pricingData");

  if (!rawData || typeof rawData !== "string") {
    return data({ success: false, error: "Missing pricing data" }, { status: 400 });
  }

  const parsed = pricingDataValidator.safeParse(JSON.parse(rawData));
  if (!parsed.success) {
    return data(
      { success: false, error: parsed.error.errors[0]?.message ?? "Invalid data" },
      { status: 400 }
    );
  }

  const { prices, unitCost, additionalCharges, taxPercent } = parsed.data;

  const quoteLineUpdate: Record<string, unknown> = { updatedBy: userId };
  if (additionalCharges !== undefined) {
    quoteLineUpdate.additionalCharges = additionalCharges;
  }
  if (taxPercent !== undefined) {
    quoteLineUpdate.taxPercent = taxPercent;
  }

  if (Object.keys(quoteLineUpdate).length > 1) {
    const updateLine = await client
      .from("quoteLine")
      .update(quoteLineUpdate)
      .eq("id", lineId);

    if (updateLine.error) {
      console.error(updateLine.error);
      return data(
        { success: false, error: "Failed to update quote line" },
        { status: 400 }
      );
    }
  }

  if (unitCost !== undefined) {
    const quoteLine = await client
      .from("quoteLine")
      .select("itemId")
      .eq("id", lineId)
      .single();

    if (quoteLine.data?.itemId) {
      const costUpdate = await client
        .from("itemCost")
        .update({
          unitCost,
          costIsAdjusted: true,
          updatedAt: new Date().toISOString().split("T")[0]
        })
        .eq("itemId", quoteLine.data.itemId);

      if (costUpdate.error) {
        console.error(costUpdate.error);
        return data(
          { success: false, error: "Failed to update item cost" },
          { status: 400 }
        );
      }
    }
  }

  for (const [quantityStr, priceUpdate] of Object.entries(prices)) {
    const quantity = Number(quantityStr);

    const existingPrice = await client
      .from("quoteLinePrice")
      .select("id")
      .eq("quoteLineId", lineId)
      .eq("quantity", quantity)
      .maybeSingle();

    if (existingPrice.data) {
      const updateFields: Record<string, unknown> = {};
      if (priceUpdate.leadTime !== undefined) updateFields.leadTime = priceUpdate.leadTime;
      if (priceUpdate.unitPrice !== undefined) updateFields.unitPrice = priceUpdate.unitPrice;
      if (priceUpdate.discountPercent !== undefined) updateFields.discountPercent = priceUpdate.discountPercent;
      if (priceUpdate.shippingCost !== undefined) updateFields.shippingCost = priceUpdate.shippingCost;
      if (priceUpdate.categoryMarkups !== undefined) updateFields.categoryMarkups = priceUpdate.categoryMarkups;

      if (Object.keys(updateFields).length > 0) {
        const update = await client
          .from("quoteLinePrice")
          .update(updateFields)
          .eq("quoteLineId", lineId)
          .eq("quantity", quantity);

        if (update.error) {
          console.error(update.error);
          return data(
            { success: false, error: "Failed to update quote line price" },
            { status: 400 }
          );
        }
      }
    } else {
      const quote = await client
        .from("quote")
        .select("exchangeRate")
        .eq("id", quoteId)
        .single();

      const insert = await client.from("quoteLinePrice").insert({
        quoteId,
        quoteLineId: lineId,
        quantity,
        leadTime: priceUpdate.leadTime ?? 0,
        unitPrice: priceUpdate.unitPrice ?? 0,
        discountPercent: priceUpdate.discountPercent ?? 0,
        shippingCost: priceUpdate.shippingCost ?? 0,
        exchangeRate: quote.data?.exchangeRate ?? 1,
        categoryMarkups: priceUpdate.categoryMarkups ?? {},
        createdBy: userId
      });

      if (insert.error) {
        console.error(insert.error);
        return data(
          { success: false, error: "Failed to insert quote line price" },
          { status: 400 }
        );
      }
    }
  }

  return { success: true, error: null };
}
