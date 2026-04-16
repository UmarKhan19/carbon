import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  priceOverrideValidator,
  upsertCustomerItemPriceOverride
} from "~/modules/sales";
import PriceOverrideForm from "~/modules/sales/ui/Pricing/PriceOverrideForm";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "sales" });
  return null;
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
  const navigate = useNavigate();

  return (
    <PriceOverrideForm
      initialValues={{
        itemId: "",
        overridePrice: 0,
        active: true
      }}
      onClose={() => navigate(-1)}
    />
  );
}
