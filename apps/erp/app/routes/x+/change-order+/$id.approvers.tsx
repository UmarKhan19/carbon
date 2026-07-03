import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import {
  getChangeOrder,
  reevaluateChangeOrderApproval,
  updateChangeOrderReviewers
} from "~/modules/items";
import { notifyIfAutoAdvanced } from "~/modules/items/changeOrder.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const changeOrder = await getChangeOrder(client, id, companyId);
  if (changeOrder.error || !changeOrder.data) {
    return { error: { message: "Change order not found" }, data: null };
  }

  // Reviewers are only editable before release; changing them after Approved/
  // Released/Cancelled would rewrite a settled approval trail.
  if (
    changeOrder.data.status !== "Draft" &&
    changeOrder.data.status !== "In Review"
  ) {
    return {
      error: {
        message:
          "Reviewers can only be changed while the change order is a draft or in review."
      },
      data: null
    };
  }

  const formData = await request.formData();
  const approvers = formData.getAll("approvers").map(String);

  const update = await updateChangeOrderReviewers(client, {
    changeOrderId: id,
    companyId,
    approvers,
    userId
  });
  if (update.error) {
    return { error: update.error, data: null };
  }

  // Adding/removing a reviewer can complete or un-complete approval while the CO
  // is In Review — re-derive the status and fire the Approved notification once
  // if it auto-advanced.
  const reeval = await reevaluateChangeOrderApproval(
    client,
    id,
    userId,
    companyId
  );
  await notifyIfAutoAdvanced(client, reeval, {
    changeOrderId: id,
    companyId,
    userId
  });

  return { data: null, error: null };
}
