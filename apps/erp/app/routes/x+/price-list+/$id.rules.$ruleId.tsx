import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { PriceListDetail } from "~/modules/pricing";
import {
  getPriceListRule,
  priceListRuleValidator,
  updatePriceListRule
} from "~/modules/pricing";
import { PriceListRuleForm } from "~/modules/pricing/ui/PriceListRules";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { update: "sales" });

  const { ruleId } = params;
  if (!ruleId) throw notFound("Rule ID not found");

  const { data: rule, error: ruleError } = await getPriceListRule(
    client,
    ruleId
  );
  if (ruleError || !rule) throw notFound("Rule not found");

  return { rule };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, ruleId } = params;
  if (!id || !ruleId) throw new Error("IDs not found");

  const formData = await request.formData();
  const validation = await validator(priceListRuleValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await updatePriceListRule(
    client,
    ruleId,
    userId,
    validation.data
  );

  if (result.error) {
    return redirect(
      path.to.priceListRules(id),
      await flash(request, error(result.error, "Failed to update rule"))
    );
  }

  return redirect(
    path.to.priceListRules(id),
    await flash(request, success("Rule updated"))
  );
}

export default function EditPriceListRuleRoute() {
  const { id } = useParams();
  const { rule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!id) throw new Error("Price list ID not found");

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(id)
  );

  return (
    <PriceListRuleForm
      initialValues={{
        id: rule.id,
        priceListId: rule.priceListId,
        name: rule.name,
        ruleType: rule.ruleType,
        amountType: rule.amountType,
        amount: rule.amount,
        minQuantity: rule.minQuantity ?? undefined,
        maxQuantity: rule.maxQuantity ?? undefined,
        customerTypeId: rule.customerTypeId ?? undefined,
        supplierTypeId: rule.supplierTypeId ?? undefined,
        itemId: rule.itemId ?? undefined,
        itemPostingGroupId: rule.itemPostingGroupId ?? undefined,
        active: rule.active
      }}
      priceListType={routeData?.priceList?.type}
      onClose={() => navigate(path.to.priceListRules(id))}
    />
  );
}
