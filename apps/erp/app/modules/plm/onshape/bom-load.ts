import type { Database, Json } from "@carbon/database";
import { flattenOnshapeBomRows } from "@carbon/ee/onshape";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getReadableIdWithRevision } from "~/utils/string";
import type {
  BomRow,
  DefaultMethodType,
  ReplenishmentSystem,
  SyncPayloadRow
} from "./onshape-import.types";

// BOM normalization + `sync` edge-fn invoke + phantom flagging.

export function toSyncPayloadRows(bomRows: BomRow[]): SyncPayloadRow[] {
  return bomRows.map((row) => {
    // Onshape quantity is a string; sync requires a number. Guard NaN / ≤0 → 1.
    const q = Number(row.quantity);
    return {
      id: row.id,
      index: row.index,
      readableId: row.readableId,
      revision: row.revision,
      name: row.name,
      quantity: Number.isFinite(q) && q > 0 ? q : 1,
      replenishmentSystem: row.replenishmentSystem,
      defaultMethodType: row.defaultMethodType,
      data: row.data
    };
  });
}

// Pre-resolve every child item id so `sync` takes its update branch and never
// creates a new revisioned item. Library/standard parts with no Carbon match
// keep sync's create-as-Buy behavior.
export async function resolveChildren(
  client: SupabaseClient<Database>,
  args: { bomRows: BomRow[]; companyId: string }
): Promise<{ data: BomRow[] | null; error: { message: string } | null }> {
  const { bomRows, companyId } = args;

  const uniquePNs = new Set(
    bomRows.map((r) => r.readableIdWithRevision).filter(Boolean)
  );

  let matchMap = new Map<string, string>();
  if (uniquePNs.size > 0) {
    const items = await client
      .from("item")
      .select("id, readableIdWithRevision")
      .in("readableIdWithRevision", Array.from(uniquePNs))
      .eq("companyId", companyId);

    if (items.error) {
      return { data: null, error: { message: items.error.message } };
    }
    matchMap = new Map(
      (items.data ?? [])
        .filter((i): i is { id: string; readableIdWithRevision: string } =>
          Boolean(i.readableIdWithRevision)
        )
        .map((i) => [i.readableIdWithRevision, i.id])
    );
  }

  // Build new rows rather than mutating in place — the caller owns `bomRows`.
  const resolvedRows: BomRow[] = bomRows.map((row) => {
    const match = matchMap.get(row.readableIdWithRevision);

    // Phantom flag — excludeFromBom / obsolete / not-revision-managed.
    const data = row.data ?? {};
    let phantomReason: string | null = null;
    if (
      data["Exclude from BOM"] === true ||
      data["Exclude from BOM"] === "true"
    ) {
      phantomReason = "excludeFromBom";
    } else if (
      typeof data["State"] === "string" &&
      data["State"].toLowerCase() === "obsolete"
    ) {
      phantomReason = "obsolete";
    } else if (data["Revision managed"] === false) {
      phantomReason = "notRevisionManaged";
    }

    return {
      ...row,
      ...(match ? { id: match } : {}),
      data: phantomReason
        ? {
            ...data,
            __carbonPhantom: true,
            __carbonPhantomReason: phantomReason
          }
        : data
    };
  });

  return { data: resolvedRows, error: null };
}

// Invoke `sync` against the new revision's Draft makeMethod, then persist phantom
// flags (sync carries no row-level metadata, so we patch customFields after).
export async function loadBomIntoRevision(
  serviceClient: SupabaseClient<Database>,
  args: {
    makeMethodId: string;
    rows: BomRow[];
    companyId: string;
    userId: string;
  }
): Promise<{ error: { message: string } | null }> {
  const { makeMethodId, rows, companyId, userId } = args;

  // makeMethodId is the Draft method, so `sync` writes in place (its Active-fork
  // branch only fires on status === "Active").
  const sync = await serviceClient.functions.invoke("sync", {
    body: {
      type: "onshape",
      makeMethodId,
      data: toSyncPayloadRows(rows),
      companyId,
      userId
    }
  });

  if (sync.error) {
    console.error("Onshape sync failed", sync.error);
    return {
      error: {
        message: `Failed to load Onshape BOM into revision: ${sync.error.message}`
      }
    };
  }

  // Persist phantom flags into methodMaterial.customFields (read-merge-write so
  // existing keys survive). A child can appear at several BOM positions, so
  // match (makeMethodId, itemId) and update every matched row.
  const phantomRows = rows.filter(
    (r) => r.data?.__carbonPhantom === true && r.id
  );
  for (const row of phantomRows) {
    const existingRows = await serviceClient
      .from("methodMaterial")
      .select("id, customFields")
      .eq("makeMethodId", makeMethodId)
      .eq("itemId", row.id as string)
      .eq("companyId", companyId);
    if (existingRows.error) {
      console.error("Failed to read phantom metadata", existingRows.error);
      continue;
    }
    for (const existing of existingRows.data ?? []) {
      const merged: Json = {
        ...((existing.customFields as Record<string, Json> | null) ?? {}),
        __carbonPhantom: true,
        __carbonPhantomReason: row.data?.__carbonPhantomReason ?? null
      };
      const update = await serviceClient
        .from("methodMaterial")
        .update({ customFields: merged })
        .eq("id", existing.id)
        .eq("companyId", companyId);
      if (update.error) {
        // Non-fatal — the BOM is already loaded; phantom annotation is advisory.
        console.error("Failed to persist phantom metadata", update.error);
      }
    }
  }

  return { error: null };
}

// Parse the Onshape BOM via the shared `flattenOnshapeBomRows`, then map each
// row into the BomRow shape. Quantity stays raw (string) — coerced later in
// toSyncPayloadRows.
export function flattenBomResponse(response: unknown): BomRow[] {
  return flattenOnshapeBomRows(response).map((data) => {
    const partNumber = data["Part number"] || data["Name"];
    const revision = data["Revision"];
    const readableIdWithRevision = getReadableIdWithRevision(
      partNumber,
      revision
    );

    const purchased = data["Purchasing Level"] === "Purchased";
    const replenishmentSystem: ReplenishmentSystem = purchased ? "Buy" : "Make";
    const defaultMethodType: DefaultMethodType = purchased
      ? "Pull from Inventory"
      : "Make to Order";

    return {
      index: data["Item"] ?? "",
      readableId: data["Part number"],
      revision: data["Revision"],
      readableIdWithRevision,
      name: data["Name"] || data["Description"] || data["Part number"] || "",
      replenishmentSystem,
      defaultMethodType,
      quantity: data["Quantity"],
      level: data["Item"]?.toString().split(".").length ?? 1,
      data
    };
  });
}
