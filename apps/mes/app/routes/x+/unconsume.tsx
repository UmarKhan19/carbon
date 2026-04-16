import { assertIsPost } from "@carbon/auth";
import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { issueTrackedEntityValidator } from "~/services/models";
import {
  getJobMaterialForCompany,
  getTrackedEntitiesForCompany
} from "~/services/operations.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requireActiveEmployee(request);

  const payload = await request.json();
  const validation = issueTrackedEntityValidator.safeParse(payload);

  if (!validation.success) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const { materialId, parentTrackedEntityId, children } = validation.data;

  const serviceRole = await getCarbonServiceRole();
  const [jobMaterial, trackedEntities] = await Promise.all([
    materialId
      ? getJobMaterialForCompany(serviceRole, materialId, companyId)
      : Promise.resolve({ data: null, error: null }),
    getTrackedEntitiesForCompany(
      serviceRole,
      [
        parentTrackedEntityId,
        ...children.map((child) => child.trackedEntityId)
      ],
      companyId
    )
  ]);

  if (
    (materialId && (jobMaterial.error || !jobMaterial.data)) ||
    trackedEntities.error ||
    trackedEntities.data.length !== children.length + 1
  ) {
    return data({ success: false, message: "Access denied" }, { status: 403 });
  }

  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      type: "unconsumeTrackedEntities",
      materialId: jobMaterial.data?.id,
      parentTrackedEntityId,
      children,
      companyId,
      userId
    },
    region: FunctionRegion.UsEast1
  });

  if (issue.error) {
    console.error(issue.error);
    return data(
      { success: false, message: "Failed to issue material" },
      { status: 400 }
    );
  }

  return { success: true, message: "Material unconsumed successfully" };
}
