import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { ScrollArea } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import {
  changeOrderWorkflowValidator,
  getChangeOrderWorkflow,
  parseChangeOrderWorkflowContent,
  upsertChangeOrderWorkflow
} from "~/modules/items";
import { ChangeOrderWorkflowForm } from "~/modules/items/ui/ChangeOrderWorkflow";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Workflows`,
  to: path.to.changeOrderWorkflows,
  module: "items"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "plm",
    role: "employee",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const workflow = await getChangeOrderWorkflow(client, id);

  if (workflow.error) {
    throw redirect(
      path.to.changeOrderWorkflows,
      await flash(
        request,
        error(workflow.error, "Failed to load change order workflow")
      )
    );
  }

  return {
    workflow: workflow.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "plm"
  });
  const formData = await request.formData();
  const validation = await validator(changeOrderWorkflowValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const { name, priority, approvalType, approvers } = validation.data;

  const update = await upsertChangeOrderWorkflow(client, {
    id,
    name,
    content: {
      priority: priority ?? null,
      approvalType,
      approvers: approvers ?? []
    },
    updatedBy: userId
  });

  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update change order workflow")
      )
    );
  }

  return data(
    {},
    await flash(request, success("Change order workflow updated"))
  );
}

export default function ChangeOrderWorkflowRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { workflow } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => {
    navigate(path.to.changeOrderWorkflows);
  };

  const content = parseChangeOrderWorkflowContent(workflow?.content);

  const initialValues = {
    id: workflow?.id,
    name: workflow?.name ?? "",
    priority: (content.priority ?? "Medium") as "Medium",
    approvalType: (content.approvalType ?? "Unanimous") as "Unanimous",
    approvers: content.approvers ?? []
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)] bg-card">
      <ChangeOrderWorkflowForm initialValues={initialValues} onClose={onClose} />
    </ScrollArea>
  );
}
