import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { stripSpecialCharacters } from "~/utils/string";
import { sanitize } from "~/utils/supabase";
import { getDocumentType } from "../shared/shared.service";
import type {
  documentLabelsValidator,
  documentSourceTypes,
  documentValidator
} from "./documents.models";

export async function deleteDocument(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("document").delete().eq("id", id);
}

export async function deleteDocumentFavorite(
  client: SupabaseClient<Database>,
  id: string,
  userId: string
) {
  return client
    .from("documentFavorite")
    .delete()
    .eq("documentId", id)
    .eq("userId", userId);
}

export async function deleteDocumentLabel(
  client: SupabaseClient<Database>,
  id: string,
  label: string
) {
  return client
    .from("documentLabel")
    .delete()
    .eq("documentId", id)
    .eq("label", label);
}

export async function getDocument(
  client: SupabaseClient<Database>,
  documentId: string
) {
  return client.from("documents").select("*").eq("id", documentId).single();
}

export async function getDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    favorite?: boolean;
    recent?: boolean;
    createdBy?: string;
    active: boolean;
  }
) {
  let query = client
    .from("documents")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId)
    .eq("active", args.active);

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,description.ilike.%${args.search}%`
    );
  }

  if (args?.favorite) {
    query = query.eq("favorite", true);
  }

  if (args.recent) {
    query = query.order("lastActivityAt", { ascending: false });
  }

  query = setGenericQueryFilters(query, args, [
    { column: "favorite", ascending: false }
  ]);

  return query;
}

export async function getDocumentExtensions(client: SupabaseClient<Database>) {
  return client.from("documentExtensions").select("extension");
}

export async function getDocumentLabels(
  client: SupabaseClient<Database>,
  userId: string
) {
  return client.from("documentLabels").select("*").eq("userId", userId);
}

export async function insertDocumentFavorite(
  client: SupabaseClient<Database>,
  id: string,
  userId: string
) {
  return client.from("documentFavorite").insert({ documentId: id, userId });
}

export async function insertDocumentLabel(
  client: SupabaseClient<Database>,
  id: string,
  label: string,
  userId: string
) {
  return client.from("documentLabel").insert({ documentId: id, label, userId });
}

export async function moveDocumentToTrash(
  client: SupabaseClient<Database>,
  id: string,
  userId: string
) {
  return client
    .from("document")
    .update({
      active: false,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id);
}

export async function restoreDocument(
  client: SupabaseClient<Database>,
  id: string,
  userId: string
) {
  return client
    .from("document")
    .update({
      active: true,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id);
}

type SourceDocumentData = {
  sourceDocument?: (typeof documentSourceTypes)[number];
  sourceDocumentId?: string;
};

export async function upsertDocument(
  client: SupabaseClient<Database>,
  document:
    | (Omit<z.infer<typeof documentValidator>, "id"> & {
        path: string;
        size: number;
        companyId: string;
        createdBy: string;
      } & SourceDocumentData)
    | (Omit<z.infer<typeof documentValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  const type = getDocumentType(document.name ?? "");
  if ("createdBy" in document) {
    return (
      client
        .from("document")
        // @ts-ignore
        .insert({ ...document, type })
        .select("*")
        .single()
    );
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { extension, ...data } = document;
  return client
    .from("document")
    .update(
      sanitize({
        ...data,
        type,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", document.id);
}

export async function updateDocumentFavorite(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    favorite: boolean;
    userId: string;
  }
) {
  const { id, favorite, userId } = args;
  if (!favorite) {
    return client
      .from("documentFavorite")
      .delete()
      .eq("documentId", id)
      .eq("userId", userId);
  } else {
    return client
      .from("documentFavorite")
      .insert({ documentId: id, userId: userId });
  }
}

export async function updateDocumentLabels(
  client: SupabaseClient<Database>,
  document: z.infer<typeof documentLabelsValidator> & {
    userId: string;
  }
) {
  if (!document.labels) {
    throw new Error("No labels provided");
  }

  return client
    .from("documentLabel")
    .delete()
    .eq("documentId", document.documentId)
    .eq("userId", document.userId)
    .then(() => {
      return client.from("documentLabel").insert(
        // @ts-ignore
        document.labels.map((label) => ({
          documentId: document.documentId,
          label,
          userId: document.userId
        }))
      );
    });
}

/**
 * Generates a sales order PDF via the pdfLoader, uploads it to Supabase
 * storage under the opportunity path, and creates a document DB record.
 *
 * Returns the PDF ArrayBuffer (useful for email attachments) and the
 * generated file name.
 */
export async function generateAndAttachSalesOrderPdf(args: {
  /** The original action/loader args from the route */
  routeArgs: LoaderFunctionArgs;
  /** Sales order DB id */
  salesOrderId: string;
  /** Human-readable sales order identifier (e.g. "SO-0001") */
  salesOrderIdentifier: string;
  /** Opportunity the SO belongs to */
  opportunityId: string;
  companyId: string;
  userId: string;
  /** A service-role Supabase client for storage + DB writes */
  serviceRole: SupabaseClient<Database>;
  /** The pdf loader imported from the sales-order pdf route */
  pdfLoader: (args: LoaderFunctionArgs) => Promise<Response>;
}): Promise<{ file: ArrayBuffer; fileName: string }> {
  const {
    routeArgs,
    salesOrderId,
    salesOrderIdentifier,
    opportunityId,
    companyId,
    userId,
    serviceRole,
    pdfLoader
  } = args;

  // 1. Generate the PDF
  const pdfArgs = {
    ...routeArgs,
    params: { ...routeArgs.params, id: salesOrderId }
  };
  const pdf = await pdfLoader(pdfArgs);

  if (pdf.headers.get("content-type") !== "application/pdf") {
    throw new Error("Failed to generate PDF");
  }

  const file = await pdf.arrayBuffer();
  const fileName = stripSpecialCharacters(
    `${salesOrderIdentifier} - ${new Date().toISOString().slice(0, -5)}.pdf`
  );

  // 2. Upload to Supabase storage
  const documentFilePath = `${companyId}/opportunity/${opportunityId}/${fileName}`;

  const uploadResult = await serviceRole.storage
    .from("private")
    .upload(documentFilePath, file, {
      cacheControl: `${12 * 60 * 60}`,
      contentType: "application/pdf",
      upsert: true
    });

  if (uploadResult.error) {
    throw new Error("Failed to upload PDF to storage");
  }

  // 3. Create the document DB record
  const documentResult = await upsertDocument(serviceRole, {
    path: documentFilePath,
    name: fileName,
    size: Math.round(file.byteLength / 1024),
    sourceDocument: "Sales Order",
    sourceDocumentId: salesOrderId,
    readGroups: [userId],
    writeGroups: [userId],
    createdBy: userId,
    companyId
  });

  if (documentResult.error) {
    throw new Error("Failed to create document record");
  }

  return { file, fileName };
}
