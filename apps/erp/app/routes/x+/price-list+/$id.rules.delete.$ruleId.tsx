import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deletePriceListRule, getPriceListLockState } from "~/modules/pricing";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { role: "employee" });
  if (!params.ruleId) throw notFound("Rule ID not found");
  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, { role: "employee" });

  const { id, ruleId } = params;
  if (!id || !ruleId) throw new Error("IDs not found");

  const { type: plType, isLocked } = await getPriceListLockState(client, id);
  if (isLocked) {
    throw redirect(
      path.to.priceListRules(id),
      await flash(
        request,
        error(
          null,
          "Price list is Active. Create a new version before deleting rules."
        )
      )
    );
  }
  await requirePermissions(request, {
    delete: plType === "Purchase" ? "purchasing" : "sales"
  });

  const { error: deleteError } = await deletePriceListRule(client, ruleId);
  if (deleteError) {
    throw redirect(
      path.to.priceListRules(id),
      await flash(request, error(deleteError, "Failed to delete rule"))
    );
  }

  throw redirect(
    path.to.priceListRules(id),
    await flash(request, success("Rule deleted"))
  );
}

export default function DeletePriceListRuleRoute() {
  const { id, ruleId } = useParams();
  const navigate = useNavigate();

  if (!id || !ruleId) return null;

  return (
    <ConfirmDelete
      action={`${path.to.priceListRules(id)}/delete/${ruleId}`}
      name="Pricing Rule"
      text="Are you sure you want to delete this pricing rule?"
      onCancel={() => navigate(path.to.priceListRules(id))}
    />
  );
}
