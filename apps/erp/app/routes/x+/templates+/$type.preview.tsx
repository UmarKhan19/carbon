import { requirePermissions } from "@carbon/auth/auth.server";
import { DOCUMENT_PDFS, ensureFont } from "@carbon/documents/pdf";
import {
  blockSchema,
  CURRENT_TEMPLATE_FORMAT_VERSION,
  collectSectionIds,
  DEFAULT_DOCUMENT_SETTINGS,
  documentSettingsSchema,
  documentTemplateTypeSchema,
  themeSchema
} from "@carbon/documents/template";
import { getPreferenceHeaders } from "@carbon/react";
import { renderToStream } from "@react-pdf/renderer";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { getCompany, resolveSections } from "~/modules/settings";

/**
 * Renders a sample of the document with the draft block layout, server-side.
 * Keeps @react-pdf/renderer off the client entirely (it relies on Node's
 * Buffer/streams) and guarantees the preview matches the real PDF route.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const documentType = documentTemplateTypeSchema.parse(params.type);

  const formData = await request.formData();
  const parsed = z
    .array(blockSchema)
    .safeParse(JSON.parse(String(formData.get("blocks") ?? "[]")));
  const theme = themeSchema.safeParse(
    JSON.parse(String(formData.get("theme") ?? "{}"))
  );
  const settingsParsed = documentSettingsSchema.safeParse(
    JSON.parse(String(formData.get("settings") ?? "{}"))
  );
  const settings = settingsParsed.success
    ? settingsParsed.data
    : { ...DEFAULT_DOCUMENT_SETTINGS };

  if (!parsed.success || !theme.success) {
    return new Response("Invalid template", { status: 400 });
  }

  const headerSectionId = String(formData.get("headerSectionId") ?? "") || null;
  const footerSectionId = String(formData.get("footerSectionId") ?? "") || null;

  const sections = await resolveSections(
    client,
    companyId,
    collectSectionIds({ blocks: parsed.data, headerSectionId, footerSectionId })
  );

  const { locale } = getPreferenceHeaders(request);

  await ensureFont(settings.fontFamily);

  const { Component, sample } = DOCUMENT_PDFS[documentType];

  // Use the real company so the preview shows the actual logo / branding;
  // everything else (line items, totals) stays sample data.
  const company = await getCompany(client, companyId);
  const previewCompany = company.data ?? sample.company;

  const stream = await renderToStream(
    <Component
      {...sample}
      company={previewCompany}
      locale={locale}
      template={{
        formatVersion: CURRENT_TEMPLATE_FORMAT_VERSION,
        documentType,
        blocks: parsed.data,
        theme: theme.data,
        settings,
        headerSectionId,
        footerSectionId
      }}
      sections={sections}
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => buffers.push(data));
    stream.on("end", () => resolve(Buffer.concat(buffers)));
    stream.on("error", reject);
  });

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { "Content-Type": "application/pdf" }
  });
}
