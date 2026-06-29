import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { ScrollArea } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import {
  changeOrderWorkflowValidator,
  upsertChangeOrderWorkflow
} from "~/modules/items";
import { ChangeOrderWorkflowForm } from "~/modules/items/ui/ChangeOrderWorkflow";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "plm"
  });
  const formData = await request.formData();
  const validation = await validator(changeOrderWorkflowValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { name, priority, approvalType, approvers } = validation.data;

  const insert = await upsertChangeOrderWorkflow(client, {
    name,
    content: {
      priority: priority ?? null,
      approvalType,
      approvers: approvers ?? []
    },
    companyId,
    createdBy: userId
  });

  if (insert.error || !insert.data?.id) {
    return data(
      {},
      await flash(
        request,
        error(insert.error, "Failed to insert change order workflow")
      )
    );
  }

  throw redirect(
    path.to.changeOrderWorkflow(insert.data.id),
    await flash(request, success("Change order workflow created"))
  );
}

export default function NewChangeOrderWorkflowRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    priority: "Medium" as const,
    approvalType: "Unanimous" as const,
    approvers: [] as string[]
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)] bg-card">
      <ChangeOrderWorkflowForm
        initialValues={initialValues}
        onClose={() => navigate(-1)}
      />
    </ScrollArea>
  );
}
