import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getItemIdForMakeMethod,
  getRevisionLock,
  LOCKED_REVISION_MESSAGE
} from "~/modules/items/items.server";
import { activateMethodVersion } from "~/modules/items/items.service";
import { requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const serviceRole = getCarbonServiceRole();

  const url = new URL(request.url);
  const methodToReplace = url.searchParams.get("methodToReplace");

  const { id } = params;
  if (!id) {
    return { success: false, message: "Invalid operation tool id" };
  }

  // Release-lock gate: activating a make-method version switches the live BOM/BOP
  // for the item. The route `id` is the makeMethod (version) id being activated
  // (the convert fn treats it as makeMethodId), so resolve its parent item.
  // enforce -> block; warn -> proceed + flash; off -> no-op. A null itemId
  // (cannot resolve) leaves the lock unlocked, so the gate is safely skipped.
  const lockItemId = await getItemIdForMakeMethod(serviceRole, id);
  const lock = await getRevisionLock(serviceRole, {
    itemId: lockItemId,
    companyId
  });
  if (lock.isLocked && lock.releaseControl === "enforce") {
    return { success: false, message: LOCKED_REVISION_MESSAGE };
  }
  const lockWarn = lock.isLocked && lock.releaseControl === "warn";

  const update = await activateMethodVersion(serviceRole, {
    id,
    companyId,
    userId
  });

  if (update.error) {
    return {
      success: false,
      message: "Failed to activate method version"
    };
  }

  if (!methodToReplace) {
    return {
      success: false,
      message: "Method to replace is required"
    };
  }

  const redirectPath = requestReferrer(request)?.replace(
    methodToReplace ?? "",
    id ?? ""
  );

  if (!redirectPath) {
    return {
      success: false,
      message: "Failed to redirect to the correct page"
    };
  }

  return redirect(
    redirectPath,
    lockWarn
      ? await flash(request, success(LOCKED_REVISION_MESSAGE))
      : undefined
  );
}
