import { requirePermissions } from "@carbon/auth/auth.server";
import { sendPurchaseOrderForSignature } from "@carbon/ee/docusign.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

const sendSignatureSchema = z.object({
  purchaseOrderId: z.string(),
  pdfBase64: z.string(),
  signerEmail: z.string().email(),
  signerName: z.string(),
  emailSubject: z.string().optional()
});

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "purchasing"
  });

  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const parsed = sendSignatureSchema.safeParse(body);

    if (!parsed.success) {
      return data(
        { error: "Invalid request body", details: parsed.error.errors },
        { status: 400 }
      );
    }

    const envelope = await sendPurchaseOrderForSignature(
      client,
      companyId,
      parsed.data
    );

    return data({ success: true, envelope });
  } catch (err) {
    console.error("DocuSign send signature error:", err);
    return data(
      {
        error:
          err instanceof Error ? err.message : "Failed to send signature request"
      },
      { status: 500 }
    );
  }
}
