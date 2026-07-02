import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
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
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(operationToolValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // Per-step assignment (tool ↔ step is many-to-many). Read from formData directly so the
  // shared operationToolValidator stays tier-agnostic; links are written after the upsert.
  const methodOperationStepIds = getFormDataArray(
    formData,
    "methodOperationStepIds"
  );

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

  return { id: methodOperationToolId };
}
