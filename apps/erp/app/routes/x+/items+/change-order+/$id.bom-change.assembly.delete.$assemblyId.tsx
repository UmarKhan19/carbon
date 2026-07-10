import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  deleteChangeOrderBomChangeAssembly,
  syncChangeOrderProductsAffected
} from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id, assemblyId } = params;
  if (!assemblyId) throw new Error("Could not find assemblyId");

  const remove = await deleteChangeOrderBomChangeAssembly(client, assemblyId);

  if (remove.error) {
    return data(
      { success: false },
      await flash(request, error(remove.error, "Failed to remove assembly"))
    );
  }

  // Products Affected are derived from the BOM-change assemblies — recompute now.
  if (id) {
    await syncChangeOrderProductsAffected(client, id, companyId, userId);
  }

  return { success: true };
}
