import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { AssemblyView } from "~/components/AssemblyView";
import { getCompanySettings } from "~/services/inventory.service";
import {
  getJobByOperationId,
  getJobMakeMethod,
  getJobMaterialsByOperationId,
  getJobOperationById,
  getJobOperationProcedure,
  getKanbanByJobId,
  getNcrsByJobOperationId,
  getNonConformanceActions,
  getProductionEventsForJobOperation,
  getProductionQuantitiesForJobOperation,
  getThumbnailPathByItemId,
  getToolsByProcessId,
  getTrackedEntitiesByMakeMethodId,
  getWorkCenter
} from "~/services/operations.service";
import type { OperationWithDetails } from "~/services/types";
import { makeDurations } from "~/utils/durations";
import { path } from "~/utils/path";

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const url = new URL(request.url);
  const trackedEntityId = url.searchParams.get("trackedEntityId");

  const serviceRole = await getCarbonServiceRole();

  const [job, operation] = await Promise.all([
    getJobByOperationId(serviceRole, operationId),
    getJobOperationById(serviceRole, operationId)
  ]);

  if (job.error)
    throw redirect(
      path.to.operations,
      await flash(request, error(job.error, "Failed to fetch job"))
    );
  if (operation.error)
    throw redirect(
      path.to.operations,
      await flash(request, error(operation.error, "Failed to fetch operation"))
    );

  const op = operation.data?.[0];
  if (!op) throw redirect(path.to.operations);

  const [
    thumbnailPath,
    trackedEntities,
    jobMakeMethod,
    procedure,
    tools,
    ncrs,
    events,
    nonConformanceActions
  ] = await Promise.all([
    getThumbnailPathByItemId(serviceRole, op.itemId),
    getTrackedEntitiesByMakeMethodId(serviceRole, op.jobMakeMethodId),
    getJobMakeMethod(serviceRole, op.jobMakeMethodId),
    getJobOperationProcedure(serviceRole, operationId),
    getToolsByProcessId(serviceRole, op.processId),
    getNcrsByJobOperationId(serviceRole, operationId),
    getProductionEventsForJobOperation(serviceRole, { operationId, userId }),
    getNonConformanceActions(serviceRole, {
      itemId: op.itemId,
      processId: op.processId,
      companyId
    })
  ]);

  const [quantities, workCenter, kanban] = await Promise.all([
    getProductionQuantitiesForJobOperation(serviceRole, operationId),
    getWorkCenter(serviceRole, op.workCenterId),
    job.data.id ? getKanbanByJobId(serviceRole, job.data.id) : null
  ]);

  const productionQuantities = (quantities.data ?? []).reduce(
    (acc, curr) => {
      if (curr.type === "Scrap") acc.scrap += curr.quantity;
      else if (curr.type === "Production") acc.production += curr.quantity;
      else if (curr.type === "Rework") acc.rework += curr.quantity;
      return acc;
    },
    { scrap: 0, production: 0, rework: 0 }
  );

  // Expiry policy for the issue-material modal — same source as the operation view.
  const companySettings = await getCompanySettings(serviceRole, companyId);
  const inventoryShelfLife = (companySettings.data?.inventoryShelfLife ??
    null) as { expiredEntityPolicy?: ExpiredEntityPolicy } | null;
  const expiredEntityPolicy: ExpiredEntityPolicy =
    inventoryShelfLife?.expiredEntityPolicy ?? "Block";

  // Resolve the unit the materials/consume target key off. Navigable units are
  // capped to the operation quantity (a job can have extra pre-generated serials
  // beyond the quantity). Use the URL entity if it's within that set, else the
  // first unit — so the materials filter and the view agree on the same unit.
  const allEntities = trackedEntities.data ?? [];
  const opQty = Math.max(
    1,
    Math.round((op.operationQuantity as number) ?? allEntities.length)
  );
  const navEntities = allEntities.slice(0, opQty);
  const effectiveEntityId =
    (trackedEntityId
      ? navEntities.find((te) => te.id === trackedEntityId)?.id
      : undefined) ?? navEntities[0]?.id;

  const [materials, openEvent] = await Promise.all([
    getJobMaterialsByOperationId(serviceRole, {
      operation: op,
      trackedEntityId: effectiveEntityId,
      requiresSerialTracking:
        jobMakeMethod.data?.requiresSerialTracking ?? false
    }),
    // Open Labor production event for this operator+operation drives the timer.
    serviceRole
      .from("productionEvent")
      .select("id, startTime")
      .eq("jobOperationId", op.id)
      .eq("employeeId", userId)
      .eq("type", "Labor")
      .is("endTime", null)
      .order("startTime", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  return {
    job: job.data,
    operation: makeDurations(op) as OperationWithDetails,
    thumbnailPath,
    trackedEntities: trackedEntities.data ?? [],
    // The resolved real unit (not the raw URL value) so the component's current
    // unit, consume target and step counts match the loaded materials.
    trackedEntityId: effectiveEntityId ?? trackedEntityId,
    materials,
    procedure,
    tools: tools.data ?? [],
    ncrs: ncrs.data ?? [],
    requiresSerialTracking: jobMakeMethod.data?.requiresSerialTracking ?? false,
    requiresBatchTracking: jobMakeMethod.data?.requiresBatchTracking ?? false,
    openEvent: openEvent.data ?? null,
    events: events.data ?? [],
    nonConformanceActions,
    expiredEntityPolicy,
    productionQuantities,
    workCenter:
      (workCenter.data as {
        id: string;
        name: string;
        isBlocked: boolean | null;
        blockingDispatchId: string | null;
        blockingDispatchReadableId: string | null;
      } | null) ?? null,
    kanban: kanban?.data ?? null,
    jobId: job.data.id ?? null,
    modelPath:
      (op as { itemModelPath?: string | null }).itemModelPath ??
      (job.data as { modelPath?: string | null }).modelPath ??
      null
  };
}

export default function AssemblyRoute() {
  const { operationId } = useParams();
  if (!operationId) throw new Error("Operation ID is required");

  const data = useLoaderData<typeof loader>();
  return <AssemblyView {...data} operationId={operationId} />;
}
