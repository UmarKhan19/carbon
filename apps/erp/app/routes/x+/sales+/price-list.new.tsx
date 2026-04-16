import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  priceOverrideValidator,
  upsertCustomerItemPriceOverride
} from "~/modules/sales";
import PriceOverrideForm from "~/modules/sales/ui/Pricing/PriceOverrideForm";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "sales" });

  const url = new URL(request.url);
  return {
    initial: {
      customerId: url.searchParams.get("customerId") ?? undefined,
      customerTypeId: url.searchParams.get("customerTypeId") ?? undefined,
      itemId: url.searchParams.get("itemId") ?? ""
    }
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(priceOverrideValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    customerId,
    customerTypeId,
    itemId,
    overridePrice,
    active,
    applyRulesOnTop,
    notes,
    validFrom,
    validTo
  } = validation.data;

  const result = await upsertCustomerItemPriceOverride(
    client,
    companyId,
    userId,
    {
      customerId: customerId || undefined,
      customerTypeId: customerTypeId || undefined,
      itemId,
      overridePrice,
      active,
      applyRulesOnTop,
      notes,
      validFrom,
      validTo
    }
  );

  if (result.error) {
    throw redirect(
      `${path.to.salesPriceList}?${getParams(request)}`,
      await flash(
        request,
        error(result.error, "Failed to create price override")
      )
    );
  }

  throw redirect(
    `${path.to.salesPriceList}?${getParams(request)}`,
    await flash(request, success("Price override created"))
  );
}

export default function NewPriceOverrideRoute() {
  const { initial } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <PriceOverrideForm
      initialValues={{
        itemId: initial.itemId,
        customerId: initial.customerId,
        customerTypeId: initial.customerTypeId,
        overridePrice: 0,
        active: true,
        applyRulesOnTop: true
      }}
      onClose={() => navigate(-1)}
    />
  );
}
