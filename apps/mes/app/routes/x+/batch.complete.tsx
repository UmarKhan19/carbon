import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { batchCompleteValidator } from "~/services/models";
import { path } from "~/utils/path";

// Completes a batch: hands the per-member quantities to the `batch-operations`
// edge function, which slices the recorded aggregate timers into per-member
// productionEvents, records per-member Production/Scrap quantities, issues each
// member's own BOM, flips every member Done, and posts GL per sliced event.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const validation = await validator(batchCompleteValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = await getCarbonServiceRole();
  const response = await serviceRole.functions.invoke("batch-operations", {
    body: {
      type: "complete",
      jobOperationBatchId: validation.data.jobOperationBatchId,
      members: validation.data.members,
      companyId,
      userId
    }
  });

  if (response.error) {
    return data(
      {},
      await flash(request, error(response.error, "Failed to complete batch"))
    );
  }

  throw redirect(
    path.to.operations,
    await flash(request, success("Batch completed successfully"))
  );
}
