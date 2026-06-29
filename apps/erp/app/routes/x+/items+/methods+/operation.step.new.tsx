import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
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
} from "~/modules/items/items.server";
import { operationStepValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(operationStepValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // Release-lock gate: block edits to a released (Production) revision unless a
  // change order is used. enforce -> block; warn -> proceed + flash; off -> no-op.
  const lockItemId = await getItemIdForOperation(
    client,
    validation.data.operationId
  );
  const lock = await getRevisionLock(client, { itemId: lockItemId, companyId });
  if (lock.isLocked && lock.releaseControl === "enforce") {
    return data(
      { id: null },
      await flash(request, error(null, LOCKED_REVISION_MESSAGE))
    );
  }
  const lockWarn = lock.isLocked && lock.releaseControl === "warn";

  await assertMethodOperationIsDraft(client, validation.data.operationId);

  const insert = await upsertMethodOperationStep(client, {
    ...validation.data,
    companyId,
    createdBy: userId
  });
  if (insert.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert method operation step")
      )
    );
  }

  const methodOperationStepId = insert.data?.id;
  if (!methodOperationStepId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert method operation step")
      )
    );
  }

  if (lockWarn) {
    return data(
      { id: methodOperationStepId },
      await flash(request, success(LOCKED_REVISION_MESSAGE))
    );
  }

  return { id: methodOperationStepId };
}
