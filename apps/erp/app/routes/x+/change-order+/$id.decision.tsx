import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  applyChangeOrderReviewerDecision,
  changeOrderDecisionValidator
} from "~/modules/items";
import {
  notifyChangeOrderTransition,
  notifyIfAutoAdvanced
} from "~/modules/items/changeOrder.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(changeOrderDecisionValidator).validate(
    formData
  );

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Invalid decision"))
    );
  }

  const result = await applyChangeOrderReviewerDecision(client, {
    changeOrderId: id,
    userId,
    companyId,
    decision: validation.data.decision,
    reason: validation.data.reason
  });

  if (result.error || !result.data) {
    return data(
      { success: false },
      await flash(
        request,
        error(
          result.error,
          result.error?.message ?? "Failed to record decision"
        )
      )
    );
  }

  // Notify on the real transition commit point. A reject sent the CO back to
  // Draft; an approval that crossed the threshold auto-advanced it to Approved.
  // Best-effort — never blocks the response.
  if (validation.data.decision === "reject") {
    await notifyChangeOrderTransition(client, {
      event: NotificationEvent.ChangeOrderRejected,
      changeOrderId: id,
      companyId,
      userId
    });
  } else {
    await notifyIfAutoAdvanced(client, result, {
      changeOrderId: id,
      companyId,
      userId
    });
  }

  const message =
    validation.data.decision === "reject"
      ? "Change order rejected and returned to Draft"
      : result.data.autoAdvanced
        ? "Change order approved"
        : "Your approval was recorded";

  return data({ success: true }, await flash(request, success(message)));
}
