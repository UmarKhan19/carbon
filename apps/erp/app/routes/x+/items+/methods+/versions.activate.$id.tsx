import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { checkRevisionLock } from "~/modules/items/items.server";
import {
  activateMethodVersion,
  getOpenChangeOrderForPendingRevision
} from "~/modules/items/items.service";
import { requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const url = new URL(request.url);
  const methodToReplace = url.searchParams.get("methodToReplace");

  const { id } = params;
  if (!id) {
    return { success: false, message: "Invalid operation tool id" };
  }

  const serviceRole = getCarbonServiceRole();

  // Release-lock gate: activating a make-method version switches the live
  // BOM/BOP for the item, so resolve the version's parent item and gate on it.
  const lock = await checkRevisionLock(serviceRole, {
    kind: "makeMethod",
    id,
    companyId
  });
  if (!lock.ok) {
    return { success: false, message: lock.message };
  }

  // ECO governance: a proposed (draft) revision's method must not be activated
  // by hand — that would push an unapproved change live and bypass the change
  // order's review/release. Resolve the version's parent item; if it's the
  // pending revision of an open change order, block and point back to the CO.
  const method = await serviceRole
    .from("makeMethod")
    .select("itemId")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (method.data?.itemId) {
    const openCO = await getOpenChangeOrderForPendingRevision(serviceRole, {
      pendingItemId: method.data.itemId,
      companyId
    });
    if (openCO.data) {
      return {
        success: false,
        message: `This revision is proposed under change order ${openCO.data.changeOrderId}. Its method becomes active when the change order is released.`
      };
    }
  }

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
    lock.warn ? await flash(request, success(lock.message)) : undefined
  );
}
