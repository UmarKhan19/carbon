import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deletePriceList, getPriceList } from "~/modules/pricing";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("Price list ID not found");

  const priceList = await getPriceList(client, id);
  if (priceList.error) {
    throw redirect(
      `${path.to.purchasePriceLists}?${getParams(request)}`,
      await flash(request, error(priceList.error, "Failed to get price list"))
    );
  }

  return { priceList: priceList.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.purchasePriceLists}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get price list id"))
    );
  }

  const { error: deleteError } = await deletePriceList(client, id);
  if (deleteError) {
    throw redirect(
      `${path.to.purchasePriceLists}?${getParams(request)}`,
      await flash(request, error(deleteError, "Failed to delete price list"))
    );
  }

  throw redirect(
    `${path.to.purchasePriceLists}?${getParams(request)}`,
    await flash(request, success("Successfully deleted price list"))
  );
}

export default function DeletePurchasePriceListRoute() {
  const { id } = useParams();
  const { priceList } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!priceList || !id) return null;

  return (
    <ConfirmDelete
      action={path.to.purchasePriceLists + `/delete/${id}`}
      name={priceList.name}
      text={`Are you sure you want to delete the price list "${priceList.name}"? This will also delete all items, rules, and assignments. This cannot be undone.`}
      onCancel={() => navigate(path.to.purchasePriceLists)}
    />
  );
}
