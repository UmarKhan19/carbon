import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  changeOrderStatus,
  getChangeOrder,
  isAllowedChangeOrderTransition,
  updateChangeOrderStatus
} from "~/modules/items";
import { notifyChangeOrderTransition } from "~/modules/items/changeOrder.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "plm"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get("status") as (typeof changeOrderStatus)[number];

  if (!status || !changeOrderStatus.includes(status)) {
    throw redirect(
      requestReferrer(request) ?? path.to.changeOrderDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  // Server-side transition guard — reject any status change the DAG disallows.
  const current = await getChangeOrder(client, id, companyId);
  if (
    !current.data ||
    !isAllowedChangeOrderTransition(current.data.status, status)
  ) {
    throw redirect(
      requestReferrer(request) ?? path.to.changeOrderDetails(id),
      await flash(
        request,
        error(
          null,
          `Cannot move change order from ${
            current.data?.status ?? "unknown"
          } to ${status}`
        )
      )
    );
  }

  // A CO submitted with zero reviewers can never auto-advance (the threshold is
  // unsatisfiable) and the decision modal has no row to act on — it would be
  // stuck In Review forever. Block the Draft → In Review submit until at least
  // one reviewer exists.
  if (status === "In Review") {
    const reviewers = await client
      .from("changeOrderReviewer")
      .select("id", { count: "exact", head: true })
      .eq("changeOrderId", id)
      .eq("companyId", companyId);
    if ((reviewers.count ?? 0) === 0) {
      throw redirect(
        requestReferrer(request) ?? path.to.changeOrderDetails(id),
        await flash(
          request,
          error(
            null,
            "Add at least one approver before submitting for review"
          )
        )
      );
    }
  }

  const update = await updateChangeOrderStatus(client, {
    id,
    status,
    // Release is unreachable via this generic route (the DAG excludes
    // Approved → Released), so Cancelled is the only terminal status that lands
    // here and should clear the assignee.
    assignee: status === "Cancelled" ? null : undefined,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.changeOrderDetails(id),
      await flash(
        request,
        error(update.error, "Failed to update change order status")
      )
    );
  }

  // Notify on the real transition commit points. Draft → In Review means the
  // CO was submitted for review; a manual In Review → Approved means it was
  // approved. (Auto-advance to Approved via the decision/task routes notifies
  // there.) Best-effort — never blocks the redirect.
  if (status === "In Review") {
    await notifyChangeOrderTransition(client, {
      event: NotificationEvent.ChangeOrderSubmittedForReview,
      changeOrderId: id,
      companyId,
      userId
    });
  } else if (status === "Approved") {
    await notifyChangeOrderTransition(client, {
      event: NotificationEvent.ChangeOrderApproved,
      changeOrderId: id,
      companyId,
      userId
    });
  }

  throw redirect(
    requestReferrer(request) ?? path.to.changeOrderDetails(id),
    await flash(request, success("Updated change order status"))
  );
}
