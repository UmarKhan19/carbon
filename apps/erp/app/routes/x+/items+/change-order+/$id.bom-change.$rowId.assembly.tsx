import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeOrderBomChangeAssemblyValidator,
  upsertChangeOrderBomChangeAssembly
} from "~/modules/items";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(
    changeOrderBomChangeAssemblyValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, bomChangeId, assemblyItemId, quantity, supersessionMode } =
    validation.data;

  const upsert = await upsertChangeOrderBomChangeAssembly(client, {
    id,
    bomChangeId,
    assemblyItemId,
    quantity,
    supersessionMode,
    companyId,
    userId
  });

  if (upsert.error) {
    return data(
      { success: false },
      await flash(request, error(upsert.error, "Failed to save assembly"))
    );
  }

  return { success: true };
}
