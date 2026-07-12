import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteChangeOrderStagedOperationParameter } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { parameterId } = params;
  if (!parameterId) throw new Error("Could not find parameterId");

  const remove = await deleteChangeOrderStagedOperationParameter(
    client,
    parameterId
  );

  if (remove.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(remove.error, "Failed to remove staged operation parameter")
      )
    );
  }

  return { success: true };
}
