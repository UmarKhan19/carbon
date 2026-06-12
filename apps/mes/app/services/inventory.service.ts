import { SUPABASE_URL } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type {
  DocumentTemplate,
  DocumentTemplateType
} from "@carbon/documents/template";
import { toDocumentTemplate } from "@carbon/documents/template";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zfd } from "zod-form-data";

/**
 * Load a stored document template as a `DocumentTemplate | null` to pass to a
 * PDF/ZPL generator (which runs it through `resolveTemplate`). Returns null when
 * nothing is stored, so the output falls back to the type's default.
 */
export async function getDocumentTemplateConfig(
  client: SupabaseClient<Database>,
  companyId: string,
  documentType: DocumentTemplateType
): Promise<DocumentTemplate | null> {
  const stored = await client
    .from("documentTemplate")
    .select("*")
    .eq("companyId", companyId)
    .eq("documentType", documentType)
    .maybeSingle();
  return toDocumentTemplate(stored.data, documentType);
}

export const inventoryAdjustmentValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  storageUnitId: zfd.text(z.string().optional()),
  entryType: z.enum(["Positive Adjmt.", "Negative Adjmt."]),
  quantity: zfd.numeric(z.number().min(1, { message: "Quantity is required" }))
});

export async function getBatchNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    isReadOnly?: boolean;
  }
) {
  let itemIds = [args.itemId];
  const item = await client
    .from("item")
    .select("*")
    .eq("id", args.itemId)
    .single();
  if (item.data?.type === "Material") {
    const items = await client
      .from("item")
      .select("id")
      .eq("readableId", item.data.readableId)
      .eq("companyId", args.companyId);
    if (items.data?.length) {
      itemIds = items.data.map((item) => item.id);
    }
  }

  return client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .in("sourceDocumentId", itemIds)
    .eq("companyId", args.companyId)
    .gt("quantity", 0);
}

export async function getCompanySettings(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companySettings")
    .select("*")
    .eq("id", companyId)
    .single();
}

const PUBLIC_STORAGE_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/public/`;

export async function getCompany(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const company = await client
    .from("company")
    .select("*")
    .eq("id", companyId)
    .single();
  if (company.error || !company.data) return company;
  // Logos are stored as storage paths; expand to full public URLs (matches the
  // ERP getCompany) so they're fetchable by the PDF/ZPL pipeline.
  const url = (p: string | null) =>
    p ? `${PUBLIC_STORAGE_URL_PREFIX}${p}` : p;
  return {
    data: {
      ...company.data,
      logoLight: url(company.data.logoLight),
      logoDark: url(company.data.logoDark),
      logoLightIcon: url(company.data.logoLightIcon),
      logoDarkIcon: url(company.data.logoDarkIcon)
    },
    error: null
  };
}

export async function getSerialNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
  }
) {
  let itemIds = [args.itemId];
  const item = await client
    .from("item")
    .select("*")
    .eq("id", args.itemId)
    .single();
  if (item.data?.type === "Material") {
    const items = await client
      .from("item")
      .select("id")
      .eq("readableId", item.data.readableId)
      .eq("companyId", args.companyId);
    if (items.data?.length) {
      itemIds = items.data.map((item) => item.id);
    }
  }

  return client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .in("sourceDocumentId", itemIds)
    .eq("companyId", args.companyId)
    .eq("status", "Available")
    .gt("quantity", 0);
}

export async function insertManualInventoryAdjustment(
  client: SupabaseClient<Database>,
  inventoryAdjustment: z.infer<typeof inventoryAdjustmentValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  // Check if it's a negative adjustment and if the quantity is sufficient
  if (inventoryAdjustment.entryType === "Negative Adjmt.") {
    inventoryAdjustment.quantity = -Math.abs(inventoryAdjustment.quantity);
  }

  return client
    .from("itemLedger")
    .insert([inventoryAdjustment])
    .select("*")
    .single();
}
