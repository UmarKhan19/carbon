import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteItemSalePriceBreaksByCustomerType } from "~/modules/sales/pricing/pricing.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { itemId, customerTypeId } = params;
  if (!itemId) throw notFound("itemId not found");
  if (!customerTypeId) throw notFound("customerTypeId not found");

  const customerType = await client
    .from("customerType")
    .select("name")
    .eq("id", customerTypeId)
    .single();

  return { customerTypeName: customerType.data?.name ?? "" };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { itemId, customerTypeId } = params;
  if (!itemId) throw notFound("Could not find itemId");
  if (!customerTypeId) throw notFound("Could not find customerTypeId");

  try {
    await deleteItemSalePriceBreaksByCustomerType(
      itemId,
      companyId,
      customerTypeId
    );
  } catch (e) {
    throw redirect(
      path.to.partSales(itemId),
      await flash(
        request,
        error(e, "Failed to delete customer type price breaks")
      )
    );
  }

  throw redirect(
    path.to.partSales(itemId),
    await flash(
      request,
      success("Successfully deleted customer type price breaks")
    )
  );
}

export default function DeleteCustomerTypePriceBreaksRoute() {
  const { t } = useLingui();
  const { itemId, customerTypeId } = useParams();
  const { customerTypeName } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!itemId) throw notFound("Could not find itemId");
  if (!customerTypeId) throw notFound("Could not find customerTypeId");

  const onCancel = () => navigate(path.to.partSales(itemId));

  return (
    <ConfirmDelete
      action={path.to.deleteCustomerTypePriceBreaks(itemId, customerTypeId)}
      name={t`Customer Type Price Breaks`}
      text={t`Are you sure you want to delete all price breaks for ${customerTypeName}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
