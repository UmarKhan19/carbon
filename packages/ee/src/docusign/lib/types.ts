import { z } from "zod";

export type DocuSignCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
  baseUri: string;
};

export type DocuSignEnvelopeStatus =
  | "created"
  | "sent"
  | "delivered"
  | "signed"
  | "completed"
  | "declined"
  | "voided";

export type DocuSignEnvelopeResponse = {
  envelopeId: string;
  status: DocuSignEnvelopeStatus;
  statusDateTime: string;
  uri: string;
};

export type DocuSignEnvelopeDetails = {
  envelopeId: string;
  status: DocuSignEnvelopeStatus;
  emailSubject: string;
  sentDateTime?: string;
  completedDateTime?: string;
  voidedDateTime?: string;
  voidedReason?: string;
  recipients?: {
    signers?: Array<{
      name: string;
      email: string;
      status: string;
      signedDateTime?: string;
      declinedDateTime?: string;
      declinedReason?: string;
    }>;
  };
};

export type DocuSignTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
};

export type DocuSignUserInfoResponse = {
  sub: string;
  name: string;
  email: string;
  accounts: Array<{
    account_id: string;
    is_default: boolean;
    account_name: string;
    base_uri: string;
  }>;
};

export const DocuSignEnvelopeMappingSchema = z.object({
  envelopeId: z.string(),
  status: z.string(),
  signerName: z.string(),
  signerEmail: z.string(),
  subject: z.string(),
  sentAt: z.string().optional()
});

export type DocuSignEnvelopeMapping = z.infer<
  typeof DocuSignEnvelopeMappingSchema
>;
