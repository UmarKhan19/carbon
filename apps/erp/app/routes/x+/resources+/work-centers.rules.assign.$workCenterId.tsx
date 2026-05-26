import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { redirect } from "react-router";
import { assignCustomRule } from "~/modules/customRules";
import { path } from "~/utils/path";
import { customRuleAssignmentsQuery, getCompanyId } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "CUSTOM_RULES",
    redirectTo: path.to.customRules
  });

  const { workCenterId } = params;
  if (!workCenterId) throw new Error("workCenterId required");

  const formData = await request.formData();
  const ruleId = String(formData.get("ruleId") ?? "");
  if (!ruleId) {
    throw redirect(
      request.headers.get("Referer") ?? path.to.customRules,
      await flash(request, error(null, "Rule id required"))
    );
  }

  const result = await assignCustomRule(client, {
    targetType: "workCenter",
    targetId: workCenterId,
    ruleId,
    companyId,
    userId
  });

  if (result.error) {
    throw redirect(
      request.headers.get("Referer") ?? path.to.customRules,
      await flash(request, error(result.error, "Failed to assign rule"))
    );
  }

  throw redirect(
    request.headers.get("Referer") ?? path.to.customRules,
    await flash(request, success("Rule assigned"))
  );
}

export async function clientAction({
  serverAction,
  params
}: ClientActionFunctionArgs) {
  const { workCenterId } = params;
  if (workCenterId) {
    window?.clientCache?.setQueryData(
      customRuleAssignmentsQuery("workCenter", workCenterId, getCompanyId())
        .queryKey,
      null
    );
  }
  return await serverAction();
}
