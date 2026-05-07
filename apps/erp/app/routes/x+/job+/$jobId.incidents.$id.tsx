import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getProductionIncident,
  getProductionIncidentTypes,
  productionIncidentValidator,
  upsertProductionIncident
} from "~/modules/production";
import IncidentForm from "~/modules/production/ui/Jobs/IncidentForm";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });

  const { jobId, id } = params;
  if (!jobId || !id) throw new Error("jobId and id required");

  const [incident, types] = await Promise.all([
    getProductionIncident(client, id, companyId),
    getProductionIncidentTypes(client, companyId)
  ]);

  if (incident.error || !incident.data) {
    throw redirect(
      path.to.jobIncidents(jobId),
      await flash(request, error(incident.error, "Incident not found"))
    );
  }

  return {
    jobId,
    incident: incident.data,
    incidentTypes: types.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { jobId, id } = params;
  if (!jobId || !id) throw new Error("jobId and id required");

  const formData = await request.formData();
  const validation = await validator(productionIncidentValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await upsertProductionIncident(client, {
    ...validation.data,
    id,
    updatedBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.jobIncidents(jobId),
      await flash(request, error(result.error, "Failed to update incident"))
    );
  }

  throw redirect(
    path.to.jobIncidents(jobId),
    await flash(request, success("Incident updated"))
  );
}

export default function EditJobIncidentRoute() {
  const { jobId, incident, incidentTypes } = useLoaderData<typeof loader>();
  const inc = incident as any;

  return (
    <IncidentForm
      jobId={jobId}
      incidentTypes={incidentTypes as Array<{ id: string; name: string }>}
      initialValues={{
        id: inc.id,
        jobId: inc.jobId,
        itemId: inc.itemId ?? undefined,
        trackedEntityId: inc.trackedEntityId ?? undefined,
        incidentTypeId: inc.incidentTypeId ?? undefined,
        incidentDate: (typeof inc.incidentDate === "string"
          ? inc.incidentDate
          : new Date(inc.incidentDate).toISOString()
        ).slice(0, 10),
        quantityLost: Number(inc.quantityLost ?? 0),
        position: inc.position ?? undefined,
        impactsPickingList: Boolean(inc.impactsPickingList),
        status: inc.status
      }}
    />
  );
}
