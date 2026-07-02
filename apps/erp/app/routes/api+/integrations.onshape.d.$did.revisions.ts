import { requirePermissions } from "@carbon/auth/auth.server";
import { getOnshapeClient } from "@carbon/ee/onshape";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });

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
    // Resolve the Onshape company id (cid). Persisted in
    // companyIntegration.metadata.onshapeCompanyId at connect time; fall back to
    // getCompanies()[0] if absent.
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
        error: "No Onshape company found for this integration"
      };
    }

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
