import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { insertPurchaseOrderAttachment } from "~/modules/purchasing";

/**
 * Link an ad-hoc attachment to a purchase order.
 *
 * Flow: client first uploads the file to Supabase storage at the canonical
 * path, then POSTs the metadata here. We create the document record + the
 * purchaseOrderAttachment junction row in one shot.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Missing orderId");

  const formData = await request.formData();
  const documentPath = formData.get("path");
  const name = formData.get("name");
  const sizeRaw = formData.get("size");

  if (typeof documentPath !== "string" || !documentPath) {
    return data(
      { success: false, message: "Missing path" },
      await flash(request, error("Missing path", "Failed to add attachment"))
    );
  }
  if (typeof name !== "string" || !name) {
    return data(
      { success: false, message: "Missing name" },
      await flash(request, error("Missing name", "Failed to add attachment"))
    );
  }
  const size = Number(sizeRaw);

  const created = await upsertDocument(client, {
    path: documentPath,
    name,
    size,
    sourceDocument: "Purchase Order",
    sourceDocumentId: orderId,
    readGroups: [userId],
    writeGroups: [userId],
    createdBy: userId,
    companyId
  });

  if (created.error || !created.data?.id) {
    return data(
      { success: false, message: "Failed to create document" },
      await flash(request, error(created.error, "Failed to create document"))
    );
  }

  const linked = await insertPurchaseOrderAttachment(client, {
    purchaseOrderId: orderId,
    documentId: created.data.id,
    shareOnSend: true,
    companyId,
    createdBy: userId
  });

  if (linked.error) {
    return data(
      { success: false, message: "Failed to link attachment" },
      await flash(
        request,
        error(linked.error, "Failed to link attachment to purchase order")
      )
    );
  }

  return { success: true, documentId: created.data.id };
}
