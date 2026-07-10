import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  deleteChangeOrderBomChange,
  syncChangeOrderProductsAffected
} from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id, rowId } = params;
  if (!rowId) throw new Error("Could not find rowId");

  const remove = await deleteChangeOrderBomChange(client, rowId);

  if (remove.error) {
    return data(
      { success: false },
      await flash(request, error(remove.error, "Failed to remove BOM change"))
    );
  }

  // Products Affected are derived from the BOM-change assemblies — recompute now.
  if (id) {
    await syncChangeOrderProductsAffected(client, id, companyId, userId);
  }

  return { success: true };
}
