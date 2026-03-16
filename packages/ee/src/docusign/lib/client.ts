import { getCarbonServiceRole } from "@carbon/auth";
import { getDocuSignIntegration } from "./service";
import type {
  DocuSignCreateEnvelopeInput,
  DocuSignEnvelopeDetails,
  DocuSignEnvelopeResponse,
  DocuSignSettings
} from "./types";
import { DOCUSIGN_BASE_URLS } from "./types";

/**
 * DocuSign eSignature REST API client.
 *
 * Uses API key-based authentication (Integration Key + Secret Key) with Basic Auth.
 * Settings are stored in `companyIntegration.metadata` per company.
 *
 * Designed to accept generic document buffers + metadata so it can be reused
 * for document types beyond Purchase Orders (e.g., invoices, sales orders).
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

    const integrationKey = metadata.integrationKey as string | undefined;
    const secretKey = metadata.secretKey as string | undefined;
    const accountId = metadata.accountId as string | undefined;
    const environment =
      (metadata.environment as "sandbox" | "production") ?? "sandbox";

    if (!integrationKey || !secretKey || !accountId) {
      throw new Error(
        "DocuSign integration is missing required settings (integrationKey, secretKey, accountId)"
      );
    }

    return {
      integrationKey,
      secretKey,
      accountId,
      webhookSecret: (metadata.webhookSecret as string) ?? undefined,
      environment
    };
  }

  /**
   * Build authentication headers using Basic Auth (Integration Key + Secret Key).
   */
  private buildAuthHeaders(settings: DocuSignSettings): Record<string, string> {
    const credentials = btoa(
      `${settings.integrationKey}:${settings.secretKey}`
    );
    return {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    };
  }

  /**
   * Resolve the base API URL for a given environment.
   */
  private getBaseUrl(environment: "sandbox" | "production"): string {
    return DOCUSIGN_BASE_URLS[environment];
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
    const baseUrl = this.getBaseUrl(settings.environment);
    const headers = this.buildAuthHeaders(settings);

    const url = `${baseUrl}/v2.1/accounts/${settings.accountId}${path}`;

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
        `DocuSign API error (${path}):`,
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
      console.error("Error creating DocuSign envelope:", e);
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
      console.error("Error getting DocuSign envelope status:", e);
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
      const baseUrl = this.getBaseUrl(settings.environment);
      const credentials = btoa(
        `${settings.integrationKey}:${settings.secretKey}`
      );

      const url = `${baseUrl}/v2.1/accounts/${settings.accountId}/envelopes/${envelopeId}/documents/${documentId}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: "application/pdf"
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "Error downloading DocuSign document:",
          response.status,
          errorText
        );
        return null;
      }

      return await response.arrayBuffer();
    } catch (e) {
      console.error("Error downloading DocuSign document:", e);
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
   * Health check — verify the integration settings are valid by fetching account info.
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
