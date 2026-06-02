import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { AssemblyView } from "~/components/AssemblyView";
import {
  getJobByOperationId,
  getJobMakeMethod,
  getJobMaterialsByOperationId,
  getJobOperationById,
  getJobOperationProcedure,
  getNcrsByJobOperationId,
  getThumbnailPathByItemId,
  getToolsByProcessId,
  getTrackedEntitiesByMakeMethodId
} from "~/services/operations.service";
import type { OperationWithDetails } from "~/services/types";
import { makeDurations } from "~/utils/durations";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

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
    ncrs
  ] = await Promise.all([
    getThumbnailPathByItemId(serviceRole, op.itemId),
    getTrackedEntitiesByMakeMethodId(serviceRole, op.jobMakeMethodId),
    getJobMakeMethod(serviceRole, op.jobMakeMethodId),
    getJobOperationProcedure(serviceRole, operationId),
    getToolsByProcessId(serviceRole, op.processId),
    getNcrsByJobOperationId(serviceRole, operationId)
  ]);

  const materials = await getJobMaterialsByOperationId(serviceRole, {
    operation: op,
    trackedEntityId: trackedEntityId ?? undefined,
    requiresSerialTracking: jobMakeMethod.data?.requiresSerialTracking ?? false
  });

  return {
    job: job.data,
    operation: makeDurations(op) as OperationWithDetails,
    thumbnailPath,
    trackedEntities: trackedEntities.data ?? [],
    trackedEntityId,
    materials,
    procedure,
    tools: tools.data ?? [],
    ncrs: ncrs.data ?? []
  };
}

export default function AssemblyRoute() {
  const { operationId } = useParams();
  if (!operationId) throw new Error("Operation ID is required");

  const data = useLoaderData<typeof loader>();
  return <AssemblyView {...data} operationId={operationId} />;
}
