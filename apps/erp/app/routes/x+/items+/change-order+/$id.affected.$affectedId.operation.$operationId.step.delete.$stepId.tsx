import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteChangeOrderStagedOperationStep } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { stepId } = params;
  if (!stepId) throw new Error("Could not find stepId");

  const remove = await deleteChangeOrderStagedOperationStep(client, stepId);

  if (remove.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(remove.error, "Failed to remove staged operation step")
      )
    );
  }

  return { success: true };
}
