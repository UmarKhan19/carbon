import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  upsertMethodOperationStep
} from "~/modules/items";
import {
  getItemIdForOperation,
  getRevisionLock,
  LOCKED_REVISION_MESSAGE
} from "~/modules/items/revisionLock.server";
import { operationStepValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) {
    return { success: false, message: "Invalid operation step id" };
  }

  const formData = await request.formData();
  const validation = await validator(operationStepValidator).validate(formData);

  if (validation.error) {
    return { success: false, message: "Invalid form data" };
  }

  const { id: _id, ...d } = validation.data;

  // Release-lock gate: block edits to a released (Production) revision unless a
  // change order is used. enforce -> block; warn -> proceed + flash; off -> no-op.
  const lockItemId = await getItemIdForOperation(
    client,
    validation.data.operationId
  );
  const lock = await getRevisionLock(client, { itemId: lockItemId, companyId });
  if (lock.isLocked && lock.releaseControl === "enforce") {
    return { success: false, message: LOCKED_REVISION_MESSAGE };
  }
  const lockWarn = lock.isLocked && lock.releaseControl === "warn";

  await assertMethodOperationIsDraft(client, validation.data.operationId);

  const update = await upsertMethodOperationStep(client, {
    id,
    ...d,
    minValue: d.minValue ?? null,
    maxValue: d.maxValue ?? null,
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
        error(update.error, "Failed to update method operation step")
      )
    );
  }

  const methodOperationStepId = update.data?.id;
  if (!methodOperationStepId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(update.error, "Failed to update method operation step")
      )
    );
  }

  return data(
    { id: methodOperationStepId },
    await flash(
      request,
      success(lockWarn ? LOCKED_REVISION_MESSAGE : "Method operation step updated")
    )
  );
}
