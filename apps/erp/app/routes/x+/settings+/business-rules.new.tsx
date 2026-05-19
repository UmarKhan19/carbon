import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validator } from "@carbon/form";
import type { TargetType } from "@carbon/utils";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  businessRuleValidator,
  upsertBusinessRule
} from "~/modules/businessRules";
import BusinessRuleForm from "~/modules/businessRules/ui/BusinessRuleForm";
import { getParams, path } from "~/utils/path";
import { businessRulesQuery, getCompanyId } from "~/utils/react-query";

const isTargetType = (value: string | null): value is TargetType =>
  value === "item" || value === "storageUnit" || value === "workCenter";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "settings" });
  const url = new URL(request.url);
  const raw = url.searchParams.get("targetType");
  return { targetType: isTargetType(raw) ? raw : ("item" as TargetType) };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "settings"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "BUSINESS_RULES",
    redirectTo: path.to.businessRules
  });

  const formData = await request.formData();
  const validation = await validator(businessRuleValidator).validate(formData);
  if (validation.error) return validation.error;

  const insert = await upsertBusinessRule(client, {
    ...validation.data,
    description: validation.data.description ?? null,
    companyId,
    createdBy: userId
  });

  if (insert.error) {
    return await flash(
      request,
      error(insert.error, "Failed to create rule")
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

export default function NewBusinessRuleRoute() {
  const { targetType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  return (
    <BusinessRuleForm
      initialValues={{ targetType }}
      onClose={() => navigate(-1)}
    />
  );
}
