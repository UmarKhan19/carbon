import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  changeOrderValidator,
  getChangeOrder,
  getChangeOrderTypesList,
  isChangeOrderLocked,
  updateChangeOrder
} from "~/modules/items";
import ChangeOrderForm from "~/modules/items/ui/ChangeOrder/ChangeOrderForm";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Details`
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [changeOrder, changeOrderTypes] = await Promise.all([
    getChangeOrder(client, id, companyId),
    getChangeOrderTypesList(client, companyId)
  ]);

  if (changeOrder.error) {
    throw new Error(changeOrder.error.message);
  }

  return {
    changeOrder: changeOrder.data,
    changeOrderTypes: changeOrderTypes.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const changeOrder = await getChangeOrder(client, id, companyId);
  await requireUnlocked({
    request,
    isLocked: isChangeOrderLocked(changeOrder.data?.status),
    redirectTo: path.to.changeOrder(id),
    message: "Cannot modify a released or cancelled change order."
  });

  const formData = await request.formData();
  const validation = await validator(changeOrderValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const d = validation.data;

  const result = await updateChangeOrder(client, {
    id,
    name: d.name,
    type: d.type,
    approvalType: d.approvalType,
    priority: d.priority,
    changeOrderTypeId: d.changeOrderTypeId || null,
    changeOrderWorkflowId: d.changeOrderWorkflowId || null,
    openDate: d.openDate,
    dueDate: d.dueDate || null,
    effectiveDate: d.effectiveDate || null,
    description: d.description || "",
    approvalRequirements: d.approvalRequirements,
    sourceType: d.sourceType || null,
    sourceId: d.sourceId || null,
    assignee: d.assignee || null,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (result.error) {
    throw redirect(
      path.to.changeOrder(id),
      await flash(request, error(result.error, "Failed to update change order"))
    );
  }

  throw redirect(
    path.to.changeOrder(id),
    await flash(request, success("Updated change order"))
  );
}

export default function ChangeOrderDetailsRoute() {
  const { changeOrder, changeOrderTypes } = useLoaderData<typeof loader>();

  const description = changeOrder?.description;

  const initialValues = {
    id: changeOrder?.id,
    changeOrderId: changeOrder?.changeOrderId ?? undefined,
    name: changeOrder?.name ?? "",
    description: typeof description === "string" ? description : "",
    type: changeOrder?.type ?? "Engineering",
    priority: changeOrder?.priority ?? undefined,
    approvalType: changeOrder?.approvalType ?? "Unanimous",
    changeOrderTypeId: changeOrder?.changeOrderTypeId ?? "",
    changeOrderWorkflowId: changeOrder?.changeOrderWorkflowId ?? "",
    openDate: changeOrder?.openDate ?? "",
    dueDate: changeOrder?.dueDate ?? "",
    effectiveDate: changeOrder?.effectiveDate ?? "",
    sourceType: changeOrder?.sourceType ?? "",
    sourceId: changeOrder?.sourceId ?? "",
    assignee: changeOrder?.assignee ?? "",
    items: [] as string[]
  };

  return (
    <ChangeOrderForm
      key={changeOrder?.id}
      initialValues={initialValues}
      changeOrderTypes={changeOrderTypes}
    />
  );
}
