import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getDocuSignEnvelopeFromPurchaseOrder,
  getSignatureStatus
} from "@carbon/ee/docusign.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { purchaseOrderId } = params;
  if (!purchaseOrderId) {
    return data({ error: "Purchase order ID is required" }, { status: 400 });
  }

  try {
    // First check if there's a DocuSign envelope for this PO
    const envelopeData = await getDocuSignEnvelopeFromPurchaseOrder(
      client,
      companyId,
      purchaseOrderId
    );

    if (!envelopeData) {
      return data({ hasSignatureRequest: false });
    }

    // Get latest status from DocuSign
    const status = await getSignatureStatus(client, companyId, purchaseOrderId);

    return data({
      hasSignatureRequest: true,
      envelope: envelopeData,
      status
    });
  } catch (err) {
    console.error("DocuSign status error:", err);
    return data(
      {
        error:
          err instanceof Error ? err.message : "Failed to get signature status"
      },
      { status: 500 }
    );
  }
}
