import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { extractEdgeError, postInternalAlert } from "@carbon/lib/alerts.server";
import type { ActionFunctionArgs } from "react-router";
import { runMRP } from "~/modules/production/production.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const url = new URL(request.url);
  const locationId = url.searchParams.get("location");

  const { companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const result = await runMRP(getCarbonServiceRole(), {
    type: locationId ? "location" : "company",
    id: locationId ?? companyId,
    companyId,
    userId
  });

  if (result.error) {
    const edgeError = await extractEdgeError(result.error);
    void postInternalAlert({
      source: "api:/api/mrp",
      error: edgeError,
      context: {
        companyId,
        userId,
        locationId: locationId ?? undefined,
        type: locationId ? "location" : "company"
      }
    });
  }

  return result;
}
