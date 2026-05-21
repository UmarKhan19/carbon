import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { insertItemDefaultAttachment } from "~/modules/purchasing";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Missing itemId");

  const formData = await request.formData();
  const documentPath = formData.get("path");
  const name = formData.get("name");
  const sizeRaw = formData.get("size");

  if (typeof documentPath !== "string" || typeof name !== "string") {
    return data(
      { success: false, message: "Missing fields" },
      await flash(request, error("Missing fields", "Failed to add attachment"))
    );
  }

  const created = await upsertDocument(client, {
    path: documentPath,
    name,
    size: Number(sizeRaw),
    // @ts-expect-error enum value added in 20260518000001 migration; types regenerate later
    sourceDocument: "Item",
    sourceDocumentId: itemId,
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

  const linked = await insertItemDefaultAttachment(client, {
    itemId,
    documentId: created.data.id,
    shareOnSend: true,
    companyId,
    createdBy: userId
  });

  if (linked.error) {
    return data(
      { success: false, message: "Failed to link" },
      await flash(request, error(linked.error, "Failed to link attachment"))
    );
  }

  return { success: true, documentId: created.data.id };
}
