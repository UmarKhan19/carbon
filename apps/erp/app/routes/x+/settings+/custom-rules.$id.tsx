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
  customRuleValidator,
  getCustomRule,
  upsertCustomRule
} from "~/modules/customRules";
import CustomRuleForm from "~/modules/customRules/ui/CustomRuleForm";
import { getParams, path } from "~/utils/path";
import { customRulesQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { view: "settings" });
  const { id } = params;
  if (!id) throw notFound("id required");
  const rule = await getCustomRule(client, id);
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
    feature: "CUSTOM_RULES",
    redirectTo: path.to.customRules
  });

  const { id } = params;
  if (!id) throw new Error("id required");

  const formData = await request.formData();
  const validation = await validator(customRuleValidator).validate(formData);
  if (validation.error) return validation.error;

  const update = await upsertCustomRule(client, {
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

  throw redirect(`${path.to.customRules}?${getParams(request)}`);
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(
    customRulesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function EditCustomRuleRoute() {
  const { rule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  return (
    <CustomRuleForm
      initialValues={
        {
          ...((rule ?? {}) as Record<string, unknown>),
          conditionAst: (rule as { conditionAst: unknown })
            .conditionAst as unknown as ConditionAst
        } as never
      }
      onClose={() => navigate(path.to.customRules)}
    />
  );
}
