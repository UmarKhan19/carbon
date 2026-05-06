import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { jobAutoGeneratePickingListValidator } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("jobId required");

  const formData = await request.formData();
  const validation = await validator(
    jobAutoGeneratePickingListValidator
  ).validate(formData);

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Invalid form data"))
    );
  }

  const { error: updateError } = await client
    .from("job")
    .update({
      autoGeneratePickingList: validation.data.autoGeneratePickingList
    })
    .eq("id", jobId)
    .eq("companyId", companyId);

  if (updateError) {
    return data(
      { success: false },
      await flash(
        request,
        error(updateError, "Failed to update auto-gen setting")
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Auto-generation setting updated"))
  );
}
