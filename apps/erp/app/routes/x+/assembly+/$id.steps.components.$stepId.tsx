import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyInstructionStepComponentsValidator,
  updateAssemblyStepComponents
} from "~/modules/production";

// Autosave target for the Details panel's Add/remove component controls: patches
// only the step's assigned components, leaving the rest of the step untouched.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { stepId } = params;
  if (!stepId) throw notFound("step id is not found");

  const validation = await validator(
    assemblyInstructionStepComponentsValidator
  ).validate(await request.formData());

  if (validation.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(validation.error, "Failed to update components")
      )
    );
  }

  const update = await updateAssemblyStepComponents(client, {
    id: stepId,
    componentNodeIds: validation.data.componentNodeIds,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update components"))
    );
  }

  return { success: true };
}
