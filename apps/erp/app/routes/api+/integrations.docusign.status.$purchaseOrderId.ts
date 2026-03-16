import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getDocuSignClient,
  getDocuSignEnvelopeFromPurchaseOrder,
  updateEnvelopeStatus
} from "@carbon/ee/docusign";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { purchaseOrderId } = params;

  if (!purchaseOrderId) {
    return data({ error: "Purchase order ID is required" }, { status: 400 });
  }

  try {
    const mapping = await getDocuSignEnvelopeFromPurchaseOrder(
      client,
      companyId,
      purchaseOrderId
    );

    if (!mapping) {
      return { hasEnvelope: false, envelope: null };
    }

    // Fetch latest status from DocuSign
    const docusign = getDocuSignClient();
    const envelope = await docusign.getEnvelopeStatus(
      companyId,
      mapping.envelopeId
    );

    if (envelope && envelope.status !== mapping.status) {
      // Update stored status
      await updateEnvelopeStatus(
        client,
        companyId,
        purchaseOrderId,
        envelope.status
      );
    }

    return {
      hasEnvelope: true,
      envelope: {
        envelopeId: mapping.envelopeId,
        status: envelope?.status ?? mapping.status,
        signerName: mapping.signerName,
        signerEmail: mapping.signerEmail,
        subject: mapping.subject,
        sentAt: mapping.sentAt,
        completedDateTime: envelope?.completedDateTime,
        recipients: envelope?.recipients
      }
    };
  } catch (err) {
    console.error("DocuSign status check error:", err);
    return data({ error: "Failed to check signature status" }, { status: 500 });
  }
}
