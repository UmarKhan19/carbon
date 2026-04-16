import { assertIsPost } from "@carbon/auth";
import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { issueTrackedEntityValidator } from "~/services/models";
import {
  getJobOperationForCompany,
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

  const {
    materialId,
    jobOperationId,
    itemId,
    parentTrackedEntityId,
    children
  } = validation.data;

  const serviceRole = await getCarbonServiceRole();
  const authorizedOperation = jobOperationId
    ? await getJobOperationForCompany(serviceRole, jobOperationId, companyId)
    : { data: null, error: null };

  if (
    jobOperationId &&
    (authorizedOperation.error || !authorizedOperation.data)
  ) {
    return data({ success: false, message: "Access denied" }, { status: 403 });
  }

  const trackedEntityIds = [
    parentTrackedEntityId,
    ...children.map((child) => child.trackedEntityId)
  ];
  const trackedEntities = await getTrackedEntitiesForCompany(
    serviceRole,
    trackedEntityIds,
    companyId
  );

  if (
    trackedEntities.error ||
    trackedEntities.data.length !== trackedEntityIds.length
  ) {
    return data({ success: false, message: "Access denied" }, { status: 403 });
  }

  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      type: "trackedEntitiesToOperation",
      materialId,
      jobOperationId: authorizedOperation.data?.id,
      itemId,
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

  const splitEntities = issue.data?.splitEntities || [];

  return {
    success: true,
    message: "Material issued successfully",
    splitEntities
  };
}
