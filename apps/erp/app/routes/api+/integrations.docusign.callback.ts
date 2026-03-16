import { VERCEL_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { DocuSign } from "@carbon/ee";
import {
  docuSignOAuthCallbackSchema,
  exchangeDocuSignCode,
  verifyDocuSignState
} from "@carbon/ee/docusign.server";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const docuSignAuthResponse =
    docuSignOAuthCallbackSchema.safeParse(searchParams);

  if (!docuSignAuthResponse.success) {
    return data({ error: "Invalid DocuSign auth response" }, { status: 400 });
  }

  // Verify state if provided
  if (docuSignAuthResponse.data.state) {
    const stateData = verifyDocuSignState(docuSignAuthResponse.data.state);
    if (!stateData) {
      return data({ error: "Invalid or expired state" }, { status: 400 });
    }

    if (stateData.companyId !== companyId) {
      return data({ error: "Invalid company" }, { status: 400 });
    }

    if (stateData.userId !== userId) {
      return data({ error: "Invalid user" }, { status: 400 });
    }
  }

  try {
    const tokenData = await exchangeDocuSignCode(docuSignAuthResponse.data.code);

    const createdDocuSignIntegration = await upsertCompanyIntegration(client, {
      id: DocuSign.id,
      active: true,
      metadata: {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresIn: tokenData.expiresIn,
        accountId: tokenData.accountId,
        baseUri: tokenData.baseUri,
        userEmail: tokenData.userEmail,
        userName: tokenData.userName,
        tokenCreatedAt: new Date().toISOString()
      },
      updatedBy: userId,
      companyId: companyId
    });

    if (createdDocuSignIntegration?.data) {
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
    console.error("DocuSign OAuth error:", err);
    return data(
      {
        error:
          err instanceof Error ? err.message : "Failed to exchange code for token"
      },
      { status: 500 }
    );
  }
}
