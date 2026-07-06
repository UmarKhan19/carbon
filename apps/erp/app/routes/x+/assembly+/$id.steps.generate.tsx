import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  generateAssemblyStepsFromPlan,
  getLatestAssemblyPlanJob
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const mode =
    formData.get("mode") === "regenerate" ? "regenerate" : "generate";

  const result = await generateAssemblyStepsFromPlan(client, {
    assemblyInstructionId: id,
    companyId,
    userId,
    mode
  });

  if (result.ok) {
    return data(
      { success: true },
      await flash(
        request,
        success(
          mode === "regenerate"
            ? `Regenerated ${result.created} steps from the motion plan`
            : `Generated ${result.created} steps from the motion plan`
        )
      )
    );
  }

  if (result.reason === "no-plan" && result.modelUploadId) {
    // No plan yet. The caller polls and re-submits once the plan lands, so
    // just make sure a planner run is (or will be) in flight — conversion
    // chains planning automatically, and a Queued/Processing plan job must
    // not be duplicated.
    const [model, planJob] = await Promise.all([
      client
        .from("modelUpload")
        .select("processingStatus")
        .eq("id", result.modelUploadId)
        .maybeSingle(),
      getLatestAssemblyPlanJob(client, result.modelUploadId)
    ]);

    const isConverting =
      model.data?.processingStatus === "Queued" ||
      model.data?.processingStatus === "Processing";
    const isPlanning =
      planJob.data?.status === "Queued" ||
      planJob.data?.status === "Processing";

    if (!isConverting && !isPlanning) {
      await trigger("assembly-plan", {
        modelUploadId: result.modelUploadId,
        companyId,
        userId,
        // Generate the steps server-side once the plan lands, so this completes
        // even if the user navigates away while it's solving.
        generateStepsFor: id
      });
    }

    return { success: false, planning: true };
  }

  const message =
    result.reason === "steps-exist"
      ? "Steps already exist — delete them before generating from the plan"
      : result.reason === "steps-locked"
        ? (result.message ?? "Some steps are locked — cannot regenerate")
        : result.reason === "no-model"
          ? "This instruction has no processed model"
          : (result.message ?? "Failed to generate steps");

  return data({ success: false }, await flash(request, error(null, message)));
}
