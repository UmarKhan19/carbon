import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeOrderStagedOperationStepValidator,
  upsertChangeOrderStagedOperationStep
} from "~/modules/items";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(
    changeOrderStagedOperationStepValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const upsert = await upsertChangeOrderStagedOperationStep(client, {
    ...validation.data,
    companyId,
    userId
  });

  if (upsert.error || !upsert.data) {
    return data(
      { success: false },
      await flash(
        request,
        error(
          upsert.error,
          upsert.error?.message ?? "Failed to save staged operation step"
        )
      )
    );
  }

  return { success: true, id: upsert.data.id };
}
