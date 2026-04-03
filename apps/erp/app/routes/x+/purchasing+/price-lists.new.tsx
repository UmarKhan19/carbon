import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { createPriceList, priceListValidator } from "~/modules/pricing";
import { PriceListForm } from "~/modules/pricing/ui/PriceLists";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "purchasing" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const formData = await request.formData();
  const validation = await validator(priceListValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await createPriceList(client, companyId, userId, {
    ...validation.data,
    type: "Purchase"
  });

  if (result.error) {
    return redirect(
      `${path.to.purchasePriceLists}?${getParams(request)}`,
      await flash(request, error(result.error, "Failed to create price list"))
    );
  }

  return redirect(
    path.to.priceListDetails(result.data.id),
    await flash(request, success("Price list created"))
  );
}

export default function NewPurchasePriceListRoute() {
  const navigate = useNavigate();

  return (
    <PriceListForm
      initialValues={{
        name: "",
        type: "Purchase",
        priceType: "Net",
        currencyCode: "USD"
      }}
      onClose={() => navigate(-1)}
    />
  );
}
