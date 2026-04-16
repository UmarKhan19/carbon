import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  getTrackedEntityForJob,
  updateJobBatchNumber
} from "~/modules/production/production.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "production",
    bypassRls: true
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");
  const formData = await request.formData();
  const trackedEntityId = String(formData.get("id"));
  const value = String(formData.get("value"));
  if (!value) throw new Error("Could not find value");

  const trackedEntity = await getTrackedEntityForJob(
    client,
    trackedEntityId,
    jobId,
    companyId
  );

  if (trackedEntity.error || !trackedEntity.data) {
    return data(
      trackedEntity,
      await flash(request, error(trackedEntity.error, "Access Denied"))
    );
  }

  const update = await updateJobBatchNumber(
    client,
    trackedEntity.data.id,
    value
  );

  if (update.error) {
    return data(
      update,
      await flash(request, error(update.error, update.error.message))
    );
  }

  return update;
}
