import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { buildQwcFile, parseStoredCredentials } from "@carbon/ee/accounting";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
// Imported from the service file, not the ~/modules/settings barrel — the
// barrel re-exports ./ui and pulls a much larger type graph into this
// resource route (TS2589 doctrine, see ui/Integrations/index.ts).
import { getIntegration } from "~/modules/settings/settings.service";
import { path } from "~/utils/path";

/**
 * The QBWC SOAP endpoint path baked into the generated .qwc file as its
 * AppURL. The SOAP resource route lands in Task D9
 * (api+/integrations.quickbooks-desktop.qbwc); webhook-style API routes
 * don't get path.to entries (webhook.xero precedent), so the path is a
 * hardcoded constant here.
 */
const QBWC_ENDPOINT_PATH = "/api/integrations/quickbooks-desktop/qbwc";

/**
 * GET resource route (no default export) that downloads the QuickBooks Web
 * Connector .qwc descriptor for the company's quickbooks-desktop
 * connection. A resource route rather than an action intent because
 * attachment downloads only work on document requests — React Router
 * unwraps raw Responses returned from a UI route's action into action
 * data. Every Content-Disposition precedent in the app is a GET resource
 * loader (download.$token, api+/settings.backup-archive.$file, the
 * bom[.]csv routes).
 *
 * The .qwc carries the connection's username, OwnerID and FileID — never
 * the password (that is typed into QBWC once, from the shown-once display
 * on the Connection tab).
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const { id: integrationId } = params;
  if (integrationId !== "quickbooks-desktop") {
    throw new Response("Not found", { status: 404 });
  }

  const integration = await getIntegration(client, integrationId, companyId);
  if (integration.error || !integration.data || !integration.data.active) {
    throw redirect(
      path.to.integrations,
      await flash(
        request,
        error(integration.error, "QuickBooks Desktop is not installed")
      )
    );
  }

  const metadata = (integration.data.metadata as Record<string, unknown>) ?? {};

  let credentials: ReturnType<typeof parseStoredCredentials> | null = null;
  if (metadata.credentials) {
    try {
      credentials = parseStoredCredentials(metadata.credentials);
    } catch {
      credentials = null;
    }
  }

  if (
    !credentials ||
    credentials.type !== "webConnector" ||
    !credentials.fileId
  ) {
    throw redirect(
      path.to.integration(integrationId),
      await flash(
        request,
        error(
          null,
          "Generate connection credentials before downloading the .qwc file"
        )
      )
    );
  }

  let qwcXml: string;
  try {
    qwcXml = buildQwcFile({
      // Same absolute-URL construction as the OAuth flows
      // (integrations.xero.oauth.ts): the request origin + the endpoint
      // path. buildQwcFile asserts https (localhost exempt for dev).
      appUrl: `${new URL(request.url).origin}${QBWC_ENDPOINT_PATH}`,
      username: credentials.username,
      ownerId: credentials.ownerId,
      fileId: credentials.fileId
    });
  } catch (buildError) {
    throw redirect(
      path.to.integration(integrationId),
      await flash(request, error(buildError, "Failed to build the .qwc file"))
    );
  }

  return new Response(qwcXml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": 'attachment; filename="carbon-quickbooks.qwc"'
    }
  });
}
