import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getDocuSignClient, type EnvelopeStatusResponse } from "./client";

export const DocuSignEnvelopeSchema = z.object({
  envelopeId: z.string(),
  status: z.string(),
  statusDateTime: z.string(),
  purchaseOrderId: z.string(),
  signerEmail: z.string(),
  signerName: z.string()
});

export type DocuSignEnvelopeData = z.infer<typeof DocuSignEnvelopeSchema>;

export async function getDocuSignIntegration(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return await client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId)
    .eq("id", "docusign")
    .limit(1);
}

export async function sendPurchaseOrderForSignature(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    purchaseOrderId: string;
    pdfBase64: string;
    signerEmail: string;
    signerName: string;
    emailSubject?: string;
  }
) {
  const docuSignClient = getDocuSignClient();

  const envelope = await docuSignClient.createEnvelope(companyId, {
    emailSubject:
      input.emailSubject ??
      `Please sign Purchase Order ${input.purchaseOrderId}`,
    documents: [
      {
        documentBase64: input.pdfBase64,
        documentId: "1",
        fileExtension: "pdf",
        name: `${input.purchaseOrderId}.pdf`
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
                documentId: "1",
                pageNumber: "1",
                xPosition: "400",
                yPosition: "700"
              }
            ]
          }
        }
      ]
    },
    status: "sent"
  });

  // Store the envelope mapping in externalIntegrationMapping
  const serviceRole = getCarbonServiceRole();

  // Remove any existing DocuSign mapping for this purchase order
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", "purchaseOrder")
    .eq("entityId", input.purchaseOrderId)
    .eq("integration", "docusign");

  // Insert new mapping
  await client.from("externalIntegrationMapping").insert({
    entityType: "purchaseOrder",
    entityId: input.purchaseOrderId,
    integration: "docusign",
    externalId: envelope.envelopeId,
    metadata: {
      envelopeId: envelope.envelopeId,
      status: envelope.status,
      statusDateTime: envelope.statusDateTime,
      purchaseOrderId: input.purchaseOrderId,
      signerEmail: input.signerEmail,
      signerName: input.signerName
    } as DocuSignEnvelopeData,
    companyId
  });

  return envelope;
}

export async function getSignatureStatus(
  client: SupabaseClient<Database>,
  companyId: string,
  purchaseOrderId: string
): Promise<EnvelopeStatusResponse | null> {
  // Get the envelope mapping
  const { data: mapping } = await client
    .from("externalIntegrationMapping")
    .select("externalId, metadata")
    .eq("entityType", "purchaseOrder")
    .eq("entityId", purchaseOrderId)
    .eq("integration", "docusign")
    .eq("companyId", companyId)
    .maybeSingle();

  if (!mapping?.externalId) return null;

  const docuSignClient = getDocuSignClient();
  const status = await docuSignClient.getEnvelopeStatus(
    companyId,
    mapping.externalId
  );

  // Update the stored metadata with latest status
  const serviceRole = getCarbonServiceRole();
  const existingMetadata = mapping.metadata as DocuSignEnvelopeData;

  await serviceRole
    .from("externalIntegrationMapping")
    .update({
      metadata: {
        ...existingMetadata,
        status: status.status,
        statusDateTime: status.statusChangedDateTime
      }
    })
    .eq("entityType", "purchaseOrder")
    .eq("entityId", purchaseOrderId)
    .eq("integration", "docusign")
    .eq("companyId", companyId);

  return status;
}

export async function getDocuSignEnvelopeFromPurchaseOrder(
  client: SupabaseClient<Database>,
  companyId: string,
  purchaseOrderId: string
): Promise<DocuSignEnvelopeData | null> {
  const { data: mapping } = await client
    .from("externalIntegrationMapping")
    .select("metadata")
    .eq("entityType", "purchaseOrder")
    .eq("entityId", purchaseOrderId)
    .eq("integration", "docusign")
    .eq("companyId", companyId)
    .maybeSingle();

  if (!mapping) return null;

  const { data } = DocuSignEnvelopeSchema.safeParse(mapping.metadata);

  return data ?? null;
}

export async function voidSignatureRequest(
  client: SupabaseClient<Database>,
  companyId: string,
  purchaseOrderId: string,
  voidReason: string
): Promise<void> {
  const { data: mapping } = await client
    .from("externalIntegrationMapping")
    .select("externalId")
    .eq("entityType", "purchaseOrder")
    .eq("entityId", purchaseOrderId)
    .eq("integration", "docusign")
    .eq("companyId", companyId)
    .maybeSingle();

  if (!mapping?.externalId) {
    throw new Error("No signature request found for this purchase order");
  }

  const docuSignClient = getDocuSignClient();
  await docuSignClient.voidEnvelope(companyId, mapping.externalId, voidReason);

  // Delete the mapping
  const serviceRole = getCarbonServiceRole();
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", "purchaseOrder")
    .eq("entityId", purchaseOrderId)
    .eq("integration", "docusign")
    .eq("companyId", companyId);
}

export async function resendSignatureRequest(
  client: SupabaseClient<Database>,
  companyId: string,
  purchaseOrderId: string
): Promise<void> {
  const { data: mapping } = await client
    .from("externalIntegrationMapping")
    .select("externalId")
    .eq("entityType", "purchaseOrder")
    .eq("entityId", purchaseOrderId)
    .eq("integration", "docusign")
    .eq("companyId", companyId)
    .maybeSingle();

  if (!mapping?.externalId) {
    throw new Error("No signature request found for this purchase order");
  }

  const docuSignClient = getDocuSignClient();
  await docuSignClient.resendEnvelope(companyId, mapping.externalId);
}
