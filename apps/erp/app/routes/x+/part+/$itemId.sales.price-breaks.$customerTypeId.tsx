import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import CustomerTypePriceBreakForm from "~/modules/items/ui/Item/CustomerTypePriceBreakForm";
import { getItemSalePriceBreaksForCustomerType } from "~/modules/sales/pricing";
import { upsertItemSalePriceBreaks } from "~/modules/sales/pricing/pricing.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { itemId, customerTypeId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!customerTypeId) throw new Error("Could not find customerTypeId");

  const [priceBreaks, customerType] = await Promise.all([
    getItemSalePriceBreaksForCustomerType(
      client,
      itemId,
      companyId,
      customerTypeId
    ),
    client.from("customerType").select("name").eq("id", customerTypeId).single()
  ]);

  return {
    customerTypeId,
    customerTypeName: customerType.data?.name ?? "",
    priceBreaks: (priceBreaks.data ?? []).map((b) => ({
      quantity: b.minQuantity,
      unitPrice: b.unitPrice ?? 0
    }))
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId, customerTypeId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!customerTypeId) throw new Error("Could not find customerTypeId");

  const formData = await request.formData();
  const priceBreaksJson = formData.get("priceBreaks");

  if (!priceBreaksJson || typeof priceBreaksJson !== "string") {
    return { success: false, message: "Price breaks are required" };
  }

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
        unitPrice: b.unitPrice,
        customerTypeId
      })),
      customerTypeId
    );
  } catch {
    throw redirect(
      path.to.partSales(itemId),
      await flash(
        request,
        error(null, "Failed to update customer type price breaks")
      )
    );
  }

  throw redirect(path.to.partSales(itemId));
}

export default function EditCustomerTypePriceBreakRoute() {
  const { customerTypeId, customerTypeName, priceBreaks } =
    useLoaderData<typeof loader>();

  return (
    <CustomerTypePriceBreakForm
      initialValues={{
        customerTypeId,
        customerTypeName
      }}
      priceBreaks={priceBreaks}
    />
  );
}
