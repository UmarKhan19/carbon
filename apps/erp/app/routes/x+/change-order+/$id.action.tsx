import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeOrderActionValidator,
  upsertChangeOrderAction
} from "~/modules/change-orders";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(changeOrderActionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, changeOrderId, name, assignee, dueDate } = validation.data;

  const upsert = await upsertChangeOrderAction(client, {
    id,
    changeOrderId,
    name,
    assignee,
    dueDate,
    companyId,
    userId
  });

  if (upsert.error) {
    return data(
      { success: false },
      await flash(request, error(upsert.error, "Failed to save action"))
    );
  }

  return { success: true };
}
