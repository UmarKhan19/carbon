import { requirePermissions } from "@carbon/auth/auth.server";
import type { Violation } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  evaluateForItem,
  isBlocked,
  loadCompiledRulesForItem
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

  if (field !== "storageUnitId" && field !== "receivedQuantity") {
    return { error: { message: `Invalid field: ${field}` }, data: null };
  }

  // Item Rule evaluation (storage context relevant only for storageUnitId edits;
  // quantity-only edits still evaluate transaction.quantity rules).
  const violations = await evaluateReceiptLineUpdate({
    client,
    companyId,
    userId,
    receiptLineIds: ids,
    field,
    value
  });

  if (violations.length > 0 && isBlocked(violations, acknowledged)) {
    return {
      error: null,
      data: null,
      violations
    };
  }

  const update = await client
    .from("receiptLine")
    .update({
      [field]: value ? value : null,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .in("id", ids)
    .eq("companyId", companyId);

  return update;
}

type EvalArgs = {
  client: Awaited<ReturnType<typeof requirePermissions>>["client"];
  companyId: string;
  userId: string;
  receiptLineIds: string[];
  field: "storageUnitId" | "receivedQuantity";
  value: string | null;
};

async function evaluateReceiptLineUpdate({
  client,
  companyId,
  userId,
  receiptLineIds,
  field,
  value
}: EvalArgs): Promise<Violation[]> {
  if (receiptLineIds.length === 0) return [];

  // Fetch all relevant receipt lines + their items in one round trip.
  const { data: lines } = await client
    .from("receiptLine")
    .select(
      "id, itemId, storageUnitId, receivedQuantity, locationId, receiptId"
    )
    .in("id", receiptLineIds)
    .eq("companyId", companyId);

  if (!lines || lines.length === 0) return [];

  const itemIds = Array.from(
    new Set(lines.map((l) => l.itemId).filter(Boolean))
  ) as string[];
  const storageUnitIds = Array.from(
    new Set(
      lines
        .map((l) =>
          field === "storageUnitId" ? value : (l.storageUnitId as string | null)
        )
        .filter(Boolean) as string[]
    )
  );

  const [itemsRes, storageUnitsRes] = await Promise.all([
    itemIds.length
      ? client
          .from("item")
          .select(
            "id, type, replenishmentSystem, itemTrackingType, itemPostingGroupId, customFields, name, readableId"
          )
          .in("id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    storageUnitIds.length
      ? client
          .from("storageUnit")
          .select("id, storageTypeId, warehouseId, shelfId, name")
          .in("id", storageUnitIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  const itemsById = new Map(
    (itemsRes.data ?? []).map((it) => [it.id, it as Record<string, unknown>])
  );
  const unitsById = new Map(
    (storageUnitsRes.data ?? []).map((u) => [
      u.id,
      u as Record<string, unknown>
    ])
  );

  // Per-item compile is cached; cheap to repeat.
  const compiledByItem = new Map(
    await Promise.all(
      itemIds.map(
        async (id) =>
          [id, await loadCompiledRulesForItem(client, id, companyId)] as const
      )
    )
  );

  const all: Violation[] = [];
  for (const line of lines) {
    const itemId = line.itemId as string | null;
    if (!itemId) continue;
    const compiled = compiledByItem.get(itemId);
    if (!compiled || compiled.length === 0) continue;

    const storageUnitId =
      field === "storageUnitId" ? value : (line.storageUnitId as string | null);
    const quantity =
      field === "receivedQuantity"
        ? Number(value)
        : Number(line.receivedQuantity ?? 0);

    const ctx = {
      item: itemsById.get(itemId) as
        | (Record<string, unknown> & {
            customFields?: Record<string, unknown>;
          })
        | undefined,
      storageUnit: storageUnitId
        ? (unitsById.get(storageUnitId) as Record<string, unknown> | undefined)
        : undefined,
      transaction: {
        kind: "receipt",
        locationId: line.locationId,
        quantity,
        userId
      }
    };

    all.push(...evaluateForItem(compiled, ctx));
  }

  return all;
}
