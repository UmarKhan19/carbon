import {
  DOCUSIGN_ACCOUNT_ID,
  DOCUSIGN_INTEGRATION_KEY,
  DOCUSIGN_SECRET_KEY,
  getCarbonServiceRole
} from "@carbon/auth";
import axios, { type AxiosInstance } from "axios";
import { getDocuSignIntegration } from "./service";

export interface DocuSignEnvelope {
  envelopeId: string;
  status: string;
  statusDateTime: string;
  uri: string;
}

export interface DocuSignRecipient {
  email: string;
  name: string;
  recipientId: string;
  routingOrder?: string;
}

export interface DocuSignDocument {
  documentBase64: string;
  documentId: string;
  fileExtension: string;
  name: string;
}

export interface CreateEnvelopeRequest {
  emailSubject: string;
  documents: DocuSignDocument[];
  recipients: {
    signers: Array<
      DocuSignRecipient & {
        tabs?: {
          signHereTabs?: Array<{
            anchorString?: string;
            anchorUnits?: string;
            anchorXOffset?: string;
            anchorYOffset?: string;
            documentId?: string;
            pageNumber?: string;
            xPosition?: string;
            yPosition?: string;
          }>;
        };
      }
    >;
  };
  status: "sent" | "created";
}

export interface EnvelopeStatusResponse {
  envelopeId: string;
  status: string;
  statusChangedDateTime: string;
  sentDateTime?: string;
  deliveredDateTime?: string;
  completedDateTime?: string;
  voidedDateTime?: string;
  declinedDateTime?: string;
  recipients?: {
    signers: Array<{
      email: string;
      name: string;
      status: string;
      signedDateTime?: string;
      deliveredDateTime?: string;
    }>;
  };
}

export class DocuSignClient {
  private instance: AxiosInstance;
  private baseUrl: string;
  private accountId: string;

  constructor() {
    // Use demo environment by default, can be made configurable
    this.baseUrl = "https://demo.docusign.net/restapi";
    this.accountId = DOCUSIGN_ACCOUNT_ID ?? "";
    this.instance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  private async getAuthHeaders(companyId: string) {
    const serviceRole = getCarbonServiceRole();
    const { data } = await getDocuSignIntegration(serviceRole, companyId);

    const integration = data?.[0];

    if (!integration) {
      throw new Error("DocuSign integration not found for company");
    }

    const metadata = integration.metadata as { accessToken: string };

    if (!metadata.accessToken) {
      throw new Error("DocuSign access token not found");
    }

    return {
      Authorization: `Bearer ${metadata.accessToken}`
    };
  }

  async healthcheck(companyId: string): Promise<boolean> {
    try {
      const response = await this.instance.request({
        method: "GET",
        url: `/v2.1/accounts/${this.accountId}`,
        headers: await this.getAuthHeaders(companyId)
      });

      return response.status === 200;
    } catch {
      return false;
    }
  }

  async createEnvelope(
    companyId: string,
    request: CreateEnvelopeRequest
  ): Promise<DocuSignEnvelope> {
    const response = await this.instance.request<DocuSignEnvelope>({
      method: "POST",
      url: `/v2.1/accounts/${this.accountId}/envelopes`,
      headers: await this.getAuthHeaders(companyId),
      data: request
    });

    return response.data;
  }

  async getEnvelopeStatus(
    companyId: string,
    envelopeId: string
  ): Promise<EnvelopeStatusResponse> {
    const response = await this.instance.request<EnvelopeStatusResponse>({
      method: "GET",
      url: `/v2.1/accounts/${this.accountId}/envelopes/${envelopeId}`,
      headers: await this.getAuthHeaders(companyId),
      params: {
        include: "recipients"
      }
    });

    return response.data;
  }

  async voidEnvelope(
    companyId: string,
    envelopeId: string,
    voidReason: string
  ): Promise<void> {
    await this.instance.request({
      method: "PUT",
      url: `/v2.1/accounts/${this.accountId}/envelopes/${envelopeId}`,
      headers: await this.getAuthHeaders(companyId),
      data: {
        status: "voided",
        voidedReason: voidReason
      }
    });
  }

  async resendEnvelope(companyId: string, envelopeId: string): Promise<void> {
    await this.instance.request({
      method: "PUT",
      url: `/v2.1/accounts/${this.accountId}/envelopes/${envelopeId}`,
      headers: await this.getAuthHeaders(companyId),
      params: {
        resend_envelope: "true"
      }
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }> {
    const credentials = Buffer.from(
      `${DOCUSIGN_INTEGRATION_KEY}:${DOCUSIGN_SECRET_KEY}`
    ).toString("base64");

    const response = await axios.post(
      "https://account-d.docusign.com/oauth/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken
      }),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    return response.data;
  }
}

let instance: DocuSignClient | null = null;

export const getDocuSignClient = () => {
  if (!instance) instance = new DocuSignClient();
  return instance;
};
