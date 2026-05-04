import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { Violation } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  evaluateForItem,
  isBlocked,
  loadCompiledRulesForItem
} from "~/modules/items/itemRules.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { receiptId } = params;
  if (!receiptId) throw new Error("receiptId not found");

  const formData = await request.formData();
  const acknowledged = formData.get("acknowledged") === "true";

  // Item Rule evaluation across every line on this receipt before posting.
  // Use service role so item / storageUnit reads are not blocked by RLS for
  // users who have `inventory.update` but not `parts.view` etc.
  const serviceRole = await getCarbonServiceRole();
  const { violations, ruleNames } = await evaluateReceiptPost({
    client: serviceRole,
    companyId,
    userId,
    receiptId
  });

  if (violations.length > 0 && isBlocked(violations, acknowledged)) {
    return {
      error: null,
      data: null,
      violations,
      ruleNames
    };
  }

  const setPendingState = await client
    .from("receipt")
    .update({
      status: "Pending"
    })
    .eq("id", receiptId);

  if (setPendingState.error) {
    throw redirect(
      path.to.receipt(receiptId),
      await flash(
        request,
        error(setPendingState.error, "Failed to post receipt")
      )
    );
  }

  try {
    const receiptMetadata = await serviceRole
      .from("receipt")
      .select("sourceDocument,sourceDocumentId")
      .eq("id", receiptId)
      .single();

    const companySettings = await (serviceRole.from("companySettings") as any)
      .select("updateLeadTimesOnReceipt")
      .eq("id", companyId)
      .single();

    const postReceipt = await serviceRole.functions.invoke("post-receipt", {
      body: {
        receiptId: receiptId,
        userId: userId,
        companyId: companyId
      }
    });

    if (postReceipt.error) {
      await client
        .from("receipt")
        .update({
          status: "Draft"
        })
        .eq("id", receiptId);

      throw redirect(
        path.to.receipt(receiptId),
        await flash(request, error(postReceipt.error, "Failed to post receipt"))
      );
    }

    const shouldUpdateLeadTimesOnReceipt = Boolean(
      (companySettings.data as { updateLeadTimesOnReceipt?: boolean } | null)
        ?.updateLeadTimesOnReceipt
    );

    if (
      shouldUpdateLeadTimesOnReceipt &&
      receiptMetadata.data?.sourceDocument === "Purchase Order" &&
      receiptMetadata.data?.sourceDocumentId
    ) {
      const leadTimeUpdate = await serviceRole.functions.invoke(
        "update-purchased-prices",
        {
          body: {
            source: "purchaseOrder",
            purchaseOrderId: receiptMetadata.data.sourceDocumentId,
            companyId,
            updatePrices: false,
            updateLeadTimes: true
          }
        }
      );

      if (leadTimeUpdate.error) {
        console.error(
          "Failed to update lead time on receipt posting:",
          leadTimeUpdate.error
        );
      }
    }
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  } catch (error) {
    await client
      .from("receipt")
      .update({
        status: "Draft"
      })
      .eq("id", receiptId);
  }

  throw redirect(path.to.receipt(receiptId));
}

type EvalArgs = {
  client: Awaited<ReturnType<typeof getCarbonServiceRole>>;
  companyId: string;
  userId: string;
  receiptId: string;
};

type EvalResult = {
  violations: Violation[];
  ruleNames: Record<string, string>;
};

async function evaluateReceiptPost({
  client,
  companyId,
  userId,
  receiptId
}: EvalArgs): Promise<EvalResult> {
  const { data: lines } = await client
    .from("receiptLine")
    .select(
      "id, itemId, storageUnitId, receivedQuantity, locationId, receiptId"
    )
    .eq("receiptId", receiptId)
    .eq("companyId", companyId);

  if (!lines || lines.length === 0) {
    return { violations: [], ruleNames: {} };
  }

  const itemIds = Array.from(
    new Set(lines.map((l) => l.itemId).filter(Boolean))
  ) as string[];
  const storageUnitIds = Array.from(
    new Set(lines.map((l) => l.storageUnitId as string | null).filter(Boolean))
  ) as string[];

  const [itemsRes, storageUnitsRes] = await Promise.all([
    itemIds.length
      ? client
          .from("item")
          .select(
            "id, type, replenishmentSystem, itemTrackingType, name, readableId"
          )
          .in("id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    storageUnitIds.length
      ? client
          .from("storageUnit")
          .select("id, storageTypeIds, warehouseId, name, locationId")
          .in("id", storageUnitIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  const itemsById = new Map(
    (itemsRes.data ?? []).map((it) => [it.id, it as Record<string, unknown>])
  );
  // Flatten storageTypeIds[0] → synthetic storageTypeId for resolver parity.
  const unitsById = new Map(
    (storageUnitsRes.data ?? []).map((u) => {
      const ids = (u as { storageTypeIds?: string[] | null }).storageTypeIds;
      return [
        u.id,
        {
          ...(u as Record<string, unknown>),
          storageTypeId: ids && ids.length > 0 ? ids[0] : undefined
        } as Record<string, unknown>
      ];
    })
  );

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

    const storageUnitId = line.storageUnitId as string | null;
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
        quantity: Number(line.receivedQuantity ?? 0),
        userId
      }
    };

    all.push(...evaluateForItem(compiled, ctx, "receipt"));
  }

  // Resolve rule names for any violations so the modal can render names
  // instead of raw rule IDs.
  const ruleNames: Record<string, string> = {};
  if (all.length > 0) {
    const violatedIds = Array.from(new Set(all.map((v) => v.ruleId)));
    const { data: namedRules } = await client
      .from("itemRule")
      .select("id, name")
      .in("id", violatedIds);
    for (const r of namedRules ?? []) {
      ruleNames[r.id as string] = r.name as string;
    }
  }

  return { violations: all, ruleNames };
}
