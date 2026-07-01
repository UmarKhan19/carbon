import type { Database } from "@carbon/database";
import { trigger } from "@carbon/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function insertDocumentExtraction(
  client: SupabaseClient<Database>,
  data: {
    storagePath: string;
    documentType: "purchaseInvoice" | "salesRfq";
    sourceDocument: string;
    sourceDocumentId?: string;
    companyId: string;
    createdBy: string;
  }
): Promise<{
  data: { id: string; companyId: string } | null;
  error: { message: string } | null;
}> {
  const result = await client
    .from("documentExtraction")
    .insert(data)
    .select("id, companyId")
    .single();

  if (result.error || !result.data) {
    return { data: result.data, error: result.error };
  }

  // Enqueue the Inngest job. If enqueue fails the row would otherwise sit at
  // `pending` forever, so mark it failed and surface the error to the caller.
  try {
    await trigger("extract-document", {
      documentExtractionId: result.data.id,
      companyId: result.data.companyId
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to enqueue extraction job";
    await client
      .from("documentExtraction")
      .update({
        status: "failed",
        error: message,
        updatedBy: data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", result.data.id)
      .eq("companyId", result.data.companyId);
    return { data: result.data, error: { message } };
  }

  return { data: result.data, error: null };
}

export async function getDocumentExtraction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("documentExtraction").select("*").eq("id", id).single();
}

export async function getDocumentExtractionsBySource(
  client: SupabaseClient<Database>,
  sourceDocumentId: string
) {
  return client
    .from("documentExtraction")
    .select("*")
    .eq("sourceDocumentId", sourceDocumentId)
    .order("createdAt", { ascending: false });
}
