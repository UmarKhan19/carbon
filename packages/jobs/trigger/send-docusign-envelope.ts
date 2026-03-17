import { getCarbonServiceRole } from "@carbon/auth";
import {
  getDocuSignClient,
  getDocuSignEnvelopeFromPurchaseOrder,
  getDocuSignIntegration,
  linkPurchaseOrderToEnvelope,
} from "@carbon/ee/docusign";
import { task } from "@trigger.dev/sdk";

const serviceRole = getCarbonServiceRole();

export const sendDocuSignEnvelopeTask = task({
  id: "send-docusign-envelope",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    factor: 2,
    randomize: true,
  },
  run: async (payload: {
    companyId: string;
    orderId: string;
    purchaseOrderId: string;
    /** Base64-encoded PDF content. Either this or storagePath must be provided. */
    documentBase64?: string;
    /** Supabase Storage path to the PDF. Used as fallback when documentBase64 is not provided. */
    storagePath?: string;
    fileName: string;
    signerName: string;
    signerEmail: string;
    companyName: string;
  }) => {
    const {
      companyId,
      orderId,
      purchaseOrderId,
      fileName,
      signerName,
      signerEmail,
      companyName,
    } = payload;

    // 1. Check if DocuSign integration is active for the company
    const integration = await getDocuSignIntegration(serviceRole, companyId);
    const integrationData = integration.data?.[0];

    if (!integrationData || integrationData.active !== true) {
      console.info(
        "DocuSign integration not active for company, skipping envelope creation"
      );
      return { success: false, reason: "integration_inactive" };
    }

    // 1b. Check if an active envelope already exists for this PO
    const existingEnvelope = await getDocuSignEnvelopeFromPurchaseOrder(
      serviceRole,
      companyId,
      orderId
    );

    if (
      existingEnvelope &&
      ["sent", "delivered", "created"].includes(existingEnvelope.status)
    ) {
      console.info(
        `DocuSign envelope already exists for PO ${purchaseOrderId} with status "${existingEnvelope.status}", skipping`
      );
      return {
        success: true,
        skipped: true,
        reason: "active_envelope_exists",
        envelopeId: existingEnvelope.envelopeId,
      };
    }

    // 2. Resolve the document content — either from base64 or Supabase Storage
    let documentBase64 = payload.documentBase64;

    if (!documentBase64 && payload.storagePath) {
      console.info(`Downloading PDF from storage: ${payload.storagePath}`);
      const { data, error } = await serviceRole.storage
        .from("private")
        .download(payload.storagePath);

      if (error || !data) {
        throw new Error(
          `Failed to download PDF from storage: ${error?.message ?? "no data"}`
        );
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      documentBase64 = buffer.toString("base64");
    }

    if (!documentBase64) {
      console.error(
        "No document content provided: supply either documentBase64 or storagePath"
      );
      return { success: false, reason: "no_document_content" };
    }

    // 3. Create the envelope via DocuSign API
    const client = getDocuSignClient();
    const emailSubject = `Purchase Order ${purchaseOrderId} from ${companyName} — Signature Required`;

    const envelope = await client.createEnvelope(companyId, {
      emailSubject,
      emailBody: `Please review and sign Purchase Order ${purchaseOrderId} from ${companyName}.`,
      documents: [
        {
          documentBase64,
          name: fileName,
          fileExtension: "pdf",
          documentId: "1",
        },
      ],
      signers: [
        {
          email: signerEmail,
          name: signerName,
          recipientId: "1",
          routingOrder: "1",
        },
      ],
      status: "sent",
      customFields: {
        documentType: "purchaseOrder",
        entityId: orderId,
        companyId,
      },
    });

    if (!envelope) {
      throw new Error(
        `Failed to create DocuSign envelope for PO ${purchaseOrderId}`
      );
    }

    console.info(
      `DocuSign envelope created: ${envelope.envelopeId} for PO ${purchaseOrderId}`
    );

    // 4. Store the envelope mapping in externalIntegrationMapping
    const linkResult = await linkPurchaseOrderToEnvelope(
      serviceRole,
      companyId,
      {
        purchaseOrderId: orderId,
        envelopeId: envelope.envelopeId,
        signerName,
        signerEmail,
        subject: emailSubject,
        status: envelope.status,
      }
    );

    if (linkResult.error) {
      console.error(
        "Failed to store envelope mapping:",
        linkResult.error.message
      );
      // Envelope was already created in DocuSign, so we log but don't fail
      return {
        success: true,
        envelopeId: envelope.envelopeId,
        mappingError: linkResult.error.message,
      };
    }

    return {
      success: true,
      envelopeId: envelope.envelopeId,
      status: envelope.status,
    };
  },
});
