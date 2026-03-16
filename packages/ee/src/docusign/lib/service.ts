import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocuSignCredentials, DocuSignEnvelopeMapping } from "./types";
import { DocuSignEnvelopeMappingSchema } from "./types";

/**
 * Get the DocuSign integration for a company.
 */
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

/**
 * Update DocuSign credentials in the integration metadata.
 */
export async function updateDocuSignCredentials(
  client: SupabaseClient<Database>,
  companyId: string,
  credentials: DocuSignCredentials
) {
  const { data: current } = await getDocuSignIntegration(client, companyId);
  const integration = current?.[0];

  if (!integration) {
    throw new Error("DocuSign integration not found");
  }

  const metadata = integration.metadata as Record<string, unknown>;

  return await client
    .from("companyIntegration")
    .update({
      metadata: {
        ...metadata,
        credentials
      }
    })
    .eq("companyId", companyId)
    .eq("id", "docusign");
}

/**
 * Get DocuSign envelope mapping for a purchase order.
 */
export async function getDocuSignEnvelopeFromPurchaseOrder(
  client: SupabaseClient<Database>,
  companyId: string,
  purchaseOrderId: string
): Promise<DocuSignEnvelopeMapping | null> {
  const { data: mapping } = await client
    .from("externalIntegrationMapping")
    .select("metadata")
    .eq("entityType", "purchaseOrder")
    .eq("entityId", purchaseOrderId)
    .eq("integration", "docusign")
    .eq("companyId", companyId)
    .maybeSingle();

  if (!mapping) return null;

  const { data } = DocuSignEnvelopeMappingSchema.safeParse(mapping.metadata);

  if (!data) return null;

  return data;
}

/**
 * Store the DocuSign envelope mapping for a purchase order.
 */
export async function linkPurchaseOrderToEnvelope(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    purchaseOrderId: string;
    envelopeId: string;
    signerName: string;
    signerEmail: string;
    subject: string;
    status: string;
  }
) {
  const mapping: DocuSignEnvelopeMapping = {
    envelopeId: input.envelopeId,
    status: input.status,
    signerName: input.signerName,
    signerEmail: input.signerEmail,
    subject: input.subject,
    sentAt: new Date().toISOString()
  };

  // Delete any existing DocuSign mapping for this PO
  const serviceRole = getCarbonServiceRole();
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", "purchaseOrder")
    .eq("entityId", input.purchaseOrderId)
    .eq("integration", "docusign");

  // Create the new mapping
  return await client.from("externalIntegrationMapping").insert({
    entityType: "purchaseOrder",
    entityId: input.purchaseOrderId,
    integration: "docusign",
    externalId: input.envelopeId,
    metadata: mapping as unknown as Record<string, unknown>,
    companyId
  });
}

/**
 * Update the DocuSign envelope status for a purchase order.
 */
export async function updateEnvelopeStatus(
  client: SupabaseClient<Database>,
  companyId: string,
  purchaseOrderId: string,
  status: string
) {
  const existing = await getDocuSignEnvelopeFromPurchaseOrder(
    client,
    companyId,
    purchaseOrderId
  );

  if (!existing) return null;

  return await client
    .from("externalIntegrationMapping")
    .update({
      metadata: {
        ...existing,
        status
      } as unknown as Record<string, unknown>
    })
    .eq("entityType", "purchaseOrder")
    .eq("entityId", purchaseOrderId)
    .eq("integration", "docusign")
    .eq("companyId", companyId);
}
