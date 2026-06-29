import { success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  getItemIdForOperation,
  getRevisionLock,
  LOCKED_REVISION_MESSAGE
} from "~/modules/items/items.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;

  if (!id) {
    return data(
      { error: "Operation ID is required" },
      {
        status: 400
      }
    );
  }

  // Release-lock gate: block edits to a released (Production) revision unless a
  // change order is used. enforce -> block; warn/off -> proceed.
  const lockItemId = await getItemIdForOperation(client, id);
  const lock = await getRevisionLock(client, { itemId: lockItemId, companyId });
  if (lock.isLocked && lock.releaseControl === "enforce") {
    return data(
      { success: false, error: LOCKED_REVISION_MESSAGE },
      {
        status: 400
      }
    );
  }
  const lockWarn = lock.isLocked && lock.releaseControl === "warn";

  const { error } = await client.from("methodOperation").delete().eq("id", id);

  if (error) {
    return data(
      { success: false, error: error.message },
      {
        status: 400
      }
    );
  }

  if (lockWarn) {
    return data(
      { success: true },
      await flash(request, success(LOCKED_REVISION_MESSAGE))
    );
  }

  return { success: true };
}
