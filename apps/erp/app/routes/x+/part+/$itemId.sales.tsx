import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  getItemCustomerParts,
  getItemUnitSalePrice,
  itemUnitSalePriceValidator,
  upsertItemUnitSalePrice
} from "~/modules/items";
import { ItemSalePriceForm } from "~/modules/items/ui/Item";
import CustomerParts from "~/modules/items/ui/Item/CustomerParts";
import CustomerTypePriceBreaks from "~/modules/items/ui/Item/CustomerTypePriceBreaks";
import {
  getItemSalePriceBreakSummary,
  getItemSalePriceBreaks
} from "~/modules/sales/pricing";
import { upsertItemSalePriceBreaks } from "~/modules/sales/pricing/pricing.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [partUnitSalePrice, customerParts, priceBreaks, priceBreakSummary] =
    await Promise.all([
      getItemUnitSalePrice(client, itemId, companyId),
      getItemCustomerParts(client, itemId, companyId),
      getItemSalePriceBreaks(client, itemId, companyId),
      getItemSalePriceBreakSummary(client, itemId, companyId)
    ]);

  if (partUnitSalePrice.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(partUnitSalePrice.error, "Failed to load part unit sale price")
      )
    );
  }

  // Default breaks (no customer type) for the inline form
  const defaultBreaks = (priceBreaks.data ?? [])
    .filter((b) => !b.customerTypeId)
    .map((b) => ({
      quantity: b.minQuantity,
      unitPrice: b.unitPrice ?? 0
    }));

  // Summarise customer-type breaks for the list card
  const summaryRows = priceBreakSummary.data ?? [];
  const grouped = new Map<
    string,
    { customerTypeName: string; breakCount: number }
  >();
  for (const row of summaryRows) {
    const id = row.customerTypeId!;
    const existing = grouped.get(id);
    if (existing) {
      existing.breakCount += 1;
    } else {
      grouped.set(id, {
        customerTypeName:
          (row.customerType as { name: string } | null)?.name ?? "",
        breakCount: 1
      });
    }
  }
  const customerTypePriceBreaks = Array.from(grouped.entries()).map(
    ([customerTypeId, v]) => ({
      customerTypeId,
      customerTypeName: v.customerTypeName,
      breakCount: v.breakCount
    })
  );

  return {
    partUnitSalePrice: partUnitSalePrice.data,
    customerParts: customerParts.data,
    priceBreaks: defaultBreaks,
    customerTypePriceBreaks,
    itemId
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(itemUnitSalePriceValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // Save unit sale price
  const updatePartUnitSalePrice = await upsertItemUnitSalePrice(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updatePartUnitSalePrice.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(
        request,
        error(updatePartUnitSalePrice.error, "Failed to update part sale price")
      )
    );
  }

  // Save price breaks (submitted as JSON with the same form)
  const priceBreaksJson = formData.get("priceBreaks");
  if (priceBreaksJson && typeof priceBreaksJson === "string") {
    try {
      const breaks = JSON.parse(priceBreaksJson) as Array<{
        quantity: number;
        unitPrice: number;
      }>;
      await upsertItemSalePriceBreaks(
        itemId,
        companyId,
        userId,
        breaks.map((b) => ({
          minQuantity: b.quantity,
          unitPrice: b.unitPrice
        }))
      );
    } catch {
      // Invalid JSON — skip price breaks update
    }
  }

  throw redirect(
    path.to.partSales(itemId),
    await flash(request, success("Updated part sale price"))
  );
}

export default function PartSalesRoute() {
  const {
    customerParts,
    partUnitSalePrice,
    priceBreaks,
    customerTypePriceBreaks,
    itemId
  } = useLoaderData<typeof loader>();

  const initialValues = {
    ...partUnitSalePrice,
    salesUnitOfMeasureCode: partUnitSalePrice?.salesUnitOfMeasureCode ?? "",
    ...getCustomFields(partUnitSalePrice.customFields),
    itemId: itemId
  };

  return (
    <VStack spacing={2} className="p-2">
      <ItemSalePriceForm
        key={initialValues.itemId}
        initialValues={initialValues}
        priceBreaks={priceBreaks}
      />
      <CustomerTypePriceBreaks data={customerTypePriceBreaks} itemId={itemId} />
      {customerParts ? (
        <CustomerParts customerParts={customerParts} itemId={itemId} />
      ) : null}
      <Outlet />
    </VStack>
  );
}
