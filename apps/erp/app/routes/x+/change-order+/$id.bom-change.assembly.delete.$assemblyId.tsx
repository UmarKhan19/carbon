import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteChangeOrderBomChangeAssembly } from "~/modules/change-orders";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { assemblyId } = params;
  if (!assemblyId) throw new Error("Could not find assemblyId");

  const remove = await deleteChangeOrderBomChangeAssembly(client, assemblyId);

  if (remove.error) {
    return data(
      { success: false },
      await flash(request, error(remove.error, "Failed to remove assembly"))
    );
  }

  return { success: true };
}
