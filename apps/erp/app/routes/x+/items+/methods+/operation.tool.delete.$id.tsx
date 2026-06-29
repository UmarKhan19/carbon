import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteMethodOperationTool } from "~/modules/items";
import {
  getItemIdForTool,
  getRevisionLock,
  LOCKED_REVISION_MESSAGE
} from "~/modules/items/revisionLock.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  // Release-lock gate: block edits to a released (Production) revision unless a
  // change order is used. enforce -> block; warn -> proceed + flash; off -> no-op.
  const lockItemId = await getItemIdForTool(client, id);
  const lock = await getRevisionLock(client, { itemId: lockItemId, companyId });
  if (lock.isLocked && lock.releaseControl === "enforce") {
    return data(
      { id: null },
      await flash(request, error(null, LOCKED_REVISION_MESSAGE))
    );
  }
  const lockWarn = lock.isLocked && lock.releaseControl === "warn";

  const deleteOperationTool = await deleteMethodOperationTool(client, id);
  if (deleteOperationTool.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(
          deleteOperationTool.error,
          "Failed to delete method operation tool"
        )
      )
    );
  }

  if (lockWarn) {
    return data({}, await flash(request, success(LOCKED_REVISION_MESSAGE)));
  }

  return {};
}
