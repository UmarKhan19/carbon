import { getCarbonServiceRole } from "@carbon/auth";
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
  emailBody: z.string().optional()
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
      emailBody
    } = parsed.data;

    // Retrieve the stored PO PDF from Supabase Storage server-side
    const serviceRole = getCarbonServiceRole();

    const documentResult = await serviceRole
      .from("document")
      .select("path, name")
      .eq("companyId", companyId)
      .eq("sourceDocument", "Purchase Order")
      .eq("sourceDocumentId", purchaseOrderId)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (documentResult.error || !documentResult.data) {
      return data(
        {
          error:
            "Purchase order PDF not found. Please finalize the purchase order first."
        },
        { status: 404 }
      );
    }

    const { path: storagePath, name: documentName } = documentResult.data;

    const downloadResult = await serviceRole.storage
      .from("private")
      .download(storagePath);

    if (downloadResult.error || !downloadResult.data) {
      return data(
        { error: "Failed to download purchase order PDF from storage." },
        { status: 500 }
      );
    }

    const buffer = Buffer.from(await downloadResult.data.arrayBuffer());
    const documentBase64 = buffer.toString("base64");

    const docusign = getDocuSignClient();

    const envelope = await docusign.createEnvelope(companyId, {
      emailSubject,
      emailBody,
      documents: [
        {
          documentBase64,
          name: documentName,
          fileExtension: "pdf",
          documentId: "1"
        }
      ],
      signers: [
        {
          email: signerEmail,
          name: signerName,
          recipientId: "1",
          routingOrder: "1"
        }
      ],
      status: "sent"
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
