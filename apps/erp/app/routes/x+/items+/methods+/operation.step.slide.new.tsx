import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  upsertMethodOperationStepSlide
} from "~/modules/items";
import { operationStepSlideValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(operationStepSlideValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const step = await client
    .from("methodOperationStep")
    .select("operationId")
    .eq("id", validation.data.stepId)
    .single();

  if (step.error || !step.data) {
    throw new Error("Step not found");
  }

  await assertMethodOperationIsDraft(client, step.data.operationId);

  const insert = await upsertMethodOperationStepSlide(client, {
    ...validation.data,
    companyId,
    createdBy: userId
  });
  if (insert.error) {
    return data(
      { id: null },
      await flash(
        request,
        error(insert.error, "Failed to insert operation step slide")
      )
    );
  }

  return { id: insert.data?.id ?? null };
}
