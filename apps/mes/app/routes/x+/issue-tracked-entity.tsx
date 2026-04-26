import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { issueTrackedEntityValidator } from "~/services/models";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

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
    children,
    overrideExpired,
    overrideReason
  } = validation.data;

  const serviceRole = await getCarbonServiceRole();
  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      type: "trackedEntitiesToOperation",
      materialId,
      jobOperationId,
      itemId,
      parentTrackedEntityId,
      children,
      overrideExpired,
      overrideReason,
      companyId,
      userId
    }
  });

  if (issue.error) {
    console.error(issue.error);
    // Surface the edge-fn error message so the client can show the actual
    // reason (e.g. "Cannot consume expired tracked entity: <id>").
    const message =
      (issue.error as { message?: string })?.message ??
      "Failed to issue material";
    return data({ success: false, message }, { status: 400 });
  }

  const splitEntities = issue.data?.splitEntities || [];
  const warning = issue.data?.warning as string | undefined;

  return {
    success: true,
    message: "Material issued successfully",
    splitEntities,
    warning
  };
}
