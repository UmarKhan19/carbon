import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocuSignCredentials, DocuSignEnvelopeMapping } from "./types";
import { DocuSignEnvelopeMappingSchema } from "./types";

/**
 * Get the DocuSign integration for a company from companyIntegration.
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
 * Update the stored OAuth credentials for a company's DocuSign integration.
 * Called by the client after a token refresh.
 */
export async function updateDocuSignCredentials(
  client: SupabaseClient<Database>,
  companyId: string,
  credentials: DocuSignCredentials
) {
  const { data: existing } = await client
    .from("companyIntegration")
    .select("metadata")
    .eq("companyId", companyId)
    .eq("id", "docusign")
    .single();

  const metadata = (existing?.metadata as Record<string, unknown>) ?? {};

  return await client
    .from("companyIntegration")
    .update({
      metadata: {
        ...metadata,
        credentials
      } as unknown as Record<string, unknown>
    })
    .eq("companyId", companyId)
    .eq("id", "docusign");
}

/**
 * Get a DocuSign envelope mapping for an entity.
 *
 * Uses the generic entityType field so it works for purchaseOrders, invoices, etc.
 */
export async function getDocuSignEnvelopeMapping(
  client: SupabaseClient<Database>,
  companyId: string,
  entityType: string,
  entityId: string
): Promise<DocuSignEnvelopeMapping | null> {
  const { data: mapping } = await client
    .from("externalIntegrationMapping")
    .select("metadata")
    .eq("entityType", entityType)
    .eq("entityId", entityId)
    .eq("integration", "docusign")
    .eq("companyId", companyId)
    .maybeSingle();

  if (!mapping) return null;

  const { data } = DocuSignEnvelopeMappingSchema.safeParse(mapping.metadata);

  if (!data) return null;

  return data;
}

/**
 * Get a DocuSign envelope mapping for a purchase order.
 * Convenience wrapper around getDocuSignEnvelopeMapping.
 */
export async function getDocuSignEnvelopeFromPurchaseOrder(
  client: SupabaseClient<Database>,
  companyId: string,
  purchaseOrderId: string
): Promise<DocuSignEnvelopeMapping | null> {
  return getDocuSignEnvelopeMapping(
    client,
    companyId,
    "purchaseOrder",
    purchaseOrderId
  );
}

/**
 * Find the entity linked to a DocuSign envelope by its external envelope ID.
 * Useful for webhook handlers that receive an envelopeId and need to find
 * the corresponding Carbon entity.
 */
export async function getEntityByEnvelopeId(
  client: SupabaseClient<Database>,
  companyId: string,
  envelopeId: string
) {
  const { data: mapping } = await client
    .from("externalIntegrationMapping")
    .select("entityType, entityId, metadata")
    .eq("integration", "docusign")
    .eq("externalId", envelopeId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (!mapping) return null;

  return {
    entityType: mapping.entityType,
    entityId: mapping.entityId,
    metadata: DocuSignEnvelopeMappingSchema.safeParse(mapping.metadata).data
  };
}

/**
 * Store a DocuSign envelope mapping for an entity.
 *
 * Uses the generic entityType field so it works for purchaseOrders, invoices, etc.
 * Deletes any existing mapping first (using service role to bypass RLS DELETE restriction).
 */
export async function linkEntityToEnvelope(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    entityType: string;
    entityId: string;
    envelopeId: string;
    signerName: string;
    signerEmail: string;
    subject: string;
    status: string;
    documentType?: string;
  }
) {
  const mapping: DocuSignEnvelopeMapping = {
    envelopeId: input.envelopeId,
    status: input.status,
    signerName: input.signerName,
    signerEmail: input.signerEmail,
    subject: input.subject,
    sentAt: new Date().toISOString(),
    documentType: input.documentType
  };

  // Delete any existing DocuSign mapping for this entity (service role bypasses RLS)
  const serviceRole = getCarbonServiceRole();
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", input.entityType)
    .eq("entityId", input.entityId)
    .eq("integration", "docusign");

  // Create the new mapping
  return await client.from("externalIntegrationMapping").insert({
    entityType: input.entityType,
    entityId: input.entityId,
    integration: "docusign",
    externalId: input.envelopeId,
    metadata: mapping as unknown as Record<string, unknown>,
    companyId
  });
}

/**
 * Store a DocuSign envelope mapping for a purchase order.
 * Convenience wrapper around linkEntityToEnvelope.
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
  return linkEntityToEnvelope(client, companyId, {
    entityType: "purchaseOrder",
    entityId: input.purchaseOrderId,
    envelopeId: input.envelopeId,
    signerName: input.signerName,
    signerEmail: input.signerEmail,
    subject: input.subject,
    status: input.status,
    documentType: "purchaseOrder"
  });
}

/**
 * Update the envelope status in an existing mapping.
 *
 * Works for any entity type by looking up via entityType + entityId.
 */
export async function updateEnvelopeStatus(
  client: SupabaseClient<Database>,
  companyId: string,
  entityType: string,
  entityId: string,
  status: string
) {
  const existing = await getDocuSignEnvelopeMapping(
    client,
    companyId,
    entityType,
    entityId
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
    .eq("entityType", entityType)
    .eq("entityId", entityId)
    .eq("integration", "docusign")
    .eq("companyId", companyId);
}

/**
 * Update the envelope status for a purchase order.
 * Convenience wrapper around updateEnvelopeStatus.
 */
export async function updatePurchaseOrderEnvelopeStatus(
  client: SupabaseClient<Database>,
  companyId: string,
  purchaseOrderId: string,
  status: string
) {
  return updateEnvelopeStatus(
    client,
    companyId,
    "purchaseOrder",
    purchaseOrderId,
    status
  );
}
