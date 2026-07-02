import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
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
    update: "production"
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
  const jobOperationStepIds = getFormDataArray(formData, "jobOperationStepIds");

  const update = await upsertJobOperationTool(client, {
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
        error(update.error, "Failed to update job operation tool")
      )
    );
  }

  const operationToolId = update.data?.id;
  if (!operationToolId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(update.error, "Failed to update job operation tool")
      )
    );
  }

  const stepLink = await replaceJobOperationToolSteps(
    client,
    operationToolId,
    jobOperationStepIds
  );
  if (stepLink.error) {
    return data(
      { id: operationToolId },
      await flash(request, error(stepLink.error, "Failed to link tool to steps"))
    );
  }

  return data(
    { id: operationToolId },
    await flash(request, success("Job operation tool updated"))
  );
}
