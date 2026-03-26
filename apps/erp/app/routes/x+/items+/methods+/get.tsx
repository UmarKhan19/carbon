import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { copyItem, getMethodValidator } from "~/modules/items";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const serviceRole = getCarbonServiceRole();

  const validation = await validator(getMethodValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const upsert = await copyItem(serviceRole, {
    ...validation.data,
    companyId,
    userId
  });

  if (upsert.error) {
    return {
      error: upsert.error ? "Failed to get method" : null
    };
  }

  throw redirect(requestReferrer(request) ?? path.to.items);
}
