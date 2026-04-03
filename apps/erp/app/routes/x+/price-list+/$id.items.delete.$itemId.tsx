import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deletePriceListItem } from "~/modules/pricing";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "sales", role: "employee" });
  if (!params.itemId) throw notFound("Item ID not found");
  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, { delete: "sales" });

  const { id, itemId } = params;
  if (!id || !itemId) throw new Error("IDs not found");

  const { error: deleteError } = await deletePriceListItem(client, itemId);
  if (deleteError) {
    throw redirect(
      path.to.priceListItems(id),
      await flash(request, error(deleteError, "Failed to delete item"))
    );
  }

  throw redirect(
    path.to.priceListItems(id),
    await flash(request, success("Item deleted"))
  );
}

export default function DeletePriceListItemRoute() {
  const { id, itemId } = useParams();
  const navigate = useNavigate();

  if (!id || !itemId) return null;

  return (
    <ConfirmDelete
      action={`${path.to.priceListItems(id)}/delete/${itemId}`}
      name="Price List Item"
      text="Are you sure you want to remove this item from the price list?"
      onCancel={() => navigate(path.to.priceListItems(id))}
    />
  );
}
