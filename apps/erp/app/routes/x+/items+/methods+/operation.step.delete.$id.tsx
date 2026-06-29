import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  deleteMethodOperationStep
} from "~/modules/items";
import {
  getItemIdForOperation,
  getRevisionLock,
  LOCKED_REVISION_MESSAGE
} from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const step = await client
    .from("methodOperationStep")
    .select("operationId")
    .eq("id", id)
    .single();

  if (step.error || !step.data) {
    throw new Error("Step not found");
  }

  // Release-lock gate: block edits to a released (Production) revision unless a
  // change order is used. enforce -> block; warn -> proceed + flash; off -> no-op.
  const lockItemId = await getItemIdForOperation(client, step.data.operationId);
  const lock = await getRevisionLock(client, { itemId: lockItemId, companyId });
  if (lock.isLocked && lock.releaseControl === "enforce") {
    return data(
      { id: null },
      await flash(request, error(null, LOCKED_REVISION_MESSAGE))
    );
  }
  const lockWarn = lock.isLocked && lock.releaseControl === "warn";

  await assertMethodOperationIsDraft(client, step.data.operationId);

  const deleteOperationStep = await deleteMethodOperationStep(client, id);
  if (deleteOperationStep.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(
          deleteOperationStep.error,
          "Failed to delete method operation step"
        )
      )
    );
  }

  if (lockWarn) {
    return data({}, await flash(request, success(LOCKED_REVISION_MESSAGE)));
  }

  return {};
}
