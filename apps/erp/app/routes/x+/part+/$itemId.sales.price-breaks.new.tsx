import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import CustomerTypePriceBreakForm from "~/modules/items/ui/Item/CustomerTypePriceBreakForm";
import { upsertItemSalePriceBreaks } from "~/modules/sales/pricing/pricing.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts",
    role: "employee"
  });

  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const customerTypeId = formData.get("customerTypeId") as string;

  if (!customerTypeId) {
    return { success: false, message: "Customer type is required" };
  }

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
        error(null, "Failed to create customer type price breaks")
      )
    );
  }

  throw redirect(path.to.partSales(itemId));
}

export default function NewCustomerTypePriceBreakRoute() {
  return <CustomerTypePriceBreakForm />;
}
