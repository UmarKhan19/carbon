import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validator } from "@carbon/form";
import type { ConditionAst } from "@carbon/utils";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  businessRuleValidator,
  getBusinessRule,
  upsertBusinessRule
} from "~/modules/businessRules";
import BusinessRuleForm from "~/modules/businessRules/ui/BusinessRuleForm";
import { getParams, path } from "~/utils/path";
import { businessRulesQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { view: "settings" });
  const { id } = params;
  if (!id) throw notFound("id required");
  const rule = await getBusinessRule(client, id);
  if (rule.error || !rule.data) throw notFound("Rule not found");
  return { rule: rule.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "BUSINESS_RULES",
    redirectTo: path.to.businessRules
  });

  const { id } = params;
  if (!id) throw new Error("id required");

  const formData = await request.formData();
  const validation = await validator(businessRuleValidator).validate(formData);
  if (validation.error) return validation.error;

  const update = await upsertBusinessRule(client, {
    ...validation.data,
    id,
    description: validation.data.description ?? null,
    updatedBy: userId
  });

  if (update.error) {
    return await flash(
      request,
      error(update.error, "Failed to update rule")
    ).then(() => null);
  }

  throw redirect(`${path.to.businessRules}?${getParams(request)}`);
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(
    businessRulesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function EditBusinessRuleRoute() {
  const { rule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  return (
    <BusinessRuleForm
      initialValues={{
        ...(rule as never),
        conditionAst: rule.conditionAst as unknown as ConditionAst
      }}
      onClose={() => navigate(-1)}
    />
  );
}
