import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getProductionIncidentTypes,
  productionIncidentValidator,
  upsertProductionIncident
} from "~/modules/production";
import IncidentForm from "~/modules/production/ui/Jobs/IncidentForm";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("jobId required");

  const types = await getProductionIncidentTypes(client, companyId);
  return {
    jobId,
    incidentTypes: types.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("jobId required");

  const formData = await request.formData();
  const validation = await validator(productionIncidentValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _ignoreId, ...d } = validation.data;
  const result = await upsertProductionIncident(client, {
    ...d,
    jobId,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.jobIncidents(jobId),
      await flash(request, error(result.error, "Failed to create incident"))
    );
  }

  throw redirect(
    path.to.jobIncidents(jobId),
    await flash(request, success("Incident reported"))
  );
}

export default function NewJobIncidentRoute() {
  const { jobId, incidentTypes } = useLoaderData<typeof loader>();

  return (
    <IncidentForm
      jobId={jobId}
      incidentTypes={incidentTypes as Array<{ id: string; name: string }>}
      initialValues={{
        jobId,
        itemId: undefined,
        trackedEntityId: undefined,
        incidentTypeId: undefined,
        incidentDate: new Date().toISOString().slice(0, 10),
        quantityLost: 0,
        position: undefined,
        impactsPickingList: false,
        status: "Open"
      }}
    />
  );
}
