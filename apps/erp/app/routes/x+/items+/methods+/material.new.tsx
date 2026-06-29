import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { methodMaterialValidator, upsertMethodMaterial } from "~/modules/items";
import {
  getItemIdForMakeMethod,
  getRevisionLock,
  LOCKED_REVISION_MESSAGE
} from "~/modules/items/items.server";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(methodMaterialValidator).validate(
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
    return data(
      { id: null },
      await flash(request, error(null, LOCKED_REVISION_MESSAGE))
    );
  }
  const lockWarn = lock.isLocked && lock.releaseControl === "warn";

  const insertMethodMaterial = await upsertMethodMaterial(client, {
    ...validation.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (insertMethodMaterial.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertMethodMaterial.error, "Failed to insert method material")
      )
    );
  }

  const methodMaterialId = insertMethodMaterial.data?.id;
  if (!methodMaterialId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertMethodMaterial, "Failed to insert method material")
      )
    );
  }

  const result = {
    id: methodMaterialId,
    success: true,
    message: "Material created"
  };

  if (lockWarn) {
    return data(result, await flash(request, success(LOCKED_REVISION_MESSAGE)));
  }

  return result;
}
