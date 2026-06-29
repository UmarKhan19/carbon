import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateMaterialOrder } from "~/modules/items";
import {
  getItemIdForMaterial,
  getRevisionLock,
  LOCKED_REVISION_MESSAGE
} from "~/modules/items/revisionLock.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const updateMap = (await request.formData()).get("updates") as string;
  if (!updateMap) {
    return data(
      {},
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  const updates = Object.entries(JSON.parse(updateMap)).map(
    ([id, orderString]) => ({
      id,
      order: Number(orderString),
      updatedBy: userId
    })
  );

  // Release-lock gate: block edits to a released (Production) revision unless a
  // change order is used. enforce -> block; warn -> proceed + flash; off -> no-op.
  // All materials in a reorder share one make method, so resolve from the first.
  const lockItemId = updates[0]
    ? await getItemIdForMaterial(client, updates[0].id)
    : null;
  const lock = await getRevisionLock(client, { itemId: lockItemId, companyId });
  if (lock.isLocked && lock.releaseControl === "enforce") {
    return data(
      {},
      await flash(request, error(null, LOCKED_REVISION_MESSAGE))
    );
  }
  const lockWarn = lock.isLocked && lock.releaseControl === "warn";

  const updateSortOrders = await updateMaterialOrder(client, updates);
  if (updateSortOrders.some((update) => update.error))
    return data(
      {},
      await flash(
        request,
        error(updateSortOrders, "Failed to update sort order")
      )
    );

  if (lockWarn) {
    return data(null, await flash(request, success(LOCKED_REVISION_MESSAGE)));
  }

  return null;
}
