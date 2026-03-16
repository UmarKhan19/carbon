import { getCarbonServiceRole } from "@carbon/auth";
import {
  getDocuSignClient,
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
    documentBase64: string;
    fileName: string;
    signerName: string;
    signerEmail: string;
    companyName: string;
  }) => {
    const {
      companyId,
      orderId,
      purchaseOrderId,
      documentBase64,
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

    // 2. Create the envelope via DocuSign API
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
      console.error("Failed to create DocuSign envelope");
      return { success: false, reason: "envelope_creation_failed" };
    }

    console.info(
      `DocuSign envelope created: ${envelope.envelopeId} for PO ${purchaseOrderId}`
    );

    // 3. Store the envelope mapping in externalIntegrationMapping
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
