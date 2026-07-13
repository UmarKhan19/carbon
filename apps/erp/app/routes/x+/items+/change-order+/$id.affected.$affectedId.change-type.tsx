import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeOrderAffectedItemChangeTypeValidator,
  updateChangeOrderAffectedItemChangeType
} from "~/modules/items";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(
    changeOrderAffectedItemChangeTypeValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, changeType } = validation.data;

  const update = await updateChangeOrderAffectedItemChangeType(client, {
    id,
    changeType,
    companyId,
    userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to change type"))
    );
  }

  return { success: true, id: update.data?.id };
}
