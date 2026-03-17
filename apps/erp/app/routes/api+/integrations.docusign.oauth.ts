import {
  DOCUSIGN_CLIENT_ID,
  DOCUSIGN_CLIENT_SECRET,
  VERCEL_URL
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
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

  if (!DOCUSIGN_CLIENT_ID || !DOCUSIGN_CLIENT_SECRET) {
    return data(
      { error: "DocuSign integration is not configured" },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const docuSignAuthResponse = oAuthCallbackSchema.safeParse(searchParams);

  if (!docuSignAuthResponse.success) {
    return data({ error: "Invalid DocuSign auth response" }, { status: 400 });
  }

  const { data: params } = docuSignAuthResponse;

  if (!params.state) {
    return data({ error: "Invalid state parameter" }, { status: 400 });
  }

  try {
    const redirectUri = `${url.origin}/api/integrations/docusign/oauth`;

    // Read the stored environment setting, defaulting to sandbox
    const existingIntegration = await client
      .from("companyIntegration")
      .select("metadata")
      .eq("companyId", companyId)
      .eq("id", "docusign")
      .maybeSingle();

    const existingMetadata =
      (existingIntegration?.data?.metadata as Record<string, unknown>) ?? {};
    const environment =
      (existingMetadata.environment as "sandbox" | "production") ?? "sandbox";

    // Exchange the authorization code for tokens
    const tokens = await exchangeCodeForTokens(
      params.code,
      redirectUri,
      environment
    );

    if (!tokens) {
      return data(
        { error: "Failed to exchange code for token" },
        { status: 500 }
      );
    }

    // Get user info to resolve account ID and base URI
    const userInfo = await getUserInfo(tokens.accessToken, environment);

    if (!userInfo) {
      return data(
        {
          error:
            "Failed to get DocuSign account info. Make sure you have access to at least one DocuSign account."
        },
        { status: 400 }
      );
    }

    const createdIntegration = await upsertCompanyIntegration(client, {
      id: "docusign",
      active: true,
      metadata: {
        ...existingMetadata,
        credentials: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
          accountId: userInfo.accountId,
          accountBaseUri: userInfo.accountBaseUri
        }
      },
      updatedBy: userId,
      companyId: companyId
    });

    if (createdIntegration?.data?.metadata) {
      const requestUrl = new URL(request.url);

      if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
        requestUrl.protocol = "http";
      }

      const redirectUrl = `${requestUrl.origin}${path.to.integrations}`;

      return redirect(redirectUrl);
    } else {
      return data(
        { error: "Failed to save DocuSign integration" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[DocuSign] OAuth Error:", err);
    return data(
      { error: "Failed to exchange code for token" },
      { status: 500 }
    );
  }
}
