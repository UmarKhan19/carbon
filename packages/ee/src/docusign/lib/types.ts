import { z } from "zod";

// -- OAuth credentials (stored in companyIntegration.metadata.credentials) --

export type DocuSignCredentials = {
  accessToken: string;
  refreshToken: string;
  /** Absolute timestamp in ms when the access token expires */
  expiresAt: number;
  /** The DocuSign account ID resolved from /oauth/userinfo */
  accountId: string;
  /** The base URI for REST API calls (e.g. https://demo.docusign.net/restapi) */
  accountBaseUri: string;
};

// -- Integration settings (stored in companyIntegration.metadata) --

export type DocuSignSettings = {
  credentials: DocuSignCredentials;
  webhookSecret?: string;
  environment: "sandbox" | "production";
};

// -- Base URL mapping by environment --

export const DOCUSIGN_BASE_URLS = {
  sandbox: "https://demo.docusign.net/restapi",
  production: "https://na1.docusign.net/restapi"
} as const;

// -- OAuth URL mapping by environment --

export const DOCUSIGN_OAUTH_URLS = {
  sandbox: "https://account-d.docusign.com",
  production: "https://account.docusign.com"
} as const;

// -- Envelope status --

export const DocuSignEnvelopeStatusEnum = z.enum([
  "created",
  "sent",
  "delivered",
  "signed",
  "completed",
  "declined",
  "voided"
]);

export type DocuSignEnvelopeStatus = z.infer<typeof DocuSignEnvelopeStatusEnum>;

// -- Document input (generic — works for POs, invoices, etc.) --

export type DocuSignDocumentInput = {
  /** Base64-encoded document content */
  documentBase64: string;
  /** Display name for the document */
  name: string;
  /** File extension (default: "pdf") */
  fileExtension?: string;
  /** Unique document ID within the envelope (default: "1") */
  documentId?: string;
};

// -- Signer input --

export type DocuSignSignerInput = {
  email: string;
  name: string;
  /** Unique recipient ID within the envelope (default: "1") */
  recipientId?: string;
  /** Routing order for sequential signing (default: "1") */
  routingOrder?: string;
  /** Optional anchor string for signature placement */
  anchorString?: string;
};

// -- Create envelope input --

export type DocuSignCreateEnvelopeInput = {
  emailSubject: string;
  emailBody?: string;
  documents: DocuSignDocumentInput[];
  signers: DocuSignSignerInput[];
  /** Envelope status on creation: "sent" to send immediately, "created" for draft */
  status?: "sent" | "created";
  /** Optional custom metadata for tracking (e.g., documentType, entityId) */
  customFields?: Record<string, string>;
};

// -- API response types --

export const DocuSignEnvelopeResponseSchema = z.object({
  envelopeId: z.string(),
  status: DocuSignEnvelopeStatusEnum,
  statusDateTime: z.string(),
  uri: z.string()
});

export type DocuSignEnvelopeResponse = z.infer<
  typeof DocuSignEnvelopeResponseSchema
>;

export const DocuSignSignerDetailSchema = z.object({
  name: z.string(),
  email: z.string(),
  status: z.string(),
  recipientId: z.string().optional(),
  routingOrder: z.string().optional(),
  signedDateTime: z.string().optional(),
  deliveredDateTime: z.string().optional(),
  declinedDateTime: z.string().optional(),
  declinedReason: z.string().optional()
});

export type DocuSignSignerDetail = z.infer<typeof DocuSignSignerDetailSchema>;

export const DocuSignEnvelopeDetailsSchema = z.object({
  envelopeId: z.string(),
  status: DocuSignEnvelopeStatusEnum,
  emailSubject: z.string(),
  sentDateTime: z.string().optional(),
  completedDateTime: z.string().optional(),
  voidedDateTime: z.string().optional(),
  voidedReason: z.string().optional(),
  recipients: z
    .object({
      signers: z.array(DocuSignSignerDetailSchema).optional()
    })
    .optional()
});

export type DocuSignEnvelopeDetails = z.infer<
  typeof DocuSignEnvelopeDetailsSchema
>;

// -- Webhook / Connect payload --

export const DocuSignWebhookPayloadSchema = z.object({
  event: z.string(),
  apiVersion: z.string().optional(),
  uri: z.string().optional(),
  retryCount: z.number().optional(),
  configurationId: z.coerce.string().optional(),
  generatedDateTime: z.string().optional(),
  data: z.object({
    accountId: z.string(),
    userId: z.string().optional(),
    envelopeId: z.string(),
    envelopeSummary: z
      .object({
        status: DocuSignEnvelopeStatusEnum,
        emailSubject: z.string().optional(),
        sentDateTime: z.string().optional(),
        completedDateTime: z.string().optional(),
        voidedDateTime: z.string().optional(),
        voidedReason: z.string().optional(),
        recipients: z
          .object({
            signers: z.array(DocuSignSignerDetailSchema).optional()
          })
          .optional()
      })
      .passthrough()
      .optional()
  })
});

export type DocuSignWebhookPayload = z.infer<
  typeof DocuSignWebhookPayloadSchema
>;

// -- Envelope mapping stored in externalIntegrationMapping.metadata --

export const DocuSignEnvelopeMappingSchema = z.object({
  envelopeId: z.string(),
  status: z.string(),
  signerName: z.string(),
  signerEmail: z.string(),
  subject: z.string(),
  sentAt: z.string().optional(),
  /** The type of document sent (e.g., "purchaseOrder", "salesOrder", "invoice") */
  documentType: z.string().optional()
});

export type DocuSignEnvelopeMapping = z.infer<
  typeof DocuSignEnvelopeMappingSchema
>;
