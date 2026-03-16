import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getDocuSignClient,
  linkPurchaseOrderToEnvelope
} from "@carbon/ee/docusign";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

export const config = {
  runtime: "nodejs"
};

const sendSignatureSchema = z.object({
  purchaseOrderId: z.string(),
  signerName: z.string().min(1, "Signer name is required"),
  signerEmail: z.string().email("Valid email is required"),
  emailSubject: z.string().min(1, "Email subject is required"),
  emailBody: z.string().optional(),
  documentBase64: z.string().min(1, "Document is required"),
  documentName: z.string().min(1, "Document name is required")
});

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "purchasing"
  });

  try {
    const body = await request.json();
    const parsed = sendSignatureSchema.safeParse(body);

    if (!parsed.success) {
      return data(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      purchaseOrderId,
      signerName,
      signerEmail,
      emailSubject,
      emailBody,
      documentBase64,
      documentName
    } = parsed.data;

    const docusign = getDocuSignClient();

    const envelope = await docusign.createEnvelope(companyId, {
      documentBase64,
      documentName,
      signerName,
      signerEmail,
      emailSubject,
      emailBody
    });

    if (!envelope) {
      return data(
        { error: "Failed to create DocuSign envelope" },
        { status: 500 }
      );
    }

    // Store the mapping between the PO and the envelope
    await linkPurchaseOrderToEnvelope(client, companyId, {
      purchaseOrderId,
      envelopeId: envelope.envelopeId,
      signerName,
      signerEmail,
      subject: emailSubject,
      status: envelope.status
    });

    return {
      success: true,
      envelopeId: envelope.envelopeId,
      status: envelope.status
    };
  } catch (err) {
    console.error("DocuSign send signature error:", err);
    return data(
      { error: "Failed to send document for signature" },
      { status: 500 }
    );
  }
}
