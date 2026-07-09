import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { changeOrderOpenStatuses } from "./change-orders.models";
import { getChangeOrderTypesList } from "./change-orders.service";

// =============================================================================
// Change Orders — item traceability reads (part/tool ↔ CO) and the linked-NCR
// reverse view. Split out of change-orders.service.ts to keep each file focused
// and under the module's 1000-line budget (G4).
// =============================================================================

// G6 — the SINGLE canonical "change orders referencing this item" query,
// parameterized by status. The item-detail history (all COs), the open-CO alert
// (open statuses), and the single-open-CO guard all call this — no forked
// implementations. Spans the three ways a CO references an item: a top-level
// Product Affected, a BOM-change part (Add/Delete), or a BOM-change assembly
// target. Scoped by readableId so it matches the part across all its revisions.
// Flat queries + JS union (no embeds — TS2589 budget).
export type ChangeOrderForItem = {
  id: string;
  changeOrderId: string;
  name: string;
  status: Database["public"]["Enums"]["changeOrderStatus"];
  changeOrderTypeId: string | null;
  effectiveDate: string | null;
  createdAt: string;
};

export async function findChangeOrdersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    statuses?: Database["public"]["Enums"]["changeOrderStatus"][];
  }
): Promise<{ data: ChangeOrderForItem[]; error: { message: string } | null }> {
  const { itemId, companyId, statuses } = args;

  // Resolve every revision (item row) sharing this part's readableId.
  const item = await client
    .from("item")
    .select("readableId")
    .eq("id", itemId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (item.error) return { data: [], error: item.error };
  if (!item.data?.readableId) return { data: [], error: null };

  const siblings = await client
    .from("item")
    .select("id")
    .eq("readableId", item.data.readableId)
    .eq("companyId", companyId);
  if (siblings.error) return { data: [], error: siblings.error };
  const itemIds = (siblings.data ?? []).map((s) => s.id);
  if (itemIds.length === 0) return { data: [], error: null };

  // Collect referencing changeOrderIds from the three relations.
  const [products, bomParts, assemblies] = await Promise.all([
    client
      .from("changeOrderProductAffected")
      .select("changeOrderId")
      .in("itemId", itemIds)
      .eq("companyId", companyId),
    client
      .from("changeOrderBomChange")
      .select("changeOrderId")
      .in("itemId", itemIds)
      .eq("companyId", companyId),
    client
      .from("changeOrderBomChangeAssembly")
      .select("bomChangeId")
      .in("assemblyItemId", itemIds)
      .eq("companyId", companyId)
  ]);
  if (products.error) return { data: [], error: products.error };
  if (bomParts.error) return { data: [], error: bomParts.error };
  if (assemblies.error) return { data: [], error: assemblies.error };

  const coIds = new Set<string>();
  for (const p of products.data ?? []) coIds.add(p.changeOrderId);
  for (const b of bomParts.data ?? []) coIds.add(b.changeOrderId);

  // Assemblies reference the CO via their bom-change row — resolve that hop.
  const bomChangeIds = [
    ...new Set((assemblies.data ?? []).map((a) => a.bomChangeId))
  ];
  if (bomChangeIds.length > 0) {
    const parents = await client
      .from("changeOrderBomChange")
      .select("changeOrderId")
      .in("id", bomChangeIds)
      .eq("companyId", companyId);
    if (parents.error) return { data: [], error: parents.error };
    for (const p of parents.data ?? []) coIds.add(p.changeOrderId);
  }

  if (coIds.size === 0) return { data: [], error: null };

  let query = client
    .from("changeOrder")
    .select(
      "id, changeOrderId, name, status, changeOrderTypeId, effectiveDate, createdAt"
    )
    .in("id", [...coIds])
    .eq("companyId", companyId);
  if (statuses && statuses.length > 0) query = query.in("status", statuses);
  query = query.order("createdAt", { ascending: false });

  const result = await query;
  if (result.error) return { data: [], error: result.error };
  return { data: result.data ?? [], error: null };
}

// Reverse of the Linked-NCR cross-link (4a): every change order that references
// a given non-conformance. Read-only, minimal columns; rendered on the Issue
// detail. Flat select (no embeds — TS2589 budget).
export async function getChangeOrdersForNonConformance(
  client: SupabaseClient<Database>,
  nonConformanceId: string,
  companyId: string
) {
  return client
    .from("changeOrder")
    .select("id, changeOrderId, name, status")
    .eq("nonConformanceId", nonConformanceId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

// Single-open-CO-per-part guard (V1 — no parallel change orders): the OTHER
// open change orders that already reference a part, excluding the current CO.
// Reuses the canonical G6 query at the open-status filter. A non-empty result
// means adding the part here would create a parallel open CO — the routes reject.
export async function findOtherOpenChangeOrdersForItem(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string; excludeChangeOrderId: string }
): Promise<ChangeOrderForItem[]> {
  const { data } = await findChangeOrdersForItem(client, {
    itemId: args.itemId,
    companyId: args.companyId,
    statuses: changeOrderOpenStatuses
  });
  return data.filter((co) => co.id !== args.excludeChangeOrderId);
}

// Loader data for the "Change Orders" history section + open-CO alert on an
// item detail page (part/tool/material) — the CO history for the item plus the
// type lookup used to label rows. One shared source so the detail routes don't
// each re-implement the pair of reads.
export async function getItemChangeOrderData(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [changeOrders, changeOrderTypes] = await Promise.all([
    findChangeOrdersForItem(client, { itemId, companyId }),
    getChangeOrderTypesList(client, companyId)
  ]);
  return {
    changeOrders: changeOrders.data,
    changeOrderTypes: changeOrderTypes.data ?? []
  };
}
