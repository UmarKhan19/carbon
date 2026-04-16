import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  getJobMaterialForCompany,
  getTrackedEntityForCompany
} from "~/services/operations.service";

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId, userId } = await requireActiveEmployee(request);

  const { trackedEntityId, materialId } = params;
  if (!materialId) throw new Error("Could not find materialId");
  if (!trackedEntityId) throw new Error("Could not find trackedEntityId");

  // Get optional parentId from query params
  const url = new URL(request.url);
  const parentTrackedEntityId = url.searchParams.get("parentId") || undefined;

  const serviceRole = await getCarbonServiceRole();
  const [trackedEntity, jobMaterial, parentTrackedEntity] = await Promise.all([
    getTrackedEntityForCompany(serviceRole, trackedEntityId, companyId),
    getJobMaterialForCompany(serviceRole, materialId, companyId),
    parentTrackedEntityId
      ? getTrackedEntityForCompany(
          serviceRole,
          parentTrackedEntityId,
          companyId
        )
      : Promise.resolve({ data: null, error: null })
  ]);

  if (
    trackedEntity.error ||
    !trackedEntity.data ||
    jobMaterial.error ||
    !jobMaterial.data
  ) {
    return data({ success: false, message: "Access denied" }, { status: 403 });
  }

  if (
    parentTrackedEntityId &&
    (parentTrackedEntity.error || !parentTrackedEntity.data)
  ) {
    return data({ success: false, message: "Access denied" }, { status: 403 });
  }

  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      trackedEntityId: trackedEntity.data.id,
      materialId: jobMaterial.data.id,
      parentTrackedEntityId: parentTrackedEntity.data?.id,
      type: "scrapTrackedEntity",
      companyId,
      userId
    },
    region: FunctionRegion.UsEast1
  });

  if (issue.error) {
    return data(
      { success: false, message: "Failed to scrape entity" },
      { status: 400 }
    );
  }

  return { success: true, message: "Entity scraped successfully" };
}
