import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  generateHTML,
  Spinner,
  VStack
} from "@carbon/react";
import { Suspense } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Await, redirect, useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ChangeOrderDetail, ChangeOrderItem } from "~/modules/items";
import {
  changeOrderValidator,
  getChangeOrder,
  getChangeOrderApprovalTasks,
  getChangeOrderReviewers,
  isChangeOrderLocked,
  updateChangeOrder
} from "~/modules/items";
import ChangeOrderApprovalTasks from "~/modules/items/ui/ChangeOrder/ChangeOrderApprovalTasks";
import ChangeOrderReviewers from "~/modules/items/ui/ChangeOrder/ChangeOrderReviewers";
import ValidationBanner from "~/modules/items/ui/ChangeOrder/ValidationBanner";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Details"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const changeOrder = await getChangeOrder(client, id, companyId);

  if (changeOrder.error) {
    throw new Error(changeOrder.error.message);
  }

  return {
    changeOrder: changeOrder.data,
    approvalTasks: getChangeOrderApprovalTasks(client, id, companyId),
    reviewers: getChangeOrderReviewers(client, id, companyId)
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const { client: viewClient, companyId } = await requirePermissions(request, {
    view: "parts"
  });
  const changeOrder = await getChangeOrder(viewClient, id, companyId);
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

const taskFallback = (
  <div className="flex min-h-[420px] w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
    <Spinner className="size-10" />
  </div>
);

export default function ChangeOrderDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { approvalTasks, reviewers } = useLoaderData<typeof loader>();

  const routeData = useRouteData<{
    changeOrder: ChangeOrderDetail;
    items: ChangeOrderItem[];
    validations: Promise<{ errors: string[]; warnings: string[] }>;
  }>(path.to.changeOrder(id));

  if (!routeData) throw new Error("Could not find change order data");

  const changeOrder = routeData.changeOrder;

  return (
    <VStack spacing={2}>
      <Suspense fallback={null}>
        <Await resolve={routeData.validations}>
          {(resolved) => (
            <ValidationBanner
              errors={resolved?.errors ?? []}
              warnings={resolved?.warnings ?? []}
            />
          )}
        </Await>
      </Suspense>

      {(() => {
        // description is a JSON column: a TipTap doc (object with `type`),
        // a plain string (from the TextArea form), or empty. generateHTML
        // throws ("type" in <string>) on a bare string, so branch on shape.
        const d = changeOrder?.description as unknown;
        const body =
          d && typeof d === "object" && "type" in d ? (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(d as JSONContent)
              }}
            />
          ) : typeof d === "string" && d.trim() ? (
            <p className="text-sm whitespace-pre-wrap">{d}</p>
          ) : null;
        // No description → don't render an empty Description card at all.
        if (!body) return null;
        return (
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>{body}</CardContent>
          </Card>
        );
      })()}

      <Suspense fallback={taskFallback}>
        <Await resolve={approvalTasks}>
          {(resolved) => (
            <ChangeOrderApprovalTasks tasks={resolved?.data ?? []} />
          )}
        </Await>
      </Suspense>

      <Suspense fallback={taskFallback}>
        <Await resolve={reviewers}>
          {(resolved) => (
            <ChangeOrderReviewers reviewers={resolved?.data ?? []} />
          )}
        </Await>
      </Suspense>
    </VStack>
  );
}
