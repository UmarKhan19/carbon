import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getLatestAssemblyPlanJob } from "~/modules/production";

/**
 * Re-runs motion planning over the instruction's converted model. Steps
 * generated from an older plan stay untouched — once the fresh plan lands,
 * the editor offers "Regenerate from Plan".
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const instruction = await client
    .from("assemblyInstruction")
    .select("modelUploadId, modelUpload(processingStatus)")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();

  if (instruction.error || !instruction.data.modelUploadId) {
    return data(
      { success: false },
      await flash(
        request,
        error(instruction.error, "This instruction has no model")
      )
    );
  }

  if (instruction.data.modelUpload?.processingStatus !== "Success") {
    return data(
      { success: false },
      await flash(
        request,
        error(null, "The model must finish converting before planning")
      )
    );
  }

  const planJob = await getLatestAssemblyPlanJob(
    client,
    instruction.data.modelUploadId
  );
  if (
    planJob.data?.status === "Queued" ||
    planJob.data?.status === "Processing"
  ) {
    return data(
      { success: false },
      await flash(request, error(null, "Motion planning is already running"))
    );
  }

  await trigger("assembly-plan", {
    modelUploadId: instruction.data.modelUploadId,
    companyId,
    userId
  });

  return data(
    { success: true },
    await flash(
      request,
      success("Motion planning started — regenerate steps when it finishes")
    )
  );
}
