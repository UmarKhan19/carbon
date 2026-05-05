import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import {
  evaluateLinesForSurface,
  isBlocked
} from "~/modules/items/itemRules.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids") as string[];
  const field = formData.get("field");
  const value = formData.get("value");
  const acknowledged = formData.get("acknowledged") === "true";

  if (
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null)
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  if (field !== "storageUnitId" && field !== "shippedQuantity") {
    return { error: { message: `Invalid field: ${field}` }, data: null };
  }

  // Item Rule evaluation. Service role for item / storageUnit reads.
  const serviceRole = getCarbonServiceRole();
  const { data: lines } = await serviceRole
    .from("shipmentLine")
    .select(
      "id, itemId, storageUnitId, shippedQuantity, locationId, shipmentId"
    )
    .in("id", ids)
    .eq("companyId", companyId);

  const { violations, ruleNames } = await evaluateLinesForSurface({
    client: serviceRole,
    companyId,
    userId,
    surface: "shipment",
    lines: (lines ?? []).map((l) => ({
      lineId: l.id as string,
      itemId: l.itemId as string | null,
      storageUnitId:
        field === "storageUnitId" ? value : (l.storageUnitId as string | null),
      quantity:
        field === "shippedQuantity"
          ? Number(value)
          : Number(l.shippedQuantity ?? 0),
      locationId: l.locationId as string | null
    }))
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
    .from("shipmentLine")
    .update({
      [field]: value ? value : null,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .in("id", ids)
    .eq("companyId", companyId);

  return update;
}
