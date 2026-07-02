import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  replaceMethodOperationToolSteps,
  upsertMethodOperationTool
} from "~/modules/items";
import { operationToolValidator } from "~/modules/shared";
import { getFormDataArray } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) {
    return { success: false, message: "Invalid operation tool id" };
  }

  const formData = await request.formData();
  const validation = await validator(operationToolValidator).validate(formData);

  if (validation.error) {
    return { success: false, message: "Invalid form data" };
  }

  const { id: _id, ...d } = validation.data;

  // Per-step assignment (tool ↔ step is many-to-many). Read from formData directly so the
  // shared operationToolValidator stays tier-agnostic; links are written after the upsert.
  const methodOperationStepIds = getFormDataArray(
    formData,
    "methodOperationStepIds"
  );

  const update = await upsertMethodOperationTool(client, {
    id,
    ...d,
    companyId,
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
        error(update.error, "Failed to update method operation tool")
      )
    );
  }

  const methodOperationToolId = update.data?.id;
  if (!methodOperationToolId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(update.error, "Failed to update method operation tool")
      )
    );
  }

  const stepLink = await replaceMethodOperationToolSteps(
    client,
    methodOperationToolId,
    methodOperationStepIds
  );
  if (stepLink.error) {
    return data(
      { id: methodOperationToolId },
      await flash(request, error(stepLink.error, "Failed to link tool to steps"))
    );
  }

  return data(
    { id: methodOperationToolId },
    await flash(request, success("Method operation tool updated"))
  );
}
