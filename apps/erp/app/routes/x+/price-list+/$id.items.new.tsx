import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { PriceListDetail } from "~/modules/pricing";
import {
  createPriceListItem,
  getPriceListType,
  priceListItemValidator,
  upsertPriceListItemBreaks
} from "~/modules/pricing";
import { PriceListItemForm } from "~/modules/pricing/ui/PriceListItems";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { role: "employee" });
  const { id } = params;
  if (!id) throw new Error("Price list ID not found");
  const plType = await getPriceListType(client, id);
  await requirePermissions(request, {
    create: plType === "Purchase" ? "purchasing" : "sales"
  });
  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const { id } = params;
  if (!id) throw new Error("Price list ID not found");

  const plType = await getPriceListType(client, id);
  await requirePermissions(request, {
    create: plType === "Purchase" ? "purchasing" : "sales"
  });

  const formData = await request.formData();
  const validation = await validator(priceListItemValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await createPriceListItem(client, companyId, userId, {
    ...validation.data,
    priceListId: id
  });

  if (result.error) {
    return redirect(
      path.to.priceListItems(id),
      await flash(request, error(result.error, "Failed to add item"))
    );
  }

  // Create price breaks if provided
  const priceBreaksJson = formData.get("priceBreaks");
  if (priceBreaksJson && typeof priceBreaksJson === "string" && result.data) {
    try {
      const breaks = JSON.parse(priceBreaksJson) as Array<{
        quantity: number;
        unitPrice: number;
      }>;
      if (breaks.length > 0) {
        await upsertPriceListItemBreaks(
          client,
          result.data.id,
          companyId,
          userId,
          breaks.map((b) => ({
            minQuantity: b.quantity,
            unitPrice: b.unitPrice
          }))
        );
      }
    } catch {
      // Ignore parse errors — breaks are optional
    }
  }

  return redirect(
    path.to.priceListItems(id),
    await flash(request, success("Item added"))
  );
}

export default function NewPriceListItemRoute() {
  const { id } = useParams();
  const navigate = useNavigate();

  if (!id) throw new Error("Price list ID not found");

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(id)
  );

  return (
    <PriceListItemForm
      initialValues={{
        priceListId: id,
        unitPrice: 0
      }}
      priceListType={routeData?.priceList?.type}
      onClose={() => navigate(path.to.priceListItems(id))}
    />
  );
}
