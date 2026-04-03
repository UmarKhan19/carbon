import type { Database } from "@carbon/database";
import type { TrackedEntityAttributes } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTrackedEntity } from "~/modules/inventory";
import { getCompanySettings } from "~/modules/settings/settings.service";

export async function getEntityLabelData(
  client: SupabaseClient<Database>,
  companyId: string,
  trackedEntityId: string
) {
  const [companySettings, trackedEntity] = await Promise.all([
    getCompanySettings(client, companyId),
    getTrackedEntity(client, trackedEntityId)
  ]);

  if (!trackedEntity.data) {
    return { error: "Tracked entity not found" };
  }

  const item = await client
    .from("item")
    .select("readableId, revision")
    .eq("id", trackedEntity.data.sourceDocumentId ?? "")
    .single();

  if (!item.data) {
    return { error: "Item not found" };
  }

  const labelItem = {
    itemId: item.data.readableId,
    revision: item.data.revision ?? "0",
    number: trackedEntity.data.readableId ?? "",
    trackedEntityId: trackedEntityId,
    quantity: trackedEntity.data.quantity ?? 1,
    trackingType: trackedEntity.data.quantity > 1 ? "Batch" : "Serial",
    // @ts-ignore - columns added in shelf-life migration, types not yet regenerated
    expirationDate: trackedEntity.data.expirationDate ?? null,
    shelfLifeLabelType:
      (trackedEntity.data.attributes as TrackedEntityAttributes)?.[
        "Shelf Life Label Type"
      ] ?? null
  };

  return {
    companySettings,
    labelItem,
    error: null
  };
}
