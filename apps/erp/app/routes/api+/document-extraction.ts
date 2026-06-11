import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { insertDocumentExtraction } from "~/modules/documents/extraction.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const formData = await request.formData();
  const storagePath = formData.get("storagePath") as string;
  const documentType = formData.get("documentType") as
    | "purchaseInvoice"
    | "salesRfq";
  const sourceDocument = formData.get("sourceDocument") as string;
  const sourceDocumentId =
    (formData.get("sourceDocumentId") as string) || undefined;

  if (!storagePath || !documentType || !sourceDocument) {
    return data({ error: "Missing required fields" }, { status: 400 });
  }

  const result = await insertDocumentExtraction(client, {
    storagePath,
    documentType,
    sourceDocument,
    sourceDocumentId,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to start extraction"))
    );
  }

  return data({ extractionId: result.data?.id });
}
