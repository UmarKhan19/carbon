import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getInventoryCount,
  resnapshotInventoryCountLines,
  updateInventoryCountStatus
} from "~/modules/inventory";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

// Rectify (Posted -> Draft): reopen a posted count in place to fix wrong counted
// quantities, then re-post. Re-snapshots each line's system quantity to current
// live on-hand (so the reopened count starts drift-free and unchanged lines post
// nothing), then flips the count back to Draft for editing. Re-posting writes a
// new adjustment for each changed line, linked to its original movement
// (`itemLedger.correctionOfItemLedgerId`), so both stay visible in Stock
// Movements. The original posted movements are never mutated.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const header = await getInventoryCount(client, id, companyId);
  if (header.data?.status !== "Posted") {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(request, error(null, "Only a posted count can be rectified"))
    );
  }

  try {
    await resnapshotInventoryCountLines(getDatabaseClient(), {
      inventoryCountId: id,
      companyId,
      locationId: header.data.locationId,
      updatedBy: userId
    });
  } catch (err) {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(
        request,
        error(err, "Failed to reopen count for rectification")
      )
    );
  }

  const reopened = await updateInventoryCountStatus(client, {
    id,
    companyId,
    status: "Draft",
    expectedStatus: "Posted",
    updatedBy: userId
  });

  if (reopened.error) {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(request, error(reopened.error, "Failed to reopen count"))
    );
  }

  throw redirect(
    path.to.inventoryCount(id),
    await flash(request, success("Count reopened for rectification"))
  );
}
