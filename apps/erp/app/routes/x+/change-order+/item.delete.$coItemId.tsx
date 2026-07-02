import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { removeAffectedItem } from "~/modules/items";

// removeAffectedItem enforces the draft-only guard + pending-revision cleanup.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { coItemId } = params;
  if (!coItemId) throw new Error("Could not find coItemId");

  const removal = await removeAffectedItem(client, {
    id: coItemId,
    companyId
  });

  if (removal.error) {
    return { success: false, message: removal.error.message };
  }

  return { success: true };
}
