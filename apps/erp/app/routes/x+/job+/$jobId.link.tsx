import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getJob, isJobLocked } from "~/modules/production";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { jobId: id } = params;
  if (!id) throw new Error("Could not find jobId");

  const job = await getJob(client, id);
  await requireUnlocked({
    request,
    isLocked: isJobLocked(job.data?.status),
    redirectTo: path.to.job(id),
    message: "Cannot modify a locked job."
  });

  const formData = await request.formData();
  const salesOrderLineId = formData.get("salesOrderLineId") as string;

  if (!salesOrderLineId) {
    throw redirect(
      requestReferrer(request) ?? path.to.job(id),
      await flash(request, error(null, "Sales order line is required"))
    );
  }

  const lineResult = await client
    .from("salesOrderLine")
    .select("salesOrderId, salesOrder(customerId, locationId)")
    .eq("id", salesOrderLineId)
    .eq("companyId", companyId)
    .single();

  if (lineResult.error || !lineResult.data) {
    throw redirect(
      requestReferrer(request) ?? path.to.job(id),
      await flash(
        request,
        error(lineResult.error, "Sales order line not found")
      )
    );
  }

  const salesOrderId = lineResult.data.salesOrderId;
  const soData = lineResult.data.salesOrder as {
    customerId: string;
    locationId: string | null;
  } | null;

  const update = await client
    .from("job")
    .update({
      salesOrderId,
      salesOrderLineId,
      customerId: soData?.customerId ?? null,
      previousSalesOrderId: null,
      previousSalesOrderLineId: null,
      previousSalesOrderReadableId: null,
      updatedBy: userId
    })
    .eq("id", id)
    .eq("companyId", companyId);

  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.job(id),
      await flash(
        request,
        error(update.error, "Failed to link job to sales order")
      )
    );
  }

  // Auto-refresh any empty Draft shipments for this sales order
  let relinkedShipment = false;
  const emptyShipments = await client
    .from("shipment")
    .select("id, locationId")
    .eq("sourceDocumentId", salesOrderId)
    .eq("status", "Draft")
    .eq("companyId", companyId);

  for (const shipment of emptyShipments.data ?? []) {
    const lineCount = await client
      .from("shipmentLine")
      .select("id", { count: "exact", head: true })
      .eq("shipmentId", shipment.id);

    if ((lineCount.count ?? 0) === 0) {
      const serviceRole = getCarbonServiceRole();
      await serviceRole.functions.invoke("create", {
        body: {
          type: "shipmentFromSalesOrder",
          salesOrderId,
          shipmentId: shipment.id,
          locationId: shipment.locationId ?? soData?.locationId,
          companyId,
          userId
        }
      });
      relinkedShipment = true;
    }
  }

  const message = relinkedShipment
    ? "Job linked to sales order and shipment lines restored"
    : "Job linked to sales order";

  throw redirect(
    requestReferrer(request) ?? path.to.job(id),
    await flash(request, success(message))
  );
}
