import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyInstructionStepMotionValidator,
  updateAssemblyStepMotion
} from "~/modules/production";

// Autosave target for the 3D motion-path editor: patches only motion/camera on
// a step (drag autosave + "Set view"/"Clear view"), leaving the rest untouched.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { stepId } = params;
  if (!stepId) throw notFound("step id is not found");

  const validation = await validator(
    assemblyInstructionStepMotionValidator
  ).validate(await request.formData());

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to update motion"))
    );
  }

  const update = await updateAssemblyStepMotion(client, {
    id: stepId,
    motion: validation.data.motion,
    camera: validation.data.camera,
    updatedBy: userId
  });
  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update motion"))
    );
  }

  return { success: true };
}
