import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
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
    .select("salesOrderId, salesOrder(customerId)")
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
  const customerId =
    (lineResult.data.salesOrder as { customerId: string } | null)?.customerId ??
    null;

  // Clear stored history now that the link is restored
  const currentJob = await client
    .from("job")
    .select("customFields")
    .eq("id", id)
    .single();

  const prevCustomFields =
    (currentJob.data?.customFields as Record<string, unknown>) ?? {};
  const historyKeys = new Set([
    "previousSalesOrderId",
    "previousSalesOrderLineId",
    "previousSalesOrderReadableId"
  ]);
  const cleanCustomFields = Object.fromEntries(
    Object.entries(prevCustomFields).filter(([k]) => !historyKeys.has(k))
  );

  const update = await client
    .from("job")
    .update({
      salesOrderId,
      salesOrderLineId,
      customerId,
      customFields: cleanCustomFields,
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

  throw redirect(
    requestReferrer(request) ?? path.to.job(id),
    await flash(request, success("Job linked to sales order"))
  );
}
