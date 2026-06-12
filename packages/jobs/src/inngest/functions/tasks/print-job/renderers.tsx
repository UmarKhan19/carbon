// This module is .tsx because the built-in kanban renderer uses JSX
// to render a React PDF component (KanbanLabelPDF) via renderToStream.

import type { Database } from "@carbon/database";
import { KanbanLabelPDF } from "@carbon/documents/pdf";
import {
  generateProductLabelZPL,
  generateStorageUnitLabelZPL
} from "@carbon/documents/zpl";
import { ERP_URL } from "@carbon/env";
import { renderWithBinderyPress } from "@carbon/printing/printing.server";
import type { LabelSize, ProductLabelItem } from "@carbon/utils";
import { labelSizes } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KanbanCardItem, StorageUnitItem } from "./resolvers";

export type GeneratedContent = {
  content: string;
  contentType: "zpl" | "pdf";
};

/** A single resolved item tagged with the document type that renders it. */
export type PrintableDocumentItem =
  | { type: "productLabel"; item: ProductLabelItem }
  | { type: "kanbanCard"; item: KanbanCardItem }
  | { type: "storageUnitLabel"; item: StorageUnitItem };

export async function renderItemWithTemplate(
  doc: PrintableDocumentItem,
  templateId: string,
  apiKey: string,
  format: "zpl" | "pdf"
): Promise<GeneratedContent> {
  const result = await renderWithBinderyPress({
    apiKey,
    templateId,
    data: { ...doc.item },
    format
  });

  return {
    content: result.content,
    contentType: result.contentType
  };
}

export async function renderItemBuiltIn(
  client: SupabaseClient<Database>,
  doc: PrintableDocumentItem,
  format: "zpl" | "pdf",
  mediaSizeId: string
): Promise<GeneratedContent> {
  switch (doc.type) {
    case "productLabel":
      return {
        content: generateProductLabelZPL(
          doc.item,
          requireZplMediaSize("product label", format, mediaSizeId)
        ),
        contentType: "zpl"
      };
    case "kanbanCard":
      return renderKanbanCardPDF(client, doc.item, format);
    case "storageUnitLabel":
      return {
        content: generateStorageUnitLabelZPL(
          doc.item,
          requireZplMediaSize("storage unit label", format, mediaSizeId)
        ),
        contentType: "zpl"
      };
  }
}

function requireZplMediaSize(
  documentName: string,
  format: "zpl" | "pdf",
  mediaSizeId: string
): LabelSize {
  if (format === "pdf") {
    throw new Error(
      `Built-in ${documentName} generation only supports ZPL printers. Use a BinderyPress template for PDF output.`
    );
  }

  const mediaSize = labelSizes.find((s) => s.id === mediaSizeId);
  if (!mediaSize?.zpl) {
    throw new Error(`Media size ${mediaSizeId} does not support ZPL`);
  }

  return mediaSize;
}

async function renderKanbanCardPDF(
  client: SupabaseClient<Database>,
  item: KanbanCardItem,
  format: "zpl" | "pdf"
): Promise<GeneratedContent> {
  if (format === "zpl") {
    throw new Error(
      "Built-in kanban card generation only supports PDF printers."
    );
  }

  let thumbnail: string | null = null;
  if (item.thumbnailPath) {
    const { data } = await client.storage
      .from("private")
      .download(item.thumbnailPath);
    if (data) {
      const buffer = Buffer.from(await data.arrayBuffer());
      const ext = item.thumbnailPath.split(".").pop()?.toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      thumbnail = `data:${mime};base64,${buffer.toString("base64")}`;
    }
  }

  const stream = await renderToStream(
    <KanbanLabelPDF
      baseUrl={ERP_URL ?? ""}
      labels={[
        {
          id: item.id,
          itemId: item.itemId,
          itemName: item.itemName,
          itemReadableId: item.itemId,
          locationName: item.locationName,
          storageUnitId: item.storageUnitId,
          storageUnitName: item.storageUnitName,
          supplierName: item.supplierName,
          quantity: item.quantity,
          unitOfMeasureCode: item.unitOfMeasureCode,
          thumbnail
        }
      ]}
      action="order"
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (d: Uint8Array) => buffers.push(d));
    stream.on("end", () => resolve(Buffer.concat(buffers)));
    stream.on("error", reject);
  });

  return {
    content: body.toString("base64"),
    contentType: "pdf"
  };
}
