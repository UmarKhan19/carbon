import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
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
    create: "parts"
  });
  const formData = await request.formData();
  const modal = formData.get("type") === "modal";
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
    return modal
      ? data({ error: insert.error?.message ?? "Failed to create template" })
      : data(
          {},
          await flash(request, error(insert.error, "Failed to insert template"))
        );
  }

  return modal
    ? data({ id: insert.data.id, name }, { status: 201 })
    : redirect(
        path.to.changeOrderWorkflow(insert.data.id),
        await flash(request, success("Template created"))
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
    <ChangeOrderWorkflowForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
