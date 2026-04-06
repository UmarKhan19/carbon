import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { duplicatePriceList } from "~/modules/pricing";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) throw new Error("Price list ID not found");
  return redirect(path.to.priceListItems(id));
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const { id } = params;
  if (!id) throw new Error("Price list ID not found");

  const result = await duplicatePriceList(client, id, companyId, userId);

  if (result.error) {
    return redirect(
      path.to.priceListItems(id),
      await flash(
        request,
        error(result.error, "Failed to duplicate price list")
      )
    );
  }

  return redirect(
    path.to.priceListItems(result.data!.id),
    await flash(request, success("Price list duplicated"))
  );
}

export default function PriceListDuplicateRedirect() {
  return null;
}
