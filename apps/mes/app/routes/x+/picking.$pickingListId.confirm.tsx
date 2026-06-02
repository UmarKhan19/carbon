import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { confirmPickingListLine } from "~/services/picking.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {});
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();
  const pickingListLineId = formData.get("pickingListLineId") as string;
  const quantityPicked = Number(formData.get("quantityPicked") ?? 0);
  const trackedEntitiesRaw = formData.get("trackedEntities") as string | null;

  if (!pickingListLineId) {
    return { success: false, message: "Missing pickingListLineId" };
  }

  let trackedEntities:
    | Array<{ trackedEntityId: string; quantityPicked: number }>
    | undefined;

  if (trackedEntitiesRaw) {
    try {
      trackedEntities = JSON.parse(trackedEntitiesRaw);
    } catch {
      return { success: false, message: "Invalid trackedEntities JSON" };
    }
  }

  const result = await confirmPickingListLine(serviceRole, {
    pickingListLineId,
    quantityPicked,
    trackedEntities,
    userId
  });

  if (result.error) {
    return {
      success: false,
      message:
        typeof result.error === "string"
          ? result.error
          : (result.error.message ?? "Failed to confirm pick line")
    };
  }

  return { success: true, data: result.data };
}
