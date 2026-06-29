import { requirePermissions } from "@carbon/auth/auth.server";
import { getOnshapeClient } from "@carbon/ee/onshape";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};

// Released-revisions browse loader (Task 17). Lists the released objects of a
// single OnShape document for the release picker. Auth is enforced here via
// requirePermissions; the browse routes use empty perms (mirrors
// integrations.onshape.documents.ts) and operate within the authed companyId.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const { did } = params;
  if (!did) {
    return {
      data: [],
      error: "Document ID is required"
    };
  }

  const result = await getOnshapeClient(client, companyId, userId);

  if (result.error) {
    return {
      data: [],
      error: result.error
    };
  }

  const onshapeClient = result.client;

  try {
    // Resolve the OnShape company id (cid) the Revisions API needs. It is
    // persisted into companyIntegration.metadata.onshapeCompanyId at connect
    // time (integrations.onshape.oauth.ts); fall back to getCompanies()[0] if
    // absent (e.g. integrations connected before that step landed).
    const integration = await client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", "onshape")
      .eq("companyId", companyId)
      .maybeSingle();

    const metadata =
      integration.data?.metadata &&
      typeof integration.data.metadata === "object" &&
      !Array.isArray(integration.data.metadata)
        ? (integration.data.metadata as Record<string, unknown>)
        : {};

    let cid =
      typeof metadata.onshapeCompanyId === "string"
        ? metadata.onshapeCompanyId
        : null;

    if (!cid) {
      const companies = await onshapeClient.getCompanies();
      cid = companies.items?.[0]?.id ?? null;
    }

    if (!cid) {
      return {
        data: [],
        error: "No OnShape company found for this integration"
      };
    }

    // VERIFY-LIVE: getAllReleasedRevisions path/params + the per-revision field
    // shape (documentId, versionId, revision, elementId, configurationId,
    // fullConfiguration) are Glassworks-documented but unconfirmed in this repo —
    // diff against a live response.
    const all = await onshapeClient.getAllReleasedRevisions(cid, {
      latestOnly: true
    });

    const rows = all
      .filter((r) => r.documentId === did)
      .map((r) => ({
        id: r.id,
        partNumber: r.partNumber,
        revisionLabel: r.revision,
        name: r.name ?? "",
        elementId: r.elementId ?? null,
        sourceVid: r.versionId,
        configurationId: r.configurationId ?? null,
        fullConfiguration: r.fullConfiguration ?? null,
        state: "Released" as const
      }));

    return {
      data: rows,
      error: null
    };
  } catch (error) {
    console.error(error);
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get revisions from Onshape"
    };
  }
}
