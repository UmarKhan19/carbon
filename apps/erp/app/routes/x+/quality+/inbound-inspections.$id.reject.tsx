import { assertIsPost, ERP_URL, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { notifyIssueCreated } from "@carbon/ee/notifications";
import { getLocalTimeZone, today } from "@internationalized/date";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import invariant from "tiny-invariant";
import {
  deleteIssue,
  dispositionInboundInspection,
  getInboundInspection,
  getIssueTypesList,
  upsertIssue
} from "~/modules/quality";
import { getNextSequence } from "~/modules/settings";
import { getCompanyIntegrations } from "~/modules/settings/settings.server";
import { getUserDefaults } from "~/modules/users/users.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  // 1. Cascade reject — mark every tracked entity in the lot as Rejected
  //    and flip the lot's status to Failed (ISO 9001:2015 §8.7).
  const dispositionResult = await dispositionInboundInspection(client, {
    id,
    decision: "Reject",
    companyId,
    dispositionedBy: userId
  });
  if (dispositionResult.error) {
    throw redirect(
      path.to.inboundInspection(id),
      await flash(
        request,
        error(dispositionResult.error, "Failed to reject lot")
      )
    );
  }

  // 2. Auto-create an NCR and navigate the user straight to it so MRB can
  //    formally disposition (scrap / rework / return / use-as-is).
  const serviceRole = await getCarbonServiceRole();

  const [inspection, userDefaults, issueTypes] = await Promise.all([
    getInboundInspection(client, id),
    getUserDefaults(client, userId, companyId),
    getIssueTypesList(client, companyId)
  ]);

  if (inspection.error || !inspection.data) {
    throw redirect(
      path.to.inboundInspection(id),
      await flash(
        request,
        error(inspection.error, "Lot rejected, but failed to load it for NCR")
      )
    );
  }
  const insp = inspection.data as any;

  const issueType = issueTypes.data?.[0];
  const locationId = userDefaults.data?.locationId ?? null;

  if (!issueType || !locationId) {
    throw redirect(
      path.to.inboundInspection(id),
      await flash(
        request,
        error(
          null,
          "Lot rejected. Configure at least one Issue Type and a default user location to auto-create an NCR."
        )
      )
    );
  }

  const nextSequence = await getNextSequence(
    serviceRole,
    "nonConformance",
    companyId
  );
  if (nextSequence.error || !nextSequence.data) {
    throw redirect(
      path.to.inboundInspection(id),
      await flash(
        request,
        error(nextSequence.error, "Lot rejected, but failed to open NCR")
      )
    );
  }

  const supplierName = insp.supplier?.name ?? "supplier";
  const receiptReadableId = insp.receipt?.receiptId ?? "";
  const itemReadableId =
    insp.item?.readableId ?? insp.itemReadableId ?? insp.itemId;

  const createIssue = await upsertIssue(serviceRole, {
    nonConformanceId: nextSequence.data,
    name: `Rejected lot ${itemReadableId} on ${receiptReadableId}`.trim(),
    description: `Auto-created from inbound inspection. Lot size ${insp.lotSize}, sample ${insp.sampleSize}, Ac ${insp.acceptanceNumber} / Re ${insp.rejectionNumber}. Supplier: ${supplierName}.`,
    priority: "Medium",
    source: "Internal",
    locationId,
    nonConformanceTypeId: issueType.id,
    nonConformanceWorkflowId: undefined,
    openDate: today(getLocalTimeZone()).toString(),
    quantity: Number(insp.lotSize ?? 0),
    items: insp.itemId ? [insp.itemId] : [],
    requiredActionIds: [],
    approvalRequirements: [],
    companyId,
    createdBy: userId
  });

  if (createIssue.error || !createIssue.data?.id) {
    throw redirect(
      path.to.inboundInspection(id),
      await flash(
        request,
        error(createIssue.error, "Lot rejected, but failed to create NCR")
      )
    );
  }

  const ncrId = createIssue.data.id;

  // Link every tracked entity in the lot to the NCR.
  const trackedEntityIds = ((insp.inboundInspectionSample as any[]) ?? [])
    .map((s) => s.trackedEntityId as string)
    .filter(Boolean);
  // Include un-sampled entities too (they were also Rejected by the cascade).
  const receiptLineEntities = await client
    .from("trackedEntity")
    .select("id")
    .eq("attributes ->> Receipt Line", insp.receiptLineId)
    .eq("companyId", companyId);
  const allLotEntityIds = Array.from(
    new Set([
      ...trackedEntityIds,
      ...(receiptLineEntities.data ?? []).map((r: any) => r.id as string)
    ])
  );

  if (allLotEntityIds.length > 0) {
    await serviceRole.from("nonConformanceTrackedEntity").insert(
      allLotEntityIds.map((trackedEntityId) => ({
        nonConformanceId: ncrId,
        trackedEntityId,
        companyId,
        createdBy: userId
      }))
    );
  }

  const tasks = await serviceRole.functions.invoke("create", {
    body: {
      type: "nonConformanceTasks",
      id: ncrId,
      companyId,
      userId
    },
    region: FunctionRegion.UsEast1
  });
  if (tasks.error) {
    await deleteIssue(serviceRole, ncrId);
    throw redirect(
      path.to.inboundInspection(id),
      await flash(
        request,
        error(tasks.error, "Lot rejected, but failed to create NCR tasks")
      )
    );
  }

  try {
    const integrations = await getCompanyIntegrations(client, companyId);
    await notifyIssueCreated({ client, serviceRole }, integrations, {
      companyId,
      userId,
      carbonUrl: `${ERP_URL}${path.to.issue(ncrId)}`,
      issue: {
        id: ncrId,
        nonConformanceId: nextSequence.data,
        title: `Rejected lot ${itemReadableId} on ${receiptReadableId}`.trim(),
        description: `Auto-created from inbound inspection ${id}`,
        severity: "Medium"
      }
    });
  } catch (err) {
    console.error("Failed to send NCR notifications:", err);
  }

  throw redirect(
    path.to.issue(ncrId),
    await flash(request, success("Lot rejected — NCR opened"))
  );
}
