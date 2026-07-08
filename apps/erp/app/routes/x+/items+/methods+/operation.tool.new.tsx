import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertMethodOperationTool } from "~/modules/items";
import { operationToolValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(operationToolValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // Tool↔step assignment now lives on the step editor (methodOperationStepTool route),
  // not this tool form — a new tool starts operation-level (shown on every step).
  const insert = await upsertMethodOperationTool(client, {
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
        error(insert.error, "Failed to insert method operation tool")
      )
    );
  }

  const methodOperationToolId = insert.data?.id;
  if (!methodOperationToolId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert method operation tool")
      )
    );
  }

  return { id: methodOperationToolId };
}
