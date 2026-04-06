import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { PriceListDetail } from "~/modules/pricing";
import {
  getPriceListItem,
  getPriceListItemBreaks,
  getPriceListType,
  priceListItemValidator,
  updatePriceListItem,
  upsertPriceListItemBreaks
} from "~/modules/pricing";
import { PriceListItemForm } from "~/modules/pricing/ui/PriceListItems";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { role: "employee" });

  const { id, itemId } = params;
  if (!id) throw new Error("Price list ID not found");

  const plType = await getPriceListType(client, id);
  await requirePermissions(request, {
    update: plType === "Purchase" ? "purchasing" : "sales"
  });

  if (!itemId) throw notFound("Item ID not found");

  const [{ data: item, error: itemError }, { data: breaks }] =
    await Promise.all([
      getPriceListItem(client, itemId),
      getPriceListItemBreaks(client, itemId)
    ]);

  if (itemError || !item) throw notFound("Price list item not found");

  return { item, breaks: breaks ?? [] };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const { id, itemId } = params;
  if (!id || !itemId) throw new Error("IDs not found");

  const plType = await getPriceListType(client, id);
  await requirePermissions(request, {
    update: plType === "Purchase" ? "purchasing" : "sales"
  });

  const formData = await request.formData();
  const validation = await validator(priceListItemValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await updatePriceListItem(client, itemId, userId, {
    ...validation.data,
    priceListId: id
  });

  if (result.error) {
    return redirect(
      path.to.priceListItems(id),
      await flash(request, error(result.error, "Failed to update item"))
    );
  }

  // Upsert price breaks
  const priceBreaksJson = formData.get("priceBreaks");
  if (priceBreaksJson && typeof priceBreaksJson === "string") {
    try {
      const breaks = JSON.parse(priceBreaksJson) as Array<{
        quantity: number;
        unitPrice: number;
      }>;
      await upsertPriceListItemBreaks(
        client,
        itemId,
        companyId,
        userId,
        breaks.map((b) => ({
          minQuantity: b.quantity,
          unitPrice: b.unitPrice
        }))
      );
    } catch {
      // Ignore parse errors
    }
  }

  return redirect(
    path.to.priceListItems(id),
    await flash(request, success("Item updated"))
  );
}

export default function EditPriceListItemRoute() {
  const { id } = useParams();
  const { item, breaks } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!id) throw new Error("Price list ID not found");

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(id)
  );

  return (
    <PriceListItemForm
      initialValues={{
        id: item.id,
        priceListId: item.priceListId,
        itemId: item.itemId ?? undefined,
        itemPostingGroupId: item.itemPostingGroupId ?? undefined,
        unitPrice: item.unitPrice,
        unitOfMeasureCode: item.unitOfMeasureCode ?? undefined,
        pricingMethod: item.pricingMethod,
        formulaBase: item.formulaBase ?? undefined,
        markupPercent: item.markupPercent ?? undefined,
        minMarginPercent: item.minMarginPercent ?? undefined
      }}
      initialBreaks={breaks.map((b) => ({
        quantity: b.minQuantity,
        unitPrice: b.unitPrice
      }))}
      priceListType={routeData?.priceList?.type}
      onClose={() => navigate(path.to.priceListItems(id))}
    />
  );
}
