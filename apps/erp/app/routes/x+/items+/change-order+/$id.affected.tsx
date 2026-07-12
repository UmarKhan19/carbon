import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  addChangeOrderAffectedItem,
  changeOrderAffectedItemValidator
} from "~/modules/items";
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(changeOrderAffectedItemValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { changeOrderId, itemId } = validation.data;

  const add = await addChangeOrderAffectedItem(client, getDatabaseClient(), {
    changeOrderId,
    itemId,
    companyId,
    userId
  });

  if (add.error || !add.data) {
    return data(
      { success: false },
      await flash(
        request,
        error(add.error, add.error?.message ?? "Failed to add affected item")
      )
    );
  }

  return { success: true, id: add.data.id };
}
