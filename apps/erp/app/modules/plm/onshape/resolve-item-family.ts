import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

import { upsertPart } from "../../items/items.service";
import type {
  BomRow,
  OnshapeReleasedObject,
  ResolveItemFamily
} from "./onshape-import.types";

// Identity resolution + base-item creation for the Onshape import.

// The top-level assembly row (index === "1" or, failing that, the lowest level)
// supplies replenishment/method defaults for the family head in createBaseItem.
export function pickTopRow(bomRows: BomRow[]): BomRow | undefined {
  if (bomRows.length === 0) return undefined;
  const byIndex = bomRows.find((r) => r.index === "1");
  if (byIndex) return byIndex;
  return bomRows.reduce((lowest, row) =>
    row.level < lowest.level ? row : lowest
  );
}

export async function resolveItemFamily(
  client: SupabaseClient<Database>,
  args: { revisionId: string; partNumber: string; companyId: string }
): Promise<{
  data: ResolveItemFamily | null;
  error: { message: string } | null;
}> {
  // Has this exact revision already been synced?
  const synced = await client
    .from("externalIntegrationMapping")
    .select("entityId, metadata")
    .eq("entityType", "item")
    .eq("integration", "onshape")
    .eq("externalId", args.revisionId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (synced.error) {
    return { data: null, error: { message: synced.error.message } };
  }
  if (synced.data?.entityId) {
    return {
      data: { kind: "alreadySynced", itemId: synced.data.entityId },
      error: null
    };
  }

  // Find the part family by readableId. The seed matters because createRevision
  // clones the seed's method tree — prefer the released revision (Production) as
  // the canonical baseline, else the newest member.
  const family = await client
    .from("item")
    .select(
      "id, readableId, revision, revisionStatus, type, replenishmentSystem, defaultMethodType"
    )
    .eq("readableId", args.partNumber)
    .eq("companyId", args.companyId)
    .eq("type", "Part")
    .order("createdAt", { ascending: false });

  if (family.error) {
    return { data: null, error: { message: family.error.message } };
  }

  const members = family.data ?? [];
  if (members.length > 0) {
    const production = members.find((m) => m.revisionStatus === "Production");
    // members is ordered newest-first.
    const seed = production ?? members[0];
    return { data: { kind: "family", itemId: seed.id }, error: null };
  }

  return { data: { kind: "none" }, error: null };
}

export async function createBaseItem(
  client: SupabaseClient<Database>,
  args: {
    object: OnshapeReleasedObject;
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { object, companyId, userId } = args;
  const top = pickTopRow(object.bomRows);

  // Create the family head at revision "0" — createPendingRevision computes the
  // next label; we don't seed Onshape's literal one. Replenishment/method
  // default off the BOM top row, else a Make assembly head.
  const part = await upsertPart(client, {
    id: object.partNumber,
    revision: "0",
    name: object.name,
    description: object.description,
    replenishmentSystem: top?.replenishmentSystem ?? "Make",
    defaultMethodType: top?.defaultMethodType ?? "Make to Order",
    itemTrackingType: "Inventory",
    unitOfMeasureCode: "EA",
    shelfLifeCalculateFromBom: false,
    companyId,
    createdBy: userId
  });

  if (part.error || !part.data) {
    return {
      data: null,
      error: { message: part.error?.message ?? "Failed to create base item" }
    };
  }

  return { data: { id: part.data.id }, error: null };
}
