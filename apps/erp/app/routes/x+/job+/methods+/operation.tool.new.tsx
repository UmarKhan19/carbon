import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  replaceJobOperationToolSteps,
  upsertJobOperationTool
} from "~/modules/production";
import { operationToolValidator } from "~/modules/shared";
import { getFormDataArray } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const formData = await request.formData();
  const validation = await validator(operationToolValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // Per-step assignment (tool ↔ step is many-to-many). Read from formData directly so the
  // shared operationToolValidator stays tier-agnostic; links are written after the upsert.
  const jobOperationStepIds = getFormDataArray(formData, "jobOperationStepIds");

  const insert = await upsertJobOperationTool(client, {
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
        error(insert.error, "Failed to insert job operation tool")
      )
    );
  }

  const jobOperationToolId = insert.data?.id;
  if (!jobOperationToolId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert job operation tool")
      )
    );
  }

  const stepLink = await replaceJobOperationToolSteps(
    client,
    jobOperationToolId,
    jobOperationStepIds
  );
  if (stepLink.error) {
    return data(
      { id: jobOperationToolId },
      await flash(request, error(stepLink.error, "Failed to link tool to steps"))
    );
  }

  return { id: jobOperationToolId };
}
