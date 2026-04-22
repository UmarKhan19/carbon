import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { isIssueLocked, splitIssueItemValidator } from "~/modules/quality";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const formData = await request.formData();
  const validation = await validator(splitIssueItemValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const { id, entityAssignments, splitQuantity } = validation.data;

  const existing = await client
    .from("nonConformanceItem")
    .select("*, nonConformance(status)")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();

  if (existing.error || !existing.data) {
    return data(
      { error: { message: "Item association not found" } },
      await flash(request, error(existing.error, "Item association not found"))
    );
  }

  const lockedError = requireUnlockedBulk({
    statuses: [(existing.data as any).nonConformance?.status ?? null],
    checkFn: isIssueLocked,
    message: "Cannot modify a closed issue. Reopen it first."
  });
  if (lockedError) return lockedError;

  const current = Number(existing.data.quantity ?? 0);
  const nowIso = new Date().toISOString();

  let effectiveSplitQty: number;
  let entitiesToMove: { trackedEntityId: string; quantity: number }[] = [];

  if (entityAssignments && entityAssignments.length > 0) {
    effectiveSplitQty = entityAssignments.reduce(
      (acc, a) => acc + Number(a.quantity),
      0
    );
    entitiesToMove = entityAssignments;
  } else if (typeof splitQuantity === "number" && splitQuantity > 0) {
    const links = await (client as any)
      .from("nonConformanceItemTrackedEntity")
      .select("trackedEntityId, quantity")
      .eq("nonConformanceItemId", id)
      .eq("companyId", companyId)
      .order("quantity", { ascending: true });
    if (links.error) {
      return data(
        { error: links.error },
        await flash(request, error(links.error, "Failed to load entity links"))
      );
    }

    let remaining = splitQuantity;
    for (const link of (links.data ?? []) as any[]) {
      const qty = Number(link.quantity ?? 0);
      if (qty <= remaining + 1e-6) {
        entitiesToMove.push({
          trackedEntityId: link.trackedEntityId,
          quantity: qty
        });
        remaining -= qty;
        if (remaining <= 1e-6) break;
      }
    }

    if (Math.abs(remaining) > 1e-6) {
      return data(
        {
          error: {
            message:
              "Cannot split by quantity alone — mixed batch sizes require explicit entity selection"
          }
        },
        await flash(
          request,
          error(null, "Use the entity picker to split this row")
        )
      );
    }

    effectiveSplitQty = splitQuantity;
  } else {
    return data(
      { error: { message: "Missing split parameters" } },
      await flash(request, error(null, "Invalid split request"))
    );
  }

  if (effectiveSplitQty >= current) {
    return data(
      {
        error: {
          message: `Split quantity (${effectiveSplitQty}) must be less than the current quantity (${current})`
        }
      },
      await flash(request, error(null, "Split quantity too large"))
    );
  }

  const insert = await client
    .from("nonConformanceItem")
    .insert({
      nonConformanceId: existing.data.nonConformanceId,
      itemId: existing.data.itemId,
      quantity: effectiveSplitQty,
      disposition: "Pending",
      companyId,
      createdBy: userId
    })
    .select("id")
    .single();

  if (insert.error || !insert.data) {
    return data(
      { error: insert.error },
      await flash(request, error(insert.error, "Failed to split line"))
    );
  }

  const newRowId = (insert.data as { id: string }).id;

  if (entitiesToMove.length > 0) {
    const entityIds = entitiesToMove.map((e) => e.trackedEntityId);
    const move = await (client as any)
      .from("nonConformanceItemTrackedEntity")
      .update({
        nonConformanceItemId: newRowId,
        updatedBy: userId,
        updatedAt: nowIso
      })
      .eq("nonConformanceItemId", id)
      .in("trackedEntityId", entityIds)
      .eq("companyId", companyId);
    if (move.error) {
      return data(
        { error: move.error },
        await flash(
          request,
          error(move.error, "Failed to reassign tracked entities")
        )
      );
    }
  }

  const update = await client
    .from("nonConformanceItem")
    .update({
      quantity: current - effectiveSplitQty,
      updatedBy: userId,
      updatedAt: nowIso
    })
    .eq("id", id)
    .eq("companyId", companyId);

  if (update.error) {
    return data(
      { error: update.error },
      await flash(request, error(update.error, "Failed to update original"))
    );
  }

  return data({ success: true }, await flash(request, success("Line split")));
}
