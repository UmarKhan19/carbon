import { getCarbonServiceRole } from "@carbon/auth";
import { getDocuSignClient, getEntityByEnvelopeId } from "@carbon/ee/docusign";
import { task } from "@trigger.dev/sdk";

const serviceRole = getCarbonServiceRole();

export const processSignedDocumentTask = task({
  id: "process-signed-document",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 30000,
    factor: 2,
    randomize: true,
  },
  run: async (payload: {
    companyId: string;
    envelopeId: string;
    entityType: string;
    entityId: string;
  }) => {
    const { companyId, envelopeId, entityType, entityId } = payload;

    console.log(
      `Processing signed document for envelope ${envelopeId} (${entityType}: ${entityId})`
    );

    // 1. Verify the mapping still exists
    const entity = await getEntityByEnvelopeId(
      serviceRole,
      companyId,
      envelopeId
    );

    if (!entity) {
      console.warn(
        `No mapping found for envelope ${envelopeId}, skipping signed PDF download`
      );
      return { success: false, reason: "no_mapping_found" };
    }

    // 2. Download the signed PDF from DocuSign
    const client = getDocuSignClient();
    const pdfBuffer = await client.getEnvelopeDocument(
      companyId,
      envelopeId,
      "combined"
    );

    if (!pdfBuffer) {
      throw new Error(
        `Failed to download signed PDF for envelope ${envelopeId}`
      );
    }

    console.log(
      `Downloaded signed PDF (${Math.round(
        pdfBuffer.byteLength / 1024
      )} KB) for envelope ${envelopeId}`
    );

    // 3. Determine the storage path based on entity type
    let storagePath: string;

    if (entityType === "purchaseOrder") {
      // Look up the supplierInteractionId for the purchase order
      const { data: poData } = await serviceRole
        .from("purchaseOrder")
        .select("supplierInteractionId, purchaseOrderId")
        .eq("id", entityId)
        .maybeSingle();

      if (!poData?.supplierInteractionId) {
        console.error(
          `Purchase order ${entityId} not found or missing supplierInteractionId`
        );
        return { success: false, reason: "purchase_order_not_found" };
      }

      const fileName = `${poData.purchaseOrderId} - Signed ${new Date()
        .toISOString()
        .slice(0, -5)}.pdf`;
      storagePath = `${companyId}/supplier-interaction/${poData.supplierInteractionId}/${fileName}`;
    } else {
      // Generic path for other document types
      const fileName = `${entityType}-${entityId}-signed-${new Date()
        .toISOString()
        .slice(0, -5)}.pdf`;
      storagePath = `${companyId}/signed-documents/${fileName}`;
    }

    // 4. Upload the signed PDF to Supabase Storage
    const uploadResult = await serviceRole.storage
      .from("private")
      .upload(storagePath, pdfBuffer, {
        cacheControl: `${12 * 60 * 60}`,
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadResult.error) {
      throw new Error(
        `Failed to upload signed PDF to storage: ${uploadResult.error.message}`
      );
    }

    console.log(`Signed PDF uploaded to: ${storagePath}`);

    // 5. Create a document record for the signed version
    const documentName = storagePath.split("/").pop() ?? "Signed Document.pdf";

    const documentInsert = await serviceRole.from("document").insert({
      path: storagePath,
      name: documentName,
      size: Math.round(pdfBuffer.byteLength / 1024),
      type: "PDF",
      sourceDocument: entityType === "purchaseOrder" ? "Purchase Order" : null,
      sourceDocumentId: entityType === "purchaseOrder" ? entityId : null,
      createdBy: "system",
      companyId,
    });

    if (documentInsert.error) {
      console.error(
        "Failed to create document record:",
        documentInsert.error.message
      );
      // File was uploaded, so partial success
      return {
        success: true,
        storagePath,
        documentError: documentInsert.error.message,
      };
    }

    // 6. Update the mapping metadata with signed document info
    await serviceRole
      .from("externalIntegrationMapping")
      .update({
        metadata: {
          ...(entity.metadata ?? {}),
          status: "completed",
          signedDocumentPath: storagePath,
          signedDocumentDownloadedAt: new Date().toISOString(),
        } as unknown as Record<string, unknown>,
        updatedAt: new Date().toISOString(),
      })
      .eq("integration", "docusign")
      .eq("externalId", envelopeId)
      .eq("companyId", companyId);

    console.log(
      `Signed document processing complete for envelope ${envelopeId}`
    );

    return {
      success: true,
      storagePath,
      envelopeId,
      entityType,
      entityId,
    };
  },
});
