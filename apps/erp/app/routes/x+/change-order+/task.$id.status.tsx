import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import type { ChangeOrderTaskStatusEnum } from "~/modules/items";
import {
  changeOrderTaskStatus,
  getChangeOrder,
  reevaluateChangeOrderApproval,
  updateChangeOrderTaskStatus
} from "~/modules/items";
import { notifyIfAutoAdvanced } from "~/modules/items/changeOrder.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "parts"
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

  // Reject an unknown status up front so a crafted POST can't reach the DB with
  // a value outside the enum.
  if (!changeOrderTaskStatus.includes(status)) {
    return data(
      {},
      await flash(request, error("Invalid status", "Invalid task status"))
    );
  }

  // Reviewer and approval rows are owned by their assignee. This generic route
  // would otherwise let any update:parts user complete (and, for reviewers,
  // auto-advance) a sign-off they don't own. Gate ownership server-side: the
  // caller must be the assigned owner, the client-supplied assignee is ignored
  // (no reassignment), and a reviewer completion is only allowed while the CO
  // is In Review.
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
  } else {
    // Approval task: only its assignee may change it (an unassigned task stays
    // open to any update:parts user). Prevents completing/spoofing someone
    // else's approval-task sign-off.
    const task = await client
      .from("changeOrderApprovalTask")
      .select("assignee")
      .eq("id", id)
      .eq("companyId", companyId)
      .single();
    if (task.error || !task.data) {
      return data(
        {},
        await flash(request, error(task.error, "Approval task not found"))
      );
    }
    if (task.data.assignee && task.data.assignee !== userId) {
      return data(
        {},
        await flash(
          request,
          error("Forbidden", "You are not the assigned approver")
        )
      );
    }
  }

  const update = await updateChangeOrderTaskStatus(client, {
    id,
    companyId,
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

  // A reviewer can also sign off (or withdraw a sign-off) via this generic task
  // route, not only the dedicated decision route. Centralize the threshold
  // re-evaluation: run it on ANY reviewer-row status change, so a completion can
  // advance In Review → Approved AND a reopen/skip can downgrade Approved → In
  // Review when the set no longer meets the bar. Best-effort — never blocks the
  // response.
  if (type === "review" && update.data?.changeOrderId) {
    const changeOrderId = update.data.changeOrderId;
    const reeval = await reevaluateChangeOrderApproval(
      client,
      changeOrderId,
      userId,
      companyId
    );
    await notifyIfAutoAdvanced(client, reeval, {
      changeOrderId,
      companyId,
      userId
    });
  }

  return {};
}
