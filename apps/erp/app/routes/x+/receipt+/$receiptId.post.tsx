import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import type { PrintingSettings } from "@carbon/printing";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  dedupeViolations,
  evaluateLinesForSurface,
  isBlocked
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
  const serviceRole = getCarbonServiceRole();
  const { data: lines } = await serviceRole
    .from("receiptLine")
    .select(
      "id, itemId, storageUnitId, receivedQuantity, locationId, receiptId"
    )
    .eq("receiptId", receiptId)
    .eq("companyId", companyId);

  // Receipt source determines which surface(s) eval. Receipts originating from
  // an Inbound Transfer ALSO eval the `warehouseTransfer` surface — the post
  // auto-completes the parent transfer, so warehouse-scoped rules need to
  // fire here too.
  const { data: receiptForSurface } = await serviceRole
    .from("receipt")
    .select("sourceDocument")
    .eq("id", receiptId)
    .single();
  const surfaces: ("receipt" | "warehouseTransfer")[] = ["receipt"];
  if (receiptForSurface?.sourceDocument === "Inbound Transfer") {
    surfaces.push("warehouseTransfer");
  }

  const evalLines = (lines ?? []).map((l) => ({
    lineId: l.id as string,
    itemId: l.itemId as string | null,
    storageUnitId: l.storageUnitId as string | null,
    quantity: Number(l.receivedQuantity ?? 0),
    locationId: l.locationId as string | null
  }));

  const allViolations = [];
  const allRuleNames: Record<string, string> = {};
  for (const surface of surfaces) {
    const { violations, ruleNames } = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      surface,
      lines: evalLines
    });
    allViolations.push(...violations);
    Object.assign(allRuleNames, ruleNames);
  }

  const deduped = dedupeViolations(allViolations);
  if (deduped.length > 0 && isBlocked(deduped, acknowledged)) {
    return {
      error: null,
      data: null,
      violations: deduped,
      ruleNames: allRuleNames
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
      .select("updateLeadTimesOnReceipt,printing")
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

    // Auto-print labels if enabled
    try {
      const { data: receipt } = await serviceRole
        .from("receipt")
        .select("locationId")
        .eq("id", receiptId)
        .single();
      const locationId = receipt?.locationId as string | undefined;
      if (locationId) {
        const printing = companySettings.data
          ?.printing as PrintingSettings | null;
        if (printing?.assignments?.[locationId]?.receiving?.autoPrint) {
          await trigger("print-job", {
            sourceDocument: "Receipt",
            sourceDocumentId: receiptId,
            companyId,
            userId,
            locationId
          });
        }
      }
    } catch (e) {
      console.error("Auto-print failed:", e);
    }
  } catch (thrown) {
    // Re-throw redirects — don't swallow them
    if (thrown instanceof Response) throw thrown;

    // Only reset to Draft for actual errors
    await client
      .from("receipt")
      .update({
        status: "Draft"
      })
      .eq("id", receiptId);
  }

  throw redirect(path.to.receipt(receiptId));
}
