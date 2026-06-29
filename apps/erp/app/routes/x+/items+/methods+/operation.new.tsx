import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  methodOperationValidator,
  upsertMethodOperation
} from "~/modules/items";
import {
  getItemIdForMakeMethod,
  getRevisionLock,
  LOCKED_REVISION_MESSAGE
} from "~/modules/items/revisionLock.server";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(methodOperationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // Release-lock gate: block edits to a released (Production) revision unless a
  // change order is used. enforce -> block; warn -> proceed + flash; off -> no-op.
  const lockItemId = await getItemIdForMakeMethod(
    client,
    validation.data.makeMethodId
  );
  const lock = await getRevisionLock(client, { itemId: lockItemId, companyId });
  if (lock.isLocked && lock.releaseControl === "enforce") {
    return validationError({
      fieldErrors: { description: LOCKED_REVISION_MESSAGE }
    });
  }
  const lockWarn = lock.isLocked && lock.releaseControl === "warn";

  const insertMethodOperation = await upsertMethodOperation(client, {
    ...validation.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertMethodOperation.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertMethodOperation.error, "Failed to insert method operation")
      )
    );
  }

  const methodOperationId = insertMethodOperation.data?.id;
  if (!methodOperationId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertMethodOperation, "Failed to insert method operation")
      )
    );
  }

  const result = {
    id: methodOperationId,
    success: true,
    message: "Operation created"
  };

  if (lockWarn) {
    return data(result, await flash(request, success(LOCKED_REVISION_MESSAGE)));
  }

  return result;
}
