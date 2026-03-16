import {
  DOCUSIGN_CLIENT_ID,
  DOCUSIGN_CLIENT_SECRET,
  getCarbonServiceRole
} from "@carbon/auth";
import { getDocuSignIntegration, updateDocuSignCredentials } from "./service";
import type {
  DocuSignCredentials,
  DocuSignEnvelopeDetails,
  DocuSignEnvelopeResponse,
  DocuSignTokenResponse,
  DocuSignUserInfoResponse
} from "./types";

const DOCUSIGN_AUTH_URL = "https://account-d.docusign.com";
const DOCUSIGN_OAUTH_TOKEN_URL = `${DOCUSIGN_AUTH_URL}/oauth/token`;
const DOCUSIGN_USERINFO_URL = `${DOCUSIGN_AUTH_URL}/oauth/userinfo`;

/**
 * Exchange authorization code for access and refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} | null> {
  try {
    const credentials = btoa(`${DOCUSIGN_CLIENT_ID}:${DOCUSIGN_CLIENT_SECRET}`);

    const response = await fetch(DOCUSIGN_OAUTH_TOKEN_URL, {
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
      console.error(
        "Failed to exchange DocuSign code for tokens:",
        response.status,
        await response.text()
      );
      return null;
    }

    const data = (await response.json()) as DocuSignTokenResponse;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  } catch (e) {
    console.error("Error exchanging DocuSign code for tokens:", e);
    return null;
  }
}

/**
 * Refresh access token using refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} | null> {
  try {
    const credentials = btoa(`${DOCUSIGN_CLIENT_ID}:${DOCUSIGN_CLIENT_SECRET}`);

    const response = await fetch(DOCUSIGN_OAUTH_TOKEN_URL, {
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
      console.error(
        "Failed to refresh DocuSign token:",
        response.status,
        await response.text()
      );
      return null;
    }

    const data = (await response.json()) as DocuSignTokenResponse;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  } catch (e) {
    console.error("Error refreshing DocuSign token:", e);
    return null;
  }
}

/**
 * Get user info including account details.
 */
export async function getUserInfo(
  accessToken: string
): Promise<DocuSignUserInfoResponse | null> {
  try {
    const response = await fetch(DOCUSIGN_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      console.error(
        "Failed to get DocuSign user info:",
        response.status,
        await response.text()
      );
      return null;
    }

    return (await response.json()) as DocuSignUserInfoResponse;
  } catch (e) {
    console.error("Error getting DocuSign user info:", e);
    return null;
  }
}

/**
 * DocuSign eSignature API client.
 */
export class DocuSignClient {
  /**
   * Get authentication headers, refreshing token if needed.
   */
  async getAuthHeaders(companyId: string): Promise<{
    headers: Record<string, string>;
    credentials: DocuSignCredentials;
  }> {
    const serviceRole = getCarbonServiceRole();
    const { data } = await getDocuSignIntegration(serviceRole, companyId);
    const integration = data?.[0];

    if (!integration) {
      throw new Error("DocuSign integration not found for company");
    }

    const metadata = integration.metadata as {
      credentials: DocuSignCredentials;
    };
    const credentials = metadata.credentials;

    // Check if token needs refresh (5 min buffer)
    const now = Date.now();
    if (credentials.expiresAt - now < 5 * 60 * 1000) {
      const refreshed = await refreshAccessToken(credentials.refreshToken);
      if (refreshed) {
        const newCredentials: DocuSignCredentials = {
          ...credentials,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: now + refreshed.expiresIn * 1000
        };

        await updateDocuSignCredentials(serviceRole, companyId, newCredentials);

        return {
          headers: {
            Authorization: `Bearer ${refreshed.accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          credentials: newCredentials
        };
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
   * Make an API request to DocuSign eSignature REST API.
   */
  async request<T>(
    companyId: string,
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const { headers, credentials } = await this.getAuthHeaders(companyId);
    const baseUri = credentials.baseUri;
    const accountId = credentials.accountId;

    const response = await fetch(
      `${baseUri}/restapi/v2.1/accounts/${accountId}${path}`,
      {
        ...options,
        headers: {
          ...headers,
          ...(options?.headers || {})
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `DocuSign API error (${path}):`,
        response.status,
        errorText
      );
      throw new Error(`DocuSign API error: ${response.status}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  /**
   * Create and send an envelope with a document for signing.
   */
  async createEnvelope(
    companyId: string,
    input: {
      documentBase64: string;
      documentName: string;
      signerName: string;
      signerEmail: string;
      emailSubject: string;
      emailBody?: string;
    }
  ): Promise<DocuSignEnvelopeResponse | null> {
    try {
      return await this.request<DocuSignEnvelopeResponse>(
        companyId,
        "/envelopes",
        {
          method: "POST",
          body: JSON.stringify({
            emailSubject: input.emailSubject,
            emailBlurb: input.emailBody ?? "",
            documents: [
              {
                documentBase64: input.documentBase64,
                name: input.documentName,
                fileExtension: "pdf",
                documentId: "1"
              }
            ],
            recipients: {
              signers: [
                {
                  email: input.signerEmail,
                  name: input.signerName,
                  recipientId: "1",
                  routingOrder: "1",
                  tabs: {
                    signHereTabs: [
                      {
                        anchorString: "/sig1/",
                        anchorUnits: "pixels",
                        anchorXOffset: "0",
                        anchorYOffset: "0"
                      }
                    ]
                  }
                }
              ]
            },
            status: "sent"
          })
        }
      );
    } catch (e) {
      console.error("Error creating DocuSign envelope:", e);
      return null;
    }
  }

  /**
   * Get envelope details/status.
   */
  async getEnvelope(
    companyId: string,
    envelopeId: string
  ): Promise<DocuSignEnvelopeDetails | null> {
    try {
      return await this.request<DocuSignEnvelopeDetails>(
        companyId,
        `/envelopes/${envelopeId}?include=recipients`
      );
    } catch (e) {
      console.error("Error getting DocuSign envelope:", e);
      return null;
    }
  }

  /**
   * Void an envelope that has been sent.
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
      console.error("Error voiding DocuSign envelope:", e);
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
      console.error("Error resending DocuSign envelope:", e);
      return false;
    }
  }

  /**
   * Health check - verify the integration is working.
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
