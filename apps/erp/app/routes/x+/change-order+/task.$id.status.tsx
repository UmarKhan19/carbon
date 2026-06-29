import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import type { ChangeOrderTaskStatusEnum } from "~/modules/items";
import {
  getChangeOrder,
  reevaluateChangeOrderApproval,
  updateChangeOrderTaskStatus
} from "~/modules/items";
import { notifyChangeOrderTransition } from "~/modules/items/changeOrder.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;
  if (id !== params.id) {
    return data(
      {},
      await flash(request, error("Invalid task ID", "Invalid task ID"))
    );
  }
  const status = formData.get("status") as ChangeOrderTaskStatusEnum;
  const type = formData.get("type") as "approval" | "review";
  const assignee = formData.get("assignee") as string;

  // Reviewer rows are owned by their assignee. This generic route would
  // otherwise let any update:plm user complete (and thereby auto-advance) a
  // sign-off they don't own. Gate review rows server-side: the caller must be
  // the assigned reviewer, the client-supplied assignee is ignored (no
  // reassignment), and a completion is only allowed while the CO is In Review.
  if (type === "review") {
    const reviewer = await client
      .from("changeOrderReviewer")
      .select("assignee, changeOrderId")
      .eq("id", id)
      .eq("companyId", companyId)
      .single();
    if (reviewer.error || !reviewer.data) {
      return data(
        {},
        await flash(request, error(reviewer.error, "Reviewer not found"))
      );
    }
    if (reviewer.data.assignee !== userId) {
      return data(
        {},
        await flash(
          request,
          error("Forbidden", "You are not the assigned reviewer")
        )
      );
    }
    if (status === "Completed") {
      const co = await getChangeOrder(
        client,
        reviewer.data.changeOrderId,
        companyId
      );
      if (co.error || !co.data || co.data.status !== "In Review") {
        return data(
          {},
          await flash(
            request,
            error("Invalid status", "Change order is not in review")
          )
        );
      }
    }
  }

  const update = await updateChangeOrderTaskStatus(client, {
    id,
    status,
    type,
    // Never honor a client-supplied assignee on a review row.
    assignee: type === "review" ? undefined : assignee,
    userId
  });
  if (update.error) {
    return data(
      {},
      await flash(request, error(update.error, "Failed to update status"))
    );
  }

  // A reviewer can also sign off via this generic task route (not only the
  // dedicated decision route). Centralize the auto-advance: re-evaluate the
  // peer-review threshold whenever a reviewer row reaches Completed, so any
  // reviewer completion can advance the CO to Approved regardless of entry
  // point. Best-effort — never blocks the response.
  if (
    type === "review" &&
    status === "Completed" &&
    update.data?.changeOrderId
  ) {
    const changeOrderId = update.data.changeOrderId;
    const reeval = await reevaluateChangeOrderApproval(
      client,
      changeOrderId,
      userId,
      companyId
    );
    if (reeval.data?.autoAdvanced && reeval.data.status === "Approved") {
      await notifyChangeOrderTransition(client, {
        event: NotificationEvent.ChangeOrderApproved,
        changeOrderId,
        companyId,
        userId
      });
    }
  }

  return {};
}
