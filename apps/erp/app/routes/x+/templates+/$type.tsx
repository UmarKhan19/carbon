import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  DocumentBlock,
  DocumentSettings,
  DocumentTheme
} from "@carbon/documents/template";
import {
  documentTemplateTypeSchema,
  getDocumentLabel,
  resolveTemplate,
  withBuiltInSections
} from "@carbon/documents/template";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { DocumentTemplateEditor } from "~/components/DocumentTemplateEditor";
import { usePermissions } from "~/hooks";
import {
  documentTemplateValidator,
  getCompany,
  getDocumentSections,
  getDocumentTemplate,
  getTerms,
  upsertDocumentTemplate
} from "~/modules/settings";
import { listPreviewEntities } from "~/modules/settings/documentPreview.server";
import { getCustomFieldsSchemas } from "~/modules/shared/shared.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: (params: { type?: string }) => getDocumentLabel(params.type ?? "")
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const documentType = documentTemplateTypeSchema.parse(params.type);

  const [
    stored,
    sections,
    customFieldSchemas,
    previewEntities,
    terms,
    company
  ] = await Promise.all([
    getDocumentTemplate(client, companyId, documentType),
    getDocumentSections(client, companyId),
    // Custom field definitions for this record type, to offer as insertable
    // blocks. The customField `table` matches the document type.
    getCustomFieldsSchemas(client, { companyId, table: documentType }),
    // Recent records to optionally preview against live data.
    listPreviewEntities(client, companyId, documentType),
    // Company terms setting — seeds the Terms block when it has no content.
    getTerms(client, companyId),
    getCompany(client, companyId)
  ]);

  // Map the document type to the relevant company terms setting (the Terms
  // block's default/fallback). Internal docs have no terms.
  const TERMS_FIELD: Partial<
    Record<typeof documentType, "salesTerms" | "purchasingTerms">
  > = {
    salesInvoice: "salesTerms",
    salesOrder: "salesTerms",
    quote: "salesTerms",
    packingSlip: "salesTerms",
    purchaseOrder: "purchasingTerms"
  };
  const termsField = TERMS_FIELD[documentType];
  const termsSeed = termsField
    ? ((terms.data as Record<string, JSONContent> | null)?.[termsField] ??
      undefined)
    : undefined;

  const customFields = (
    ((customFieldSchemas.data ?? []).find((t) => t.table === documentType)
      ?.fields ?? []) as { id: string; name: string }[]
  ).map((f) => ({ id: f.id, name: f.name }));

  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate(
      documentType,
      (stored.data ?? null) as Parameters<typeof resolveTemplate>[1]
    );

  return {
    documentType,
    blocks,
    theme,
    settings,
    headerSectionId,
    footerSectionId,
    sections: withBuiltInSections(
      (sections.data ?? []) as {
        id: string;
        name: string;
        placement: "body" | "header" | "footer";
        content?: unknown;
        config?: unknown;
      }[]
    ).map((s) => ({
      id: s.id,
      name: s.name,
      placement: s.placement,
      content: (s as { content?: JSONContent }).content,
      config: (s as { config?: Record<string, unknown> }).config
    })),
    customFields,
    previewEntities,
    termsSeed,
    hasWatermark: Boolean(
      (company.data as { logoWatermark?: string | null } | null)?.logoWatermark
    )
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const validation = await validator(documentTemplateValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    documentType,
    blocks,
    theme,
    settings,
    headerSectionId,
    footerSectionId
  } = validation.data;

  const upsert = await upsertDocumentTemplate(client, {
    companyId,
    documentType,
    // Validated at runtime by documentTemplateValidator; the form-data
    // inferred type is looser than the schema output, so assert here.
    blocks: blocks as DocumentBlock[],
    theme: theme as DocumentTheme,
    settings: settings as DocumentSettings,
    headerSectionId: headerSectionId || null,
    footerSectionId: footerSectionId || null,
    createdBy: userId,
    updatedBy: userId
  });

  if (upsert.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(upsert.error, "Failed to save document layout")
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Saved document layout"))
  );
}

export default function DocumentTemplateRoute() {
  const {
    documentType,
    blocks,
    theme,
    settings,
    headerSectionId,
    footerSectionId,
    sections,
    customFields,
    previewEntities,
    termsSeed,
    hasWatermark
  } = useLoaderData<typeof loader>();
  const permissions = usePermissions();

  return (
    <DocumentTemplateEditor
      key={documentType}
      documentType={documentType}
      actionPath={path.to.documentTemplate(documentType)}
      initialBlocks={blocks}
      initialTheme={theme}
      initialSettings={settings}
      initialHeaderSectionId={headerSectionId}
      initialFooterSectionId={footerSectionId}
      sections={sections}
      customFields={customFields}
      previewEntities={previewEntities}
      termsSeed={termsSeed as JSONContent | undefined}
      hasWatermark={hasWatermark}
      canEdit={permissions.can("update", "settings")}
    />
  );
}
