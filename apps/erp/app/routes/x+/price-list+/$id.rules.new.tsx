import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { PriceListDetail } from "~/modules/pricing";
import {
  createPriceListRule,
  getPriceListLockState,
  priceListRuleValidator
} from "~/modules/pricing";
import { PriceListRuleForm } from "~/modules/pricing/ui/PriceListRules";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { role: "employee" });
  const { id } = params;
  if (!id) throw new Error("Price list ID not found");
  const { isLocked } = await getPriceListLockState(client, id);
  if (isLocked) {
    throw new Error(
      "Price list is Active and cannot be modified. Create a new version first."
    );
  }
  await requirePermissions(request, {
    create: "sales"
  });
  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const { id } = params;
  if (!id) throw new Error("Price list ID not found");

  const { isLocked } = await getPriceListLockState(client, id);
  if (isLocked) {
    return {
      error: {
        message:
          "Price list is Active and cannot be modified. Create a new version first."
      },
      data: null
    };
  }
  await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(priceListRuleValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await createPriceListRule(client, companyId, userId, {
    ...validation.data,
    priceListId: id
  });

  if (result.error) {
    return redirect(
      path.to.priceListRules(id),
      await flash(request, error(result.error, "Failed to add rule"))
    );
  }

  return redirect(
    path.to.priceListRules(id),
    await flash(request, success("Rule added"))
  );
}

export default function NewPriceListRuleRoute() {
  const { id } = useParams();
  const navigate = useNavigate();

  if (!id) throw new Error("Price list ID not found");

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(id)
  );

  return (
    <PriceListRuleForm
      initialValues={{
        priceListId: id,
        name: "",
        ruleType: "Discount",
        amountType: "Percentage",
        amount: 0,
        active: true
      }}
      priceListType={routeData?.priceList?.type}
      onClose={() => navigate(path.to.priceListRules(id))}
    />
  );
}
