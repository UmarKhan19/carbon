import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

// Import the orchestrator DIRECTLY from its module path — NOT through the
// client-reachable plm barrel — because onshape-import.service.ts pulls in
// @carbon/ee/onshape (axios) + items.service and invokes edge functions, which
// is unsafe to bundle for the client (mirrors the plm.server.ts precedent).
import { importReleasedRevision } from "~/modules/plm/onshape-import.service";

// ECO-wrapped OnShape import action (Task 17). Auth is enforced here via
// requirePermissions (same scope as integrations.onshape.sync.ts: update parts);
// the orchestrator writes the change order under the SERVICE ROLE so the `sync`
// edge fn's own requirePermissions passes. Partial success is surfaced via the
// returned JSON (the single-object route returns the orchestrator's first error
// rather than throwing); on success it returns the created Draft change order
// uuid for the UI to redirect to path.to.changeOrder(id).
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  // Auth + tenancy: enforced at the route. companyId/userId scope every write.
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const documentId = formData.get("documentId");
  const versionId = formData.get("versionId"); // the sourceVid read-anchor
  const revisionId = formData.get("revisionId");
  const partNumber = formData.get("partNumber");
  // The OnShape literal revision label (e.g. "B") posted by the modal. Used as a
  // FALLBACK for the carbon revision label when getRevisionDetail.revision is
  // absent (the detail.revision field is unverified live — self-review #7).
  const revisionLabel = formData.get("revisionLabel");
  // Configuration fields — REQUIRED to import the correct (configured) BOM. If
  // dropped, a configured object silently imports the DEFAULT BOM. These are
  // optional on the form (unconfigured objects omit them) and flow through as a
  // fallback when getRevisionDetail does not echo them back.
  const configurationId = formData.get("configurationId");
  const fullConfiguration = formData.get("fullConfiguration");

  if (!documentId || !versionId || !revisionId) {
    return data(
      { success: false as const, message: "Missing required fields" },
      { status: 400 }
    );
  }

  // Refuse a null/blank Part Number (verbatim, spec §3.2 step 1). The UI echoes
  // this client-side, but the server is authoritative.
  if (!partNumber || (partNumber as string).trim() === "") {
    return data(
      {
        success: false as const,
        message: "OnShape object has no Part Number — release it first"
      },
      { status: 400 }
    );
  }

  // getCarbonServiceRole() is SYNCHRONOUS — do NOT await (client.server.ts
  // returns SupabaseClient<Database>, not a Promise). Pass the service-role
  // client to the orchestrator: it uses it for every PostgREST read/write AND
  // for the `sync` edge-fn invoke (service_role passes the edge fn's
  // requirePermissions).
  const serviceRole = getCarbonServiceRole();

  const result = await importReleasedRevision(serviceRole, {
    companyId,
    userId,
    documentId: documentId as string,
    sourceVid: versionId as string,
    revisionId: revisionId as string,
    partNumber: (partNumber as string).trim(),
    revisionLabel:
      typeof revisionLabel === "string" && revisionLabel.trim() !== ""
        ? revisionLabel.trim()
        : null,
    configurationId:
      typeof configurationId === "string" && configurationId.trim() !== ""
        ? configurationId
        : null,
    fullConfiguration:
      typeof fullConfiguration === "string" && fullConfiguration.trim() !== ""
        ? fullConfiguration
        : null
  });

  // Surface partial success / the orchestrator's first error rather than
  // throwing (the fan-out aggregates per-object errors[]; this single-object
  // route returns the one error for this revision).
  if (result.error || !result.data) {
    return data(
      {
        success: false as const,
        message: result.error?.message ?? "Failed to import OnShape revision"
      },
      { status: 400 }
    );
  }

  // result.data.changeOrderId is the change order ROW UUID — exactly what
  // path.to.changeOrder(id) expects. `warnings` carries NON-FATAL skips (e.g. a
  // drawing/geometry pull that timed out or found no drawing) so the modal can
  // surface them as a toast.warning while still landing on the Draft CO.
  return data({
    success: true as const,
    changeOrderId: result.data.changeOrderId,
    warnings: result.data.warnings ?? []
  });
}
