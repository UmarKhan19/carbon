import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { getStockTransfer, isStockTransferLocked } from "~/modules/inventory";
import {
  evaluateLinesForSurface,
  isBlocked
} from "~/modules/items/itemRules.server";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids") as string[];
  const field = formData.get("field");
  const value = formData.get("value");
  const acknowledged = formData.get("acknowledged") === "true";

  // Look up the stock transfer from the first line to check locked status.
  if (ids.length > 0) {
    const line = await client
      .from("stockTransferLine")
      .select("stockTransferId")
      .eq("id", ids[0] as string)
      .single();

    if (line.data?.stockTransferId) {
      const { client: viewClient } = await requirePermissions(request, {
        view: "inventory"
      });
      const transfer = await getStockTransfer(
        viewClient,
        line.data.stockTransferId
      );
      await requireUnlocked({
        request,
        isLocked: isStockTransferLocked(transfer.data?.status),
        redirectTo: path.to.stockTransfer(line.data.stockTransferId),
        message: "Cannot modify a locked stock transfer. Reopen it first."
      });
    }
  }

  if (
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null)
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  if (field !== "fromStorageUnitId" && field !== "toStorageUnitId") {
    return { error: { message: `Invalid field: ${field}` }, data: null };
  }

  // Item Rule evaluation. The "side" being edited (from / to) determines which
  // storage unit ctx the rule sees.
  const serviceRole = getCarbonServiceRole();
  const { data: lines } = await serviceRole
    .from("stockTransferLine")
    .select(
      "id, itemId, fromStorageUnitId, toStorageUnitId, quantity, stockTransferId"
    )
    .in("id", ids)
    .eq("companyId", companyId);

  const { violations, ruleNames } = await evaluateLinesForSurface({
    client: serviceRole,
    companyId,
    userId,
    surface: "stockTransfer",
    lines: (lines ?? []).map((l) => {
      const candidateUnit =
        field === "fromStorageUnitId"
          ? (value ?? (l.fromStorageUnitId as string | null))
          : (value ?? (l.toStorageUnitId as string | null));
      return {
        lineId: l.id as string,
        itemId: l.itemId as string | null,
        storageUnitId: candidateUnit,
        quantity: Number(l.quantity ?? 0),
        // Stock transfer lines have no direct location — let the helper
        // derive it from the storage unit when one is in scope.
        locationId: null
      };
    })
  });

  if (violations.length > 0 && isBlocked(violations, acknowledged)) {
    return {
      error: null,
      data: null,
      violations,
      ruleNames
    };
  }

  const update = await client
    .from("stockTransferLine")
    .update({
      [field]: value ? value : null,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .in("id", ids)
    .eq("companyId", companyId);

  return update;
}
