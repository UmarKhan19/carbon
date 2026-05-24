import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { redirect } from "react-router";
import { unassignCustomRule } from "~/modules/customRules";
import { path } from "~/utils/path";
import { customRuleAssignmentsQuery, getCompanyId } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "inventory"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "CUSTOM_RULES",
    redirectTo: path.to.customRules
  });

  const { storageUnitId, ruleId } = params;
  if (!storageUnitId || !ruleId)
    throw new Error("storageUnitId and ruleId required");

  const result = await unassignCustomRule(client, {
    targetType: "storageUnit",
    targetId: storageUnitId,
    ruleId
  });
  if (result.error) {
    throw redirect(
      request.headers.get("Referer") ?? path.to.customRules,
      await flash(request, error(result.error, "Failed to unassign rule"))
    );
  }

  throw redirect(
    request.headers.get("Referer") ?? path.to.customRules,
    await flash(request, success("Rule unassigned"))
  );
}

export async function clientAction({
  serverAction,
  params
}: ClientActionFunctionArgs) {
  const { storageUnitId } = params;
  if (storageUnitId) {
    window?.clientCache?.setQueryData(
      customRuleAssignmentsQuery("storageUnit", storageUnitId, getCompanyId())
        .queryKey,
      null
    );
  }
  return await serverAction();
}
