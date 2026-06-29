import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getChangeOrderValidations,
  notifyChangeOrderTransition,
  releaseChangeOrder
} from "~/modules/items/changeOrder.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "plm"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  // Re-run pre-release validations server-side. Errors block the release.
  const { errors } = await getChangeOrderValidations(client, id, companyId);
  if (errors.length > 0) {
    throw redirect(
      requestReferrer(request) ?? path.to.changeOrderDetails(id),
      await flash(
        request,
        error(null, `Cannot release change order: ${errors.join("; ")}`)
      )
    );
  }

  const db = getDatabaseClient();
  const result = await releaseChangeOrder(db, {
    changeOrderId: id,
    userId,
    companyId
  });

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.changeOrderDetails(id),
      await flash(
        request,
        error(result.error, result.error.message ?? "Failed to release")
      )
    );
  }

  // Notify reviewers + affected-item product managers that the CO released.
  // Best-effort — never blocks the redirect.
  await notifyChangeOrderTransition(client, {
    event: NotificationEvent.ChangeOrderReleased,
    changeOrderId: id,
    companyId,
    userId
  });

  throw redirect(
    requestReferrer(request) ?? path.to.changeOrderDetails(id),
    await flash(request, success("Released change order"))
  );
}
