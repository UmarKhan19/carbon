import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyInstructionStepPartsValidator,
  updateAssemblyStepParts
} from "~/modules/production";

// Autosave target for the Details panel's Add/remove part controls: patches only
// the step's assigned parts, leaving the rest of the step untouched.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { stepId } = params;
  if (!stepId) throw notFound("step id is not found");

  const validation = await validator(
    assemblyInstructionStepPartsValidator
  ).validate(await request.formData());

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to update parts"))
    );
  }

  const update = await updateAssemblyStepParts(client, {
    id: stepId,
    partNodeIds: validation.data.partNodeIds,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update parts"))
    );
  }

  return { success: true };
}
