import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { insertCompanyDefaultAttachment } from "~/modules/purchasing";

/**
 * Add a new company-level default attachment.
 * Client first uploads to storage, then POSTs metadata here.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "settings"
  });

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

  const created = await upsertDocument(client, {
    path: documentPath,
    name,
    size: Number(sizeRaw),
    sourceDocument: "Company",
    sourceDocumentId: companyId,
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

  const linked = await insertCompanyDefaultAttachment(client, {
    companyId,
    documentId: created.data.id,
    shareOnSend: true,
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
