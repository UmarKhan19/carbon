import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertMethodOperationParameter } from "~/modules/items";
import {
  getItemIdForParameter,
  getRevisionLock,
  LOCKED_REVISION_MESSAGE
} from "~/modules/items/revisionLock.server";
import { operationParameterValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) {
    return { success: false, message: "Invalid operation parameter id" };
  }

  const formData = await request.formData();
  const validation = await validator(operationParameterValidator).validate(
    formData
  );

  if (validation.error) {
    return { success: false, message: "Invalid form data" };
  }

  const { id: _id, ...d } = validation.data;

  // Release-lock gate: block edits to a released (Production) revision unless a
  // change order is used. enforce -> block; warn -> proceed + flash; off -> no-op.
  const lockItemId = await getItemIdForParameter(client, id);
  const lock = await getRevisionLock(client, { itemId: lockItemId, companyId });
  if (lock.isLocked && lock.releaseControl === "enforce") {
    return data(
      { id: null },
      await flash(request, error(null, LOCKED_REVISION_MESSAGE))
    );
  }
  const lockWarn = lock.isLocked && lock.releaseControl === "warn";

  const update = await upsertMethodOperationParameter(client, {
    id,
    ...d,
    companyId,
    updatedBy: userId,
    updatedAt: new Date().toISOString()
  });
  if (update.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(update.error, "Failed to update method operation parameter")
      )
    );
  }

  const methodOperationParameterId = update.data?.id;
  if (!methodOperationParameterId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(update.error, "Failed to update method operation parameter")
      )
    );
  }

  return data(
    { id: methodOperationParameterId },
    await flash(
      request,
      success(
        lockWarn ? LOCKED_REVISION_MESSAGE : "Method operation parameter updated"
      )
    )
  );
}
