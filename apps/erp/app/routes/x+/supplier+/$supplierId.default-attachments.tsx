import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useParams } from "react-router";
import DefaultAttachmentsPanel, {
  type DefaultAttachment
} from "~/components/DefaultAttachmentsPanel";
import { upsertDocument } from "~/modules/documents";
import {
  getSupplierDefaultAttachments,
  insertSupplierDefaultAttachment
} from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing"
  });
  const { supplierId } = params;
  if (!supplierId) throw new Error("Missing supplierId");

  const attachments = await getSupplierDefaultAttachments(client, supplierId);
  return { attachments: (attachments.data ?? []) as DefaultAttachment[] };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Missing supplierId");

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
    sourceDocument: "Supplier",
    sourceDocumentId: supplierId,
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

  const linked = await insertSupplierDefaultAttachment(client, {
    supplierId,
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

export default function SupplierDefaultAttachmentsRoute() {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("Missing supplierId");

  const { attachments } = useLoaderData<typeof loader>();

  return (
    <DefaultAttachmentsPanel
      attachments={attachments}
      storagePathPrefix={`default-attachments/supplier/${supplierId}`}
      uploadAction={path.to.supplierDefaultAttachments(supplierId)}
      deleteAction={(attachmentId) =>
        path.to.supplierDefaultAttachmentDelete(supplierId, attachmentId)
      }
      lockAction={(attachmentId) =>
        path.to.supplierDefaultAttachmentLock(supplierId, attachmentId)
      }
      fetcherKeyPrefix={`supplier-default:${supplierId}`}
      title={<Trans>Default Attachments</Trans>}
      description={
        <Trans>
          Files attached here ride along on every purchase order email sent to
          this supplier (in addition to company-wide defaults).
        </Trans>
      }
    />
  );
}
