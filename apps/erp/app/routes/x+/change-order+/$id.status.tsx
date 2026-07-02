import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  changeOrderStatus,
  getChangeOrder,
  updateChangeOrderStatus
} from "~/modules/items";
import { notifyChangeOrderTransition } from "~/modules/items/changeOrder.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "parts"
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

  // Approved is reachable ONLY by crossing the reviewer approval threshold
  // (reevaluateChangeOrderApproval, from the decision / task-completion paths).
  // The DAG lists In Review → Approved so that internal auto-advance can use
  // this same writer, but a human must not flip Approved directly here — that
  // would skip every reviewer sign-off.
  if (status === "Approved") {
    throw redirect(
      requestReferrer(request) ?? path.to.changeOrderDetails(id),
      await flash(
        request,
        error(null, "A change order is approved through reviewer sign-off.")
      )
    );
  }

  // Read the current status to feed the service compare-and-swap; the DAG guard
  // and the zero-reviewer precondition live inside updateChangeOrderStatus, so
  // this route stays thin (parse → service → flash/notify).
  const current = await getChangeOrder(client, id, companyId);
  if (current.error || !current.data) {
    throw redirect(
      requestReferrer(request) ?? path.to.changeOrderDetails(id),
      await flash(request, error(current.error, "Change order not found"))
    );
  }

  const update = await updateChangeOrderStatus(client, {
    id,
    companyId,
    fromStatus: current.data.status,
    toStatus: status,
    // Release is unreachable via this generic route (the DAG excludes
    // Approved → Released), so Cancelled is the only terminal status that lands
    // here and should clear the assignee.
    assignee: status === "Cancelled" ? null : undefined,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.changeOrderDetails(id),
      await flash(request, error(update.error, update.error.message))
    );
  }

  // Draft → In Review is the one notify-worthy transition this generic route
  // handles (submitted for review). Approval notifies from the reviewer paths;
  // release from the release route. Best-effort — never blocks the redirect.
  if (status === "In Review") {
    await notifyChangeOrderTransition(client, {
      event: NotificationEvent.ChangeOrderSubmittedForReview,
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
