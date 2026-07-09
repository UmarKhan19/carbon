import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

// Import DIRECTLY from the module path, not the client-reachable plm barrel:
// onshape-import.service.ts pulls in @carbon/ee/onshape (axios) + edge-fn invokes
// that are unsafe to bundle for the client.
import { importReleasedRevision } from "~/modules/items/onshape-import.server";

// The orchestrator writes under the service role (so the `sync` edge fn's own
// requirePermissions passes); this route is the auth gate.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const { companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const documentId = formData.get("documentId");
  const versionId = formData.get("versionId");
  const revisionId = formData.get("revisionId");
  const partNumber = formData.get("partNumber");
  const revisionLabel = formData.get("revisionLabel");
  // Configuration fields flow through as a fallback when getRevisionDetail
  // doesn't echo them — without them a configured object imports the default BOM.
  const configurationId = formData.get("configurationId");
  const fullConfiguration = formData.get("fullConfiguration");

  if (!documentId || !versionId || !revisionId) {
    return data(
      { success: false as const, message: "Missing required fields" },
      { status: 400 }
    );
  }

  // The UI guards this too, but the server is authoritative.
  if (!partNumber || (partNumber as string).trim() === "") {
    return data(
      {
        success: false as const,
        message: "OnShape object has no Part Number — release it first"
      },
      { status: 400 }
    );
  }

  // getCarbonServiceRole() is synchronous — do NOT await it.
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

  if (result.error || !result.data) {
    return data(
      {
        success: false as const,
        message: result.error?.message ?? "Failed to import OnShape revision"
      },
      { status: 400 }
    );
  }

  // TODO(change-orders): re-point Onshape import at the standalone module
  // (Phase 4). V1 returns the imported item id; there is no change order yet.
  return data({
    success: true as const,
    itemId: result.data.itemId,
    warnings: result.data.warnings ?? []
  });
}
