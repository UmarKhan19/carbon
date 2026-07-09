import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteChangeOrderBomChange } from "~/modules/change-orders";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { rowId } = params;
  if (!rowId) throw new Error("Could not find rowId");

  const remove = await deleteChangeOrderBomChange(client, rowId);

  if (remove.error) {
    return data(
      { success: false },
      await flash(request, error(remove.error, "Failed to remove BOM change"))
    );
  }

  return { success: true };
}
