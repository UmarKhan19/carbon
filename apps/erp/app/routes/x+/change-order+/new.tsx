import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { useUrlParams } from "~/hooks";
import {
  changeOrderCreateValidator,
  getChangeOrderWorkflowsList,
  insertChangeOrder
} from "~/modules/items";
import ChangeOrderForm from "~/modules/items/ui/ChangeOrder/ChangeOrderForm";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Change Orders`,
  to: path.to.changeOrders
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const workflows = await getChangeOrderWorkflowsList(client, companyId);

  const url = new URL(request.url);
  const sourceType = url.searchParams.get("sourceType");
  const sourceId = url.searchParams.get("sourceId");
  const name = url.searchParams.get("name");

  return {
    workflows: workflows.data ?? [],
    sourceType,
    sourceId,
    name
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const serviceRole = await getCarbonServiceRole();

  const formData = await request.formData();
  const validation = await validator(changeOrderCreateValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const d = validation.data;

  const createResult = await insertChangeOrder(serviceRole, {
    changeOrderId: d.changeOrderId || undefined,
    name: d.name,
    type: d.type,
    approvalType: d.approvalType,
    priority: d.priority,
    openDate: d.openDate,
    description: d.description,
    changeOrderWorkflowId: d.changeOrderWorkflowId,
    dueDate: d.dueDate,
    effectiveDate: d.effectiveDate,
    approvers: d.approvers,
    sourceType: d.sourceType,
    sourceId: d.sourceId,
    assignee: d.assignee,
    items: d.items,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createResult.error || !createResult.data) {
    throw redirect(
      path.to.changeOrders,
      await flash(
        request,
        error(createResult.error, "Failed to insert change order")
      )
    );
  }

  // Creation is not a single transaction (a pending revision is staged via an
  // edge function mid-chain), so per-item / reviewer / action-task seeding
  // failures come back as warnings. Surface them rather than swallowing.
  if (createResult.warnings.length > 0) {
    throw redirect(
      path.to.changeOrder(createResult.data.id),
      await flash(
        request,
        success(
          `Change order created with warnings: ${createResult.warnings.join(
            "; "
          )}`
        )
      )
    );
  }

  throw redirect(path.to.changeOrder(createResult.data.id));
}

export default function ChangeOrderNewRoute() {
  const { workflows, sourceType, sourceId, name } =
    useLoaderData<typeof loader>();

  const [params] = useUrlParams();
  const itemId = params.get("itemId");

  const initialValues = {
    id: undefined,
    changeOrderId: undefined,
    name: name ?? "",
    type: "Engineering" as const,
    approvalType: "Unanimous" as const,
    priority: "Medium" as const,
    changeOrderWorkflowId: "",
    openDate: today(getLocalTimeZone()).toString(),
    dueDate: "",
    effectiveDate: "",
    approvers: [] as string[],
    sourceType: sourceType ?? "",
    sourceId: sourceId ?? "",
    assignee: "",
    items: itemId ? [itemId] : []
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <ChangeOrderForm
        initialValues={initialValues}
        changeOrderWorkflows={workflows}
      />
    </div>
  );
}
