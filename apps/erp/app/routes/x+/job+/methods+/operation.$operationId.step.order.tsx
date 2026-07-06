import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateJobOperationStepOrder } from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const updateMap = formData.get("updates") as string;

  const { operationId } = params;
  if (!operationId) {
    return data(
      {},
      await flash(request, error(null, "Failed to receive an operation id"))
    );
  }

  if (!updateMap) {
    return data(
      {},
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  const updates = Object.entries(JSON.parse(updateMap)).map(
    ([id, sortOrderString]) => ({
      id,
      sortOrder: Number(sortOrderString),
      updatedBy: userId
    })
  );

  try {
    await updateJobOperationStepOrder(getDatabaseClient(), companyId, updates);
  } catch (err) {
    return data(
      {},
      await flash(request, error(err, "Failed to update sort order"))
    );
  }

  return { success: true };
}
