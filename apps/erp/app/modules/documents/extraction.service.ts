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
) {
  const result = await client
    .from("documentExtraction")
    .insert(data)
    .select("id, companyId")
    .single();

  if (result.data) {
    // Fire-and-forget: trigger Inngest background job
    await trigger("extract-document", {
      documentExtractionId: result.data.id,
      companyId: result.data.companyId
    });
  }

  return result;
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
