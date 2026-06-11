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
  getNcrsByJobOperationId,
  getNonConformanceActions,
  getProductionEventsForJobOperation,
  getThumbnailPathByItemId,
  getToolsByProcessId,
  getTrackedEntitiesByMakeMethodId
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

  // Expiry policy for the issue-material modal — same source as the operation view.
  const companySettings = await getCompanySettings(serviceRole, companyId);
  const inventoryShelfLife = (companySettings.data?.inventoryShelfLife ??
    null) as { expiredEntityPolicy?: ExpiredEntityPolicy } | null;
  const expiredEntityPolicy: ExpiredEntityPolicy =
    inventoryShelfLife?.expiredEntityPolicy ?? "Block";

  // Resolve the real production unit. Ignore the pre-generated "Available"
  // serial pool (e.g. 24 unused serials on a qty-1 job); use the URL entity
  // only if it's a real unit, else fall back to the first real unit. The
  // materials filter, the consume target and the step counts must all agree on
  // this same unit — otherwise issuing/recording appears to "do nothing".
  const allEntities = trackedEntities.data ?? [];
  const realEntities = allEntities.filter((te) => te.status !== "Available");
  const unitPool = realEntities.length > 0 ? realEntities : allEntities;
  const effectiveEntityId =
    (trackedEntityId
      ? unitPool.find((te) => te.id === trackedEntityId)?.id
      : undefined) ?? unitPool[0]?.id;

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
    expiredEntityPolicy
  };
}

export default function AssemblyRoute() {
  const { operationId } = useParams();
  if (!operationId) throw new Error("Operation ID is required");

  const data = useLoaderData<typeof loader>();
  return <AssemblyView {...data} operationId={operationId} />;
}
