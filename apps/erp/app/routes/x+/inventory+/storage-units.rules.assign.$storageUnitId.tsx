import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { redirect } from "react-router";
import { assignBusinessRule } from "~/modules/businessRules";
import { path } from "~/utils/path";
import {
  businessRuleAssignmentsQuery,
  getCompanyId
} from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "BUSINESS_RULES",
    redirectTo: path.to.businessRules
  });

  const { storageUnitId } = params;
  if (!storageUnitId) throw new Error("storageUnitId required");

  const formData = await request.formData();
  const ruleId = String(formData.get("ruleId") ?? "");
  if (!ruleId) {
    throw redirect(
      request.headers.get("Referer") ?? path.to.businessRules,
      await flash(request, error(null, "Rule id required"))
    );
  }

  const result = await assignBusinessRule(client, {
    targetType: "storageUnit",
    targetId: storageUnitId,
    ruleId,
    companyId,
    userId
  });

  if (result.error) {
    throw redirect(
      request.headers.get("Referer") ?? path.to.businessRules,
      await flash(request, error(result.error, "Failed to assign rule"))
    );
  }

  throw redirect(
    request.headers.get("Referer") ?? path.to.businessRules,
    await flash(request, success("Rule assigned"))
  );
}

export async function clientAction({
  serverAction,
  params
}: ClientActionFunctionArgs) {
  const { storageUnitId } = params;
  if (storageUnitId) {
    window?.clientCache?.setQueryData(
      businessRuleAssignmentsQuery("storageUnit", storageUnitId, getCompanyId())
        .queryKey,
      null
    );
  }
  return await serverAction();
}
