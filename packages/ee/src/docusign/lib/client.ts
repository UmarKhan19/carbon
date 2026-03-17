import {
  DOCUSIGN_CLIENT_ID,
  DOCUSIGN_CLIENT_SECRET,
  getCarbonServiceRole
} from "@carbon/auth";
import { getDocuSignIntegration, updateDocuSignCredentials } from "./service";
import type {
  DocuSignCreateEnvelopeInput,
  DocuSignCredentials,
  DocuSignEnvelopeDetails,
  DocuSignEnvelopeResponse,
  DocuSignSettings
} from "./types";
import { DOCUSIGN_OAUTH_URLS } from "./types";

// -- Standalone OAuth token functions --

/**
 * Exchange an authorization code for OAuth tokens.
 * Called from the OAuth callback route after user authorizes.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  environment: "sandbox" | "production" = "sandbox"
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} | null> {
  if (!DOCUSIGN_CLIENT_ID || !DOCUSIGN_CLIENT_SECRET) {
    console.error(
      "[DocuSign] Cannot exchange code: DOCUSIGN_CLIENT_ID or DOCUSIGN_CLIENT_SECRET not configured"
    );
    return null;
  }

  const oauthBaseUrl = DOCUSIGN_OAUTH_URLS[environment];
  const credentials = btoa(`${DOCUSIGN_CLIENT_ID}:${DOCUSIGN_CLIENT_SECRET}`);

  try {
    const response = await fetch(`${oauthBaseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      }).toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[DocuSign] Token exchange failed: ${response.status} ${response.statusText} — ${errorText}`
      );
      return null;
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  } catch (error) {
    console.error("[DocuSign] Token exchange exception:", error);
    return null;
  }
}

/**
 * Refresh an expired access token using a refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
  environment: "sandbox" | "production" = "sandbox"
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} | null> {
  if (!DOCUSIGN_CLIENT_ID || !DOCUSIGN_CLIENT_SECRET) {
    console.error(
      "[DocuSign] Cannot refresh token: DOCUSIGN_CLIENT_ID or DOCUSIGN_CLIENT_SECRET not configured"
    );
    return null;
  }

  const oauthBaseUrl = DOCUSIGN_OAUTH_URLS[environment];
  const credentials = btoa(`${DOCUSIGN_CLIENT_ID}:${DOCUSIGN_CLIENT_SECRET}`);

  try {
    const response = await fetch(`${oauthBaseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken
      }).toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[DocuSign] Token refresh failed: ${response.status} ${response.statusText} — ${errorText}`
      );
      return null;
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  } catch (error) {
    console.error("[DocuSign] Token refresh exception:", error);
    return null;
  }
}

/**
 * Get user info from DocuSign to resolve account ID and base URI.
 * Called after initial token exchange to determine which account to use.
 */
export async function getUserInfo(
  accessToken: string,
  environment: "sandbox" | "production" = "sandbox"
): Promise<{
  accountId: string;
  accountBaseUri: string;
  name: string;
  email: string;
} | null> {
  const oauthBaseUrl = DOCUSIGN_OAUTH_URLS[environment];

  try {
    const response = await fetch(`${oauthBaseUrl}/oauth/userinfo`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[DocuSign] getUserInfo failed: ${response.status} ${response.statusText} — ${errorText}`
      );
      return null;
    }

    const data = await response.json();
    const accounts = data.accounts as Array<{
      account_id: string;
      is_default: boolean;
      base_uri: string;
    }>;

    // Use the default account, or fall back to the first account
    const account = accounts?.find((a) => a.is_default) ?? accounts?.[0];

    if (!account) {
      console.error("[DocuSign] getUserInfo: no accounts found");
      return null;
    }

    return {
      accountId: account.account_id,
      accountBaseUri: `${account.base_uri}/restapi`,
      name: data.name ?? "",
      email: data.email ?? ""
    };
  } catch (error) {
    console.error("[DocuSign] getUserInfo exception:", error);
    return null;
  }
}

// -- DocuSign API Client --

/**
 * DocuSign eSignature REST API client.
 *
 * Uses OAuth Bearer token authentication with automatic token refresh.
 * Credentials are stored in `companyIntegration.metadata.credentials` per company.
 */
export class DocuSignClient {
  /**
   * Retrieve DocuSign settings for a company from the database.
   */
  async getSettings(companyId: string): Promise<DocuSignSettings> {
    const serviceRole = getCarbonServiceRole();
    const { data } = await getDocuSignIntegration(serviceRole, companyId);
    const integration = data?.[0];

    if (!integration) {
      throw new Error("DocuSign integration not found for company");
    }

    const metadata = integration.metadata as Record<string, unknown>;
    const credentials = metadata.credentials as DocuSignCredentials | undefined;

    if (!credentials?.accessToken || !credentials?.accountId) {
      throw new Error(
        "DocuSign integration is missing OAuth credentials. Please reconnect the integration."
      );
    }

    const environment =
      (metadata.environment as "sandbox" | "production") ?? "sandbox";

    return {
      credentials,
      webhookSecret: (metadata.webhookSecret as string) ?? undefined,
      environment
    };
  }

  /**
   * Get auth headers, refreshing the access token if it is expired or about to expire.
   * Uses a 5-minute buffer (same pattern as Jira).
   */
  private async getAuthHeaders(
    companyId: string,
    settings: DocuSignSettings
  ): Promise<{
    headers: Record<string, string>;
    credentials: DocuSignCredentials;
  }> {
    let { credentials } = settings;
    const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // 5 minutes

    if (credentials.expiresAt - Date.now() < TOKEN_REFRESH_BUFFER) {
      const refreshed = await refreshAccessToken(
        credentials.refreshToken,
        settings.environment
      );

      if (refreshed) {
        const newCredentials: DocuSignCredentials = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: Date.now() + refreshed.expiresIn * 1000,
          accountId: credentials.accountId,
          accountBaseUri: credentials.accountBaseUri
        };

        // Persist the new credentials
        const serviceRole = getCarbonServiceRole();
        await updateDocuSignCredentials(serviceRole, companyId, newCredentials);

        credentials = newCredentials;
      } else {
        console.warn(
          `[DocuSign] Token refresh failed for company ${companyId}, using existing token`
        );
      }
    }

    return {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      credentials
    };
  }

  /**
   * Make an authenticated request to the DocuSign eSignature REST API.
   */
  async request<T>(
    companyId: string,
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const settings = await this.getSettings(companyId);
    const { headers, credentials } = await this.getAuthHeaders(
      companyId,
      settings
    );

    const url = `${credentials.accountBaseUri}/v2.1/accounts/${credentials.accountId}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options?.headers || {})
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[DocuSign] API error (${path}):`,
        response.status,
        errorText
      );
      throw new Error(
        `DocuSign API error: ${response.status} ${response.statusText}`
      );
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  /**
   * Create and send an envelope with documents for signing.
   *
   * Accepts generic document input so this can be used for POs, invoices, etc.
   */
  async createEnvelope(
    companyId: string,
    input: DocuSignCreateEnvelopeInput
  ): Promise<DocuSignEnvelopeResponse | null> {
    try {
      const documents = input.documents.map((doc, index) => ({
        documentBase64: doc.documentBase64,
        name: doc.name,
        fileExtension: doc.fileExtension ?? "pdf",
        documentId: doc.documentId ?? String(index + 1)
      }));

      const signers = input.signers.map((signer, index) => ({
        email: signer.email,
        name: signer.name,
        recipientId: signer.recipientId ?? String(index + 1),
        routingOrder: signer.routingOrder ?? String(index + 1),
        tabs: {
          signHereTabs: [
            {
              anchorString: signer.anchorString ?? "/sig1/",
              anchorUnits: "pixels",
              anchorXOffset: "0",
              anchorYOffset: "0"
            }
          ]
        }
      }));

      const body: Record<string, unknown> = {
        emailSubject: input.emailSubject,
        emailBlurb: input.emailBody ?? "",
        documents,
        recipients: { signers },
        status: input.status ?? "sent"
      };

      if (input.customFields) {
        body.customFields = {
          textCustomFields: Object.entries(input.customFields).map(
            ([name, value]) => ({
              name,
              value,
              show: "false"
            })
          )
        };
      }

      return await this.request<DocuSignEnvelopeResponse>(
        companyId,
        "/envelopes",
        {
          method: "POST",
          body: JSON.stringify(body)
        }
      );
    } catch (e) {
      console.error("[DocuSign] Error creating envelope:", e);
      return null;
    }
  }

  /**
   * Get envelope status and details including recipient information.
   */
  async getEnvelopeStatus(
    companyId: string,
    envelopeId: string
  ): Promise<DocuSignEnvelopeDetails | null> {
    try {
      return await this.request<DocuSignEnvelopeDetails>(
        companyId,
        `/envelopes/${envelopeId}?include=recipients`
      );
    } catch (e) {
      console.error("[DocuSign] Error getting envelope status:", e);
      return null;
    }
  }

  /**
   * Download the signed/completed document from an envelope.
   *
   * Returns the document as an ArrayBuffer (raw PDF bytes).
   * Pass documentId "combined" to get all documents merged into one PDF.
   */
  async getEnvelopeDocument(
    companyId: string,
    envelopeId: string,
    documentId = "combined"
  ): Promise<ArrayBuffer | null> {
    try {
      const settings = await this.getSettings(companyId);
      const { headers, credentials } = await this.getAuthHeaders(
        companyId,
        settings
      );

      const url = `${credentials.accountBaseUri}/v2.1/accounts/${credentials.accountId}/envelopes/${envelopeId}/documents/${documentId}`;

      const { "Content-Type": _, ...getHeaders } = headers;
      const response = await fetch(url, {
        headers: {
          ...getHeaders,
          Accept: "application/pdf"
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "[DocuSign] Error downloading document:",
          response.status,
          errorText
        );
        return null;
      }

      return await response.arrayBuffer();
    } catch (e) {
      console.error("[DocuSign] Error downloading document:", e);
      return null;
    }
  }

  /**
   * Void an envelope that has been sent but not yet completed.
   */
  async voidEnvelope(
    companyId: string,
    envelopeId: string,
    reason: string
  ): Promise<boolean> {
    try {
      await this.request(companyId, `/envelopes/${envelopeId}`, {
        method: "PUT",
        body: JSON.stringify({
          status: "voided",
          voidedReason: reason
        })
      });
      return true;
    } catch (e) {
      console.error("[DocuSign] Error voiding envelope:", e);
      return false;
    }
  }

  /**
   * Resend envelope notification to recipients.
   */
  async resendEnvelope(
    companyId: string,
    envelopeId: string
  ): Promise<boolean> {
    try {
      await this.request(
        companyId,
        `/envelopes/${envelopeId}?resend_envelope=true`,
        {
          method: "PUT",
          body: JSON.stringify({})
        }
      );
      return true;
    } catch (e) {
      console.error("[DocuSign] Error resending envelope:", e);
      return false;
    }
  }

  /**
   * Health check — verify the integration credentials are valid by fetching account info.
   */
  async healthcheck(companyId: string): Promise<boolean> {
    try {
      await this.request(companyId, "");
      return true;
    } catch {
      return false;
    }
  }
}

let instance: DocuSignClient | null = null;

export const getDocuSignClient = () => {
  if (!instance) instance = new DocuSignClient();
  return instance;
};
