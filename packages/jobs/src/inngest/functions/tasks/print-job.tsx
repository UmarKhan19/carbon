// This file is .tsx because the built-in kanban renderer uses JSX
// to render a React PDF component (KanbanLabelPDF) via renderToStream.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { KanbanLabelPDF } from "@carbon/documents/pdf";
import { generateProductLabelZPL } from "@carbon/documents/zpl";
import { BINDERY_PRESS_API_KEY, ERP_URL } from "@carbon/env";
import type {
  DocumentTypeDefinition,
  PrintingSettings
} from "@carbon/printing";
import {
  createPrintJob,
  getDocumentType,
  getDocumentTypesForSource,
  getPrinterRoute,
  renderWithBinderyPress,
  updatePrintJobContent,
  updatePrintJobStatus
} from "@carbon/printing";
import { labelSizes, type ProductLabelItem } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";

type Payload = {
  sourceDocument: string;
  sourceDocumentId: string;
  companyId: string;
  userId: string;
  locationId?: string;
  workCenterId?: string;
};

type GeneratedContent = {
  content: string;
  contentType: "zpl" | "pdf";
};

type ResolvedData = {
  items: Record<string, unknown>[];
  readableId: string | null;
};

type ResolverFn = (
  client: SupabaseClient<Database>,
  sourceDocument: string,
  sourceDocumentId: string,
  companyId: string
) => Promise<ResolvedData | null>;

const resolvers: Record<string, ResolverFn> = {
  productLabel: resolveTrackedEntityData,
  kanbanCard: resolveKanbanData
};

export const printJobFunction = inngest.createFunction(
  { id: "print-job", retries: 0 },
  { event: "carbon/print-job" },
  async ({ event, step }) => {
    const client = getCarbonServiceRole();
    const payload: Payload = event.data;
    const {
      sourceDocument,
      sourceDocumentId,
      companyId,
      userId,
      locationId,
      workCenterId
    } = payload;

    const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();
    const { count: recentJobCount } = await client
      .from("printJob")
      .select("id", { count: "exact", head: true })
      .eq("sourceDocumentId", sourceDocumentId)
      .eq("companyId", companyId)
      .eq("origin", "auto")
      .gte("createdAt", thirtySecondsAgo);

    if (recentJobCount && recentJobCount > 0) {
      throw new NonRetriableError(
        `Print jobs already exist for ${sourceDocument} ${sourceDocumentId}`
      );
    }

    const { data: companySettings } = await client
      .from("companySettings")
      .select("printing")
      .eq("id", companyId)
      .single();

    const printing = companySettings?.printing as PrintingSettings | null;

    const documentTypeIds = getDocumentTypesForSource(sourceDocument);
    const allPrintJobIds: string[] = [];

    for (const documentTypeId of documentTypeIds) {
      const docType = getDocumentType(documentTypeId);
      if (!docType) continue;

      const printJobIds = await processDocumentType(client, step, {
        docType,
        sourceDocument,
        sourceDocumentId,
        companyId,
        userId,
        locationId,
        workCenterId,
        printing,
        mediaSizeId: "label2x1"
      });

      allPrintJobIds.push(...printJobIds);
    }

    return { printJobIds: allPrintJobIds, count: allPrintJobIds.length };
  }
);

async function processDocumentType(
  client: SupabaseClient<Database>,
  step: {
    sendEvent: (
      id: string,
      payload: { name: string; data: Record<string, unknown> }
    ) => Promise<unknown>;
  },
  ctx: {
    docType: DocumentTypeDefinition;
    sourceDocument: string;
    sourceDocumentId: string;
    companyId: string;
    userId: string;
    locationId?: string;
    workCenterId?: string;
    printing: PrintingSettings | null;
    mediaSizeId: string;
  }
): Promise<string[]> {
  const {
    docType,
    sourceDocument,
    sourceDocumentId,
    companyId,
    userId,
    locationId,
    workCenterId,
    printing,
    mediaSizeId: fallbackMediaSizeId
  } = ctx;

  const locationAssignment = locationId
    ? (printing?.assignments?.[locationId] ?? null)
    : null;

  let printerRouteId: string | null = null;
  if (locationAssignment) {
    if (sourceDocument === "Shipment") {
      printerRouteId = locationAssignment.shipping.printerRouteId;
    } else if (sourceDocument === "Receipt") {
      printerRouteId = locationAssignment.receiving.printerRouteId;
    } else if (workCenterId) {
      printerRouteId =
        locationAssignment.workCenters[workCenterId]?.printerRouteId ?? null;
    }
    if (!printerRouteId) {
      printerRouteId = locationAssignment.defaultPrinterRouteId;
    }
  }

  let printerUrl = "";
  let format: "zpl" | "pdf" = docType.defaultFormat;
  let mediaSizeId = fallbackMediaSizeId;
  let templateId: string | null = null;

  if (printerRouteId) {
    const { data: route } = await getPrinterRoute(
      client,
      printerRouteId,
      companyId
    );
    if (route) {
      printerUrl = route.printerUrl;
      format = route.format as "zpl" | "pdf";
      if (route.mediaSizeId) mediaSizeId = route.mediaSizeId;
      templateId = route.templateId ?? null;
    }
  }

  const resolver = resolvers[docType.id];
  if (!resolver) {
    console.warn(
      `No data resolver registered for document type: ${docType.id}. Add a resolver to the resolvers map in print-job.tsx.`
    );
    return [];
  }

  const resolved = await resolver(
    client,
    sourceDocument,
    sourceDocumentId,
    companyId
  );
  if (!resolved || resolved.items.length === 0) return [];

  const printJobIds: string[] = [];

  for await (const item of resolved.items) {
    const parts = [resolved.readableId ?? sourceDocumentId];
    if (item?.itemId) parts.push(String(item.itemId));
    if (item?.number) parts.push(String(item.number));
    const description = parts.join(" — ");

    const job = await createPrintJob(client, {
      companyId,
      printerUrl,
      sourceDocument,
      sourceDocumentId,
      sourceDocumentReadableId: resolved.readableId ?? undefined,
      description,
      status: "generating",
      origin: "auto",
      createdBy: userId
    });

    if (job.error || !job.data) {
      console.error(`Failed to create print job: ${job.error?.message}`);
      continue;
    }

    const jobId = job.data.id;
    printJobIds.push(jobId);

    try {
      let content: GeneratedContent | null = null;

      if (templateId && BINDERY_PRESS_API_KEY) {
        const results = await renderViaBinderyPress(
          {
            items: [item as Record<string, unknown>],
            readableId: resolved.readableId
          },
          templateId,
          BINDERY_PRESS_API_KEY,
          format
        );
        content = results[0] ?? null;
      } else if (docType.builtInRenderer) {
        const results = await renderBuiltIn(
          client,
          {
            items: [item as Record<string, unknown>],
            readableId: resolved.readableId
          },
          docType,
          format,
          mediaSizeId
        );
        content = results[0] ?? null;
      } else {
        await updatePrintJobStatus(client, jobId, companyId, "failed", {
          error: `Document type "${docType.id}" requires a BinderyPress template.`
        });
        continue;
      }

      if (!content) {
        await updatePrintJobStatus(client, jobId, companyId, "failed", {
          error: "No content generated for this item"
        });
        continue;
      }

      await updatePrintJobContent(
        client,
        jobId,
        companyId,
        content.content,
        content.contentType
      );

      if (printerUrl) {
        await step.sendEvent(`deliver-${jobId}`, {
          name: "carbon/print-job-deliver",
          data: { printJobId: jobId, companyId }
        });
      } else {
        await updatePrintJobStatus(client, jobId, companyId, "completed");
      }
    } catch (renderError) {
      const message =
        renderError instanceof Error
          ? renderError.message
          : String(renderError);
      console.error(`Rendering failed for job ${jobId}: ${message}`);
      await updatePrintJobStatus(client, jobId, companyId, "failed", {
        error: `Rendering failed: ${message}`
      });
    }
  }

  return printJobIds;
}

async function resolveTrackedEntityData(
  client: SupabaseClient<Database>,
  sourceDocument: string,
  sourceDocumentId: string,
  companyId: string
): Promise<ResolvedData | null> {
  const { trackedEntities, readableId } = await queryTrackedEntities(
    client,
    sourceDocument,
    sourceDocumentId,
    companyId
  );

  if (!trackedEntities?.length) return null;

  const items = await enrichTrackedEntities(client, trackedEntities);
  if (items.length === 0) return null;

  return {
    items: items.map((item) => ({
      itemId: item.itemId,
      revision: item.revision,
      number: item.number,
      trackedEntityId: item.trackedEntityId,
      quantity: item.quantity,
      trackingType: item.trackingType
    })),
    readableId
  };
}

async function resolveKanbanData(
  client: SupabaseClient<Database>,
  _sourceDocument: string,
  sourceDocumentId: string,
  _companyId: string
): Promise<ResolvedData | null> {
  const { data: kanban } = await client
    .from("kanbans")
    .select("*")
    .eq("id", sourceDocumentId)
    .single();

  if (!kanban) return null;

  const kanbanUrl = `${ERP_URL ?? ""}/api/kanban/${sourceDocumentId}`;

  return {
    items: [
      {
        id: sourceDocumentId,
        kanbanUrl,
        itemId: kanban.readableIdWithRevision || kanban.itemId,
        itemName: kanban.name || "",
        locationName: kanban.locationName || "",
        storageUnitId: kanban.storageUnitId,
        storageUnitName: kanban.storageUnitName,
        supplierName: kanban.supplierName,
        quantity: kanban.quantity ?? 0,
        unitOfMeasureCode: kanban.purchaseUnitOfMeasureCode,
        thumbnailPath: kanban.thumbnailPath
      }
    ],
    readableId: kanban.readableIdWithRevision ?? null
  };
}

async function renderViaBinderyPress(
  resolved: ResolvedData,
  templateId: string,
  apiKey: string,
  format: "zpl" | "pdf"
): Promise<GeneratedContent[]> {
  const results: GeneratedContent[] = [];

  for (const item of resolved.items) {
    const result = await renderWithBinderyPress({
      apiKey,
      templateId,
      data: item,
      format
    });

    results.push({
      content: result.content,
      contentType: result.contentType
    });
  }

  return results;
}

async function renderBuiltIn(
  client: SupabaseClient<Database>,
  resolved: ResolvedData,
  docType: DocumentTypeDefinition,
  format: "zpl" | "pdf",
  mediaSizeId: string
): Promise<GeneratedContent[]> {
  switch (docType.id) {
    case "productLabel":
      return renderBuiltInProductLabel(resolved, format, mediaSizeId);
    case "kanbanCard":
      return renderBuiltInKanban(client, resolved, format);
    default:
      throw new Error(`No built-in renderer for ${docType.id}`);
  }
}

function renderBuiltInProductLabel(
  resolved: ResolvedData,
  format: "zpl" | "pdf",
  mediaSizeId: string
): GeneratedContent[] {
  if (format === "pdf") {
    throw new Error(
      "Built-in product label generation only supports ZPL printers. Use a BinderyPress template for PDF output."
    );
  }

  const mediaSize = labelSizes.find((s) => s.id === mediaSizeId);
  if (!mediaSize?.zpl) {
    throw new Error(`Media size ${mediaSizeId} does not support ZPL`);
  }

  return resolved.items.map((item) => {
    const labelItem: ProductLabelItem = {
      itemId: item.itemId as string,
      revision: (item.revision as string) ?? "0",
      number: (item.number as string) ?? "",
      trackedEntityId: item.trackedEntityId as string,
      quantity: (item.quantity as number) ?? 1,
      trackingType: (item.trackingType as string) ?? "Serial"
    };

    return {
      content: generateProductLabelZPL(labelItem, mediaSize),
      contentType: "zpl" as const
    };
  });
}

async function renderBuiltInKanban(
  client: SupabaseClient<Database>,
  resolved: ResolvedData,
  format: "zpl" | "pdf"
): Promise<GeneratedContent[]> {
  if (format === "zpl") {
    throw new Error(
      "Built-in kanban card generation only supports PDF printers."
    );
  }

  const item = resolved.items[0];
  if (!item) return [];

  let thumbnail: string | null = null;
  const thumbnailPath = item.thumbnailPath as string | null;
  if (thumbnailPath) {
    const { data } = await client.storage
      .from("private")
      .download(thumbnailPath);
    if (data) {
      const buffer = Buffer.from(await data.arrayBuffer());
      const ext = thumbnailPath.split(".").pop()?.toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      thumbnail = `data:${mime};base64,${buffer.toString("base64")}`;
    }
  }

  const stream = await renderToStream(
    <KanbanLabelPDF
      baseUrl={ERP_URL ?? ""}
      labels={[
        {
          id: item.id as string,
          itemId: item.itemId as string,
          itemName: (item.itemName as string) || "",
          itemReadableId: item.itemId as string,
          locationName: (item.locationName as string) || "",
          storageUnitId: item.storageUnitId as string | undefined,
          storageUnitName: item.storageUnitName as string | undefined,
          supplierName: item.supplierName as string | undefined,
          quantity: (item.quantity as number) ?? 0,
          unitOfMeasureCode: item.unitOfMeasureCode as string | undefined,
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

  return [
    {
      content: body.toString("base64"),
      contentType: "pdf" as const
    }
  ];
}

async function queryTrackedEntities(
  client: SupabaseClient<Database>,
  sourceDocument: string,
  sourceDocumentId: string,
  companyId: string
): Promise<{
  trackedEntities:
    | Database["public"]["Tables"]["trackedEntity"]["Row"][]
    | null;
  readableId: string | null;
}> {
  switch (sourceDocument) {
    case "Receipt": {
      const { data: receipt } = await client
        .from("receipt")
        .select("receiptId")
        .eq("id", sourceDocumentId)
        .single();

      const { data: trackedEntities } = await client
        .from("trackedEntity")
        .select("*")
        .eq("attributes ->> Receipt", sourceDocumentId)
        .eq("companyId", companyId);

      return { trackedEntities, readableId: receipt?.receiptId ?? null };
    }
    case "Shipment": {
      const { data: shipment } = await client
        .from("shipment")
        .select("shipmentId")
        .eq("id", sourceDocumentId)
        .single();

      const { data: trackedEntities } = await client
        .from("trackedEntity")
        .select("*")
        .eq("attributes ->> Shipment", sourceDocumentId)
        .eq("companyId", companyId);

      return { trackedEntities, readableId: shipment?.shipmentId ?? null };
    }
    case "Operation": {
      const { data: jobOperation } = await client
        .from("jobOperation")
        .select(
          "jobMakeMethodId, ...jobMakeMethod(...item(readableIdWithRevision))"
        )
        .eq("id", sourceDocumentId)
        .single();

      if (!jobOperation?.jobMakeMethodId)
        return { trackedEntities: null, readableId: null };

      const { data: trackedEntities } = await client
        .from("trackedEntity")
        .select("*")
        .eq("attributes->>Job Make Method", jobOperation?.jobMakeMethodId)
        .order("createdAt", { ascending: true });

      return {
        trackedEntities,
        readableId: jobOperation.readableIdWithRevision ?? null
      };
    }
    case "Entity": {
      const { data: trackedEntity } = await client
        .from("trackedEntity")
        .select("*")
        .eq("id", sourceDocumentId)
        .single();

      return {
        trackedEntities: trackedEntity ? [trackedEntity] : null,
        readableId: trackedEntity?.readableId ?? null
      };
    }
    default:
      return { trackedEntities: null, readableId: null };
  }
}

async function enrichTrackedEntities(
  client: SupabaseClient<Database>,
  trackedEntities: Database["public"]["Tables"]["trackedEntity"]["Row"][]
): Promise<ProductLabelItem[]> {
  const sourceDocIds = [
    ...new Set(
      trackedEntities
        .map((te) => te.sourceDocumentId)
        .filter(Boolean) as string[]
    )
  ];

  const { data: items } = await client
    .from("item")
    .select("id, readableId, revision")
    .in("id", sourceDocIds);

  const itemMap = new Map(items?.map((i) => [i.id, i]) ?? []);

  return trackedEntities
    .map((te) => {
      const item = itemMap.get(te.sourceDocumentId ?? "");
      if (!item) return null;

      return {
        itemId: item.readableId,
        revision: item.revision ?? "0",
        number: te.readableId ?? "",
        trackedEntityId: te.id,
        quantity: te.quantity ?? 1,
        trackingType: (te.quantity ?? 1) > 1 ? "Batch" : ("Serial" as string)
      };
    })
    .filter(Boolean) as ProductLabelItem[];
}
