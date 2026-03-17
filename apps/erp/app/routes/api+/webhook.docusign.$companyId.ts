/**
 * DocuSign Connect Webhook Handler
 *
 * Receives DocuSign Connect notifications when envelope status changes
 * (sent, delivered, completed, declined, voided).
 *
 * The handler:
 * 1. Validates the HMAC-SHA256 signature using the webhookSecret from integration settings
 * 2. Parses the envelope status change event
 * 3. Looks up the externalIntegrationMapping by envelope ID
 * 4. Updates the mapping metadata with the new status and timestamp
 * 5. On "completed" status, triggers a background job to download the signed PDF
 */

import { getCarbonServiceRole } from "@carbon/auth";
import {
  DocuSignWebhookPayloadSchema,
  getDocuSignClient,
  getEntityByEnvelopeId
} from "@carbon/ee/docusign";
import type { processSignedDocumentTask } from "@carbon/jobs/trigger/process-signed-document";
import { tasks } from "@trigger.dev/sdk/v3";
import crypto from "crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getIntegration } from "../../modules/settings";

export const config = {
  runtime: "nodejs"
};

/**
 * Verify the HMAC-SHA256 signature from DocuSign Connect.
 *
 * DocuSign signs the raw request body with the webhook secret using
 * HMAC-SHA256 and sends the result as a base64-encoded header value.
 */
function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(hmac, "utf8"),
      Buffer.from(signature, "utf8")
    );
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    return false;
  }
}

/**
 * Health-check endpoint for DocuSign Connect validation.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  return { success: true };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;

  if (!companyId) {
    return data(
      { success: false, error: "Missing companyId" },
      { status: 400 }
    );
  }

  const serviceRole = getCarbonServiceRole();

  // Verify the integration exists and is active
  const integration = await getIntegration(serviceRole, "docusign", companyId);

  if (integration.error || !integration.data) {
    console.error(
      "DocuSign webhook: integration not found for company",
      companyId
    );
    return data(
      { success: false, error: "Integration not configured" },
      { status: 400 }
    );
  }

  if (!integration.data.active) {
    return data(
      { success: false, error: "Integration not active" },
      { status: 400 }
    );
  }

  // Read raw body for signature verification
  const payloadText = await request.text();

  if (!payloadText || payloadText.trim() === "") {
    return data({ success: false, error: "Empty payload" }, { status: 400 });
  }

  // Validate HMAC signature if webhookSecret is configured
  const metadata = integration.data.metadata as Record<string, unknown>;
  const webhookSecret = metadata?.webhookSecret as string | undefined;

  if (webhookSecret) {
    const signature = request.headers.get("x-docusign-signature-1");

    if (!signature) {
      console.warn("DocuSign webhook: missing signature header");
      return data(
        { success: false, error: "Missing signature" },
        { status: 401 }
      );
    }

    const isValid = verifySignature(payloadText, signature, webhookSecret);

    if (!isValid) {
      console.warn("DocuSign webhook: invalid signature");
      return data(
        { success: false, error: "Invalid signature" },
        { status: 401 }
      );
    }
  }

  // Parse the webhook payload
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    console.error("DocuSign webhook: failed to parse JSON payload");
    return data(
      { success: false, error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  const parsed = DocuSignWebhookPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    console.error(
      "DocuSign webhook: invalid payload format",
      parsed.error.format()
    );
    return data(
      { success: false, error: "Invalid payload format" },
      { status: 400 }
    );
  }

  const { envelopeId } = parsed.data.data;

  // Resolve the envelope summary — either from the webhook payload or by
  // fetching it from the DocuSign API when the payload only contains IDs.
  let envelopeSummary = parsed.data.data.envelopeSummary;

  if (!envelopeSummary) {
    console.log(
      `DocuSign webhook: no envelopeSummary in payload for ${envelopeId}, fetching from API`
    );
    const client = getDocuSignClient();
    const fetched = await client.getEnvelopeStatus(companyId, envelopeId);

    if (!fetched) {
      console.error(
        `DocuSign webhook: failed to fetch envelope ${envelopeId} from API`
      );
      return data(
        { success: false, error: "Failed to fetch envelope details" },
        { status: 500 }
      );
    }

    envelopeSummary = fetched;
  }

  const envelopeStatus = envelopeSummary.status;

  console.log(
    `DocuSign webhook: envelope ${envelopeId} status changed to "${envelopeStatus}" (company: ${companyId})`
  );

  // Look up the entity mapping by envelope ID
  const entity = await getEntityByEnvelopeId(
    serviceRole,
    companyId,
    envelopeId
  );

  if (!entity) {
    console.warn(
      `DocuSign webhook: no mapping found for envelope ${envelopeId} in company ${companyId}`
    );
    // Return 200 to acknowledge receipt — DocuSign will retry on non-2xx
    return { success: true, ignored: true, reason: "no_mapping_found" };
  }

  // Build updated metadata with the new status and timestamps
  const existingMetadata = (entity.metadata ?? {}) as Record<string, unknown>;

  const updatedMetadata: Record<string, unknown> = {
    ...existingMetadata,
    status: envelopeStatus,
    lastWebhookAt: new Date().toISOString()
  };

  // Add relevant timestamps from the envelope summary
  if (envelopeSummary.sentDateTime) {
    updatedMetadata.sentAt = envelopeSummary.sentDateTime;
  }
  if (envelopeSummary.completedDateTime) {
    updatedMetadata.completedAt = envelopeSummary.completedDateTime;
  }
  if (envelopeSummary.voidedDateTime) {
    updatedMetadata.voidedAt = envelopeSummary.voidedDateTime;
  }
  if (envelopeSummary.voidedReason) {
    updatedMetadata.voidedReason = envelopeSummary.voidedReason;
  }

  // Extract signer details if available
  const signers = envelopeSummary.recipients?.signers;
  if (signers && signers.length > 0) {
    const signer = signers[0];
    if (signer.signedDateTime) {
      updatedMetadata.signedAt = signer.signedDateTime;
    }
    if (signer.declinedDateTime) {
      updatedMetadata.declinedAt = signer.declinedDateTime;
    }
    if (signer.declinedReason) {
      updatedMetadata.declinedReason = signer.declinedReason;
    }
  }

  // Update the mapping metadata (using service role to bypass RLS)
  const updateResult = await serviceRole
    .from("externalIntegrationMapping")
    .update({
      metadata: updatedMetadata,
      updatedAt: new Date().toISOString()
    })
    .eq("integration", "docusign")
    .eq("externalId", envelopeId)
    .eq("companyId", companyId);

  if (updateResult.error) {
    console.error(
      "DocuSign webhook: failed to update mapping metadata",
      updateResult.error.message
    );
    return data(
      { success: false, error: "Failed to update status" },
      { status: 500 }
    );
  }

  // On "completed" status, trigger a background job to download the signed PDF
  if (envelopeStatus === "completed") {
    try {
      const handle = await tasks.trigger<typeof processSignedDocumentTask>(
        "process-signed-document",
        {
          companyId,
          envelopeId,
          entityType: entity.entityType,
          entityId: entity.entityId
        }
      );

      console.log(
        `DocuSign webhook: triggered signed PDF download job ${handle.id} for envelope ${envelopeId}`
      );

      return {
        success: true,
        status: envelopeStatus,
        entityType: entity.entityType,
        entityId: entity.entityId,
        jobId: handle.id
      };
    } catch (err) {
      console.error("DocuSign webhook: failed to trigger signed PDF job", err);
      // Status was already updated, so return success for the webhook
      return {
        success: true,
        status: envelopeStatus,
        entityType: entity.entityType,
        entityId: entity.entityId,
        jobError: err instanceof Error ? err.message : "Unknown error"
      };
    }
  }

  return {
    success: true,
    status: envelopeStatus,
    entityType: entity.entityType,
    entityId: entity.entityId
  };
}
