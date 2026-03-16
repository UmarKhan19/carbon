import { VERCEL_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getIntegrationConfigById } from "@carbon/ee";
import { exchangeCodeForTokens, getUserInfo } from "@carbon/ee/docusign";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const authResponse = oAuthCallbackSchema.safeParse(searchParams);

  if (!authResponse.success) {
    return data({ error: "Invalid DocuSign auth response" }, { status: 400 });
  }

  const { data: params } = authResponse;

  if (!params.state) {
    return data({ error: "Invalid state parameter" }, { status: 400 });
  }

  try {
    const redirectUri = `${url.origin}/api/integrations/docusign/oauth`;

    // Exchange the authorization code for tokens
    const tokens = await exchangeCodeForTokens(params.code, redirectUri);

    if (!tokens) {
      return data(
        { error: "Failed to exchange code for token" },
        { status: 500 }
      );
    }

    // Get user info to find account ID and base URI
    const userInfo = await getUserInfo(tokens.accessToken);

    if (!userInfo || userInfo.accounts.length === 0) {
      return data(
        {
          error:
            "No DocuSign accounts found. Make sure you have access to at least one DocuSign account."
        },
        { status: 400 }
      );
    }

    // Use the default account, or the first available one
    const account =
      userInfo.accounts.find((a) => a.is_default) ?? userInfo.accounts[0];

    const createdIntegration = await upsertCompanyIntegration(client, {
      id: "docusign",
      active: true,
      metadata: {
        credentials: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
          accountId: account.account_id,
          baseUri: account.base_uri
        }
      },
      updatedBy: userId,
      companyId: companyId
    });

    const integrationConfig = getIntegrationConfigById("docusign");

    typeof integrationConfig?.onInstall === "function" &&
      (await integrationConfig.onInstall(companyId));

    if (createdIntegration?.data?.metadata) {
      const requestUrl = new URL(request.url);

      if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
        requestUrl.protocol = "http";
      }

      const redirectUrl = `${requestUrl.origin}${path.to.integrations}`;

      return redirect(redirectUrl);
    }

    return data(
      { error: "Failed to save DocuSign integration" },
      { status: 500 }
    );
  } catch (err) {
    console.error("DocuSign OAuth Error:", err);
    return data(
      { error: "Failed to exchange code for token" },
      { status: 500 }
    );
  }
}
