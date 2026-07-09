import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteChangeOrderProductAffected } from "~/modules/change-orders";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { productId } = params;
  if (!productId) throw new Error("Could not find productId");

  const remove = await deleteChangeOrderProductAffected(client, productId);

  if (remove.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(remove.error, "Failed to remove product affected")
      )
    );
  }

  return { success: true };
}
