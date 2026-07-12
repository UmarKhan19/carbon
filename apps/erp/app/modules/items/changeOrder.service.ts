import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type { nonConformancePriority } from "../quality/quality.models";
import type {
  ChangeOrderError,
  changeOrderStatus,
  changeOrderType
} from "./changeOrder.models";
import { isAllowedChangeOrderTransition } from "./changeOrder.models";

// =============================================================================
// Change Orders — header CRUD, stage transitions, list, and CO Types config.
// =============================================================================

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------
export async function getChangeOrder(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
) {
  return client
    .from("changeOrder")
    .select("*")
    .eq("id", changeOrderId)
    .eq("companyId", companyId)
    .single();
}

export async function getChangeOrders(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("changeOrder")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `changeOrderId.ilike.%${args.search}%,name.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "changeOrderId", ascending: false }
    ]);
  }

  return query;
}

// -----------------------------------------------------------------------------
// Header CRUD
// -----------------------------------------------------------------------------
export async function insertChangeOrder(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    changeOrderId?: string;
    name: string;
    type?: (typeof changeOrderType)[number];
    priority?: (typeof nonConformancePriority)[number];
    changeOrderTypeId?: string;
    nonConformanceId?: string;
    openDate: string;
    reasonForChange?: Json;
    description?: Json;
    dueDate?: string;
    effectiveDate?: string;
    assignee?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; changeOrderId: string } | null;
  error: ChangeOrderError | null;
}> {
  let changeOrderId: string;
  if (input.changeOrderId) {
    changeOrderId = input.changeOrderId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "changeOrder",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error: seq.error ?? {
          message: "Failed to generate changeOrder sequence"
        }
      };
    }
    changeOrderId = seq.data;
  }

  const result = await client
    .from("changeOrder")
    .insert({
      changeOrderId,
      name: input.name,
      type: input.type ?? "Engineering",
      priority: input.priority ?? null,
      changeOrderTypeId: input.changeOrderTypeId ?? null,
      nonConformanceId: input.nonConformanceId ?? null,
      openDate: input.openDate,
      reasonForChange: input.reasonForChange ?? {},
      description: input.description ?? {},
      dueDate: input.dueDate ?? null,
      effectiveDate: input.effectiveDate ?? null,
      assignee: input.assignee ?? null,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy
    })
    .select("id, changeOrderId")
    .single();

  if (result.error || !result.data) {
    return { data: null, error: result.error };
  }

  return {
    data: { id: result.data.id, changeOrderId: result.data.changeOrderId },
    error: null
  };
}

export async function updateChangeOrder(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    changeOrderId?: string;
    name?: string;
    type?: (typeof changeOrderType)[number];
    priority?: (typeof nonConformancePriority)[number] | null;
    changeOrderTypeId?: string | null;
    nonConformanceId?: string | null;
    openDate?: string;
    reasonForChange?: Json;
    description?: Json;
    dueDate?: string | null;
    effectiveDate?: string | null;
    assignee?: string | null;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: ChangeOrderError | null;
}> {
  const { id, ...rest } = input;
  const result = await client
    .from("changeOrder")
    .update(sanitize(rest))
    .eq("id", id)
    .select("id")
    .single();

  if (result.error) return { data: null, error: result.error };
  return { data: { id: result.data.id }, error: null };
}

export async function deleteChangeOrder(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
) {
  // Children (products affected, BOM changes + assemblies, action tasks)
  // cascade via their FK ON DELETE CASCADE.
  return client
    .from("changeOrder")
    .delete()
    .eq("id", changeOrderId)
    .eq("companyId", companyId);
}

// -----------------------------------------------------------------------------
// Stage transition — the single guarded writer (G8), a compare-and-swap (G2).
// Forward-only (isAllowedChangeOrderTransition).
// -----------------------------------------------------------------------------
export async function updateChangeOrderStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    companyId: string;
    fromStatus: (typeof changeOrderStatus)[number];
    toStatus: (typeof changeOrderStatus)[number];
    assignee?: string | null;
    effectiveDate?: string | null;
    updatedBy: string;
  }
): Promise<{
  data: { id: string; status: (typeof changeOrderStatus)[number] } | null;
  error: { message: string } | null;
}> {
  const { id, companyId, fromStatus, toStatus, ...rest } = update;

  if (!isAllowedChangeOrderTransition(fromStatus, toStatus)) {
    return {
      data: null,
      error: {
        message: `Cannot change status from ${fromStatus} to ${toStatus}`
      }
    };
  }

  // Build the update explicitly rather than sanitize({...rest}): sanitize coerces
  // every `undefined` field to null, which would wipe an existing
  // assignee/effectiveDate on a transition where the caller passes those as
  // undefined. Only set an optional field when the caller provided a value.
  const payload: {
    status: (typeof changeOrderStatus)[number];
    updatedBy: string;
    assignee?: string | null;
    effectiveDate?: string | null;
  } = { status: toStatus, updatedBy: rest.updatedBy };
  if (rest.assignee !== undefined) payload.assignee = rest.assignee;
  if (rest.effectiveDate !== undefined)
    payload.effectiveDate = rest.effectiveDate;

  const result = await client
    .from("changeOrder")
    .update(payload)
    .eq("id", id)
    .eq("companyId", companyId)
    .eq("status", fromStatus)
    .select("id, status")
    .maybeSingle();

  if (result.error) return { data: null, error: result.error };
  if (!result.data) {
    return {
      data: null,
      error: {
        message:
          "The change order was updated by someone else. Refresh and try again."
      }
    };
  }
  return { data: result.data, error: null };
}

// -----------------------------------------------------------------------------
// Change Order Types (the "Category" lookup — configured like Issue Types)
// -----------------------------------------------------------------------------
export async function getChangeOrderTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("changeOrderType")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getChangeOrderTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("changeOrderType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name", { ascending: true });
}

export async function getChangeOrderType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderType").select("*").eq("id", id).single();
}

export async function upsertChangeOrderType(
  client: SupabaseClient<Database>,
  changeOrderType:
    | {
        name: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      }
    | {
        id: string;
        name: string;
        updatedBy: string;
        customFields?: Json;
      }
) {
  if ("createdBy" in changeOrderType) {
    return client
      .from("changeOrderType")
      .insert([changeOrderType])
      .select("id")
      .single();
  }
  return client
    .from("changeOrderType")
    .update(sanitize(changeOrderType))
    .eq("id", changeOrderType.id)
    .select("id")
    .single();
}

export async function deleteChangeOrderType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderType").delete().eq("id", id);
}

// =============================================================================
// Phase 2 — Products Affected
// =============================================================================

// A minimal item label. Joins to `item` throughout Phase 2 are done as separate
// FLAT scalar selects + a JS stitch (via getItemLabelMap) rather than PostgREST
// embeds: an embedded select instantiates PostgREST's deeply-recursive relation
// parser, and across the module that pushed TS's global instantiation budget
// over the edge (TS2589 in unrelated files). Flat selects barely instantiate.
export type ChangeOrderItemLabel = {
  id: string;
  readableIdWithRevision: string | null;
  name: string;
  type: Database["public"]["Enums"]["itemType"];
  active: boolean;
  revisionStatus: Database["public"]["Enums"]["itemRevisionStatus"];
};

async function getItemLabelMap(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
): Promise<Map<string, ChangeOrderItemLabel>> {
  const ids = [...new Set(itemIds)];
  const map = new Map<string, ChangeOrderItemLabel>();
  if (ids.length === 0) return map;
  const items = await client
    .from("item")
    .select("id, readableIdWithRevision, name, type, active, revisionStatus")
    .in("id", ids)
    .eq("companyId", companyId);
  for (const it of items.data ?? []) map.set(it.id, it);
  return map;
}

// Climb the BOM (methodMaterial → makeMethod → item) from a set of start items up
// to the top-level products — items that are used by nothing. Returns each product
// with `sourceItemIds`: which of the start items (the targeted assemblies) rolled up
// into it (provenance, for the "affected by" display). Flat queries (no PostgREST
// embeds — TS2589 budget); a per-item origin set that only grows drives a fixpoint,
// so a corrupt/cyclic BOM can't loop forever and provenance fully propagates.
// `nodeBudget` is a pure infinite-loop backstop, not a depth limit.
export async function getTopLevelProductsForItems(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
): Promise<{
  data: Array<{ productId: string; sourceItemIds: string[] }>;
  error: { message: string } | null;
}> {
  const start = [...new Set(itemIds.filter(Boolean))];
  if (start.length === 0) return { data: [], error: null };

  // origins[item] = the start items (targeted assemblies) that reach it.
  const origins = new Map<string, Set<string>>();
  for (const s of start) origins.set(s, new Set([s]));
  // parentsCache[item] = its immediate parent items (one level up), fetched once.
  const parentsCache = new Map<string, Set<string>>();
  const roots = new Map<string, Set<string>>();

  const fetchParents = async (ids: string[]) => {
    const unknown = ids.filter((id) => !parentsCache.has(id));
    if (unknown.length === 0) return;
    for (const id of unknown) parentsCache.set(id, new Set());

    const materials = await client
      .from("methodMaterial")
      .select("itemId, makeMethodId")
      .in("itemId", unknown)
      .eq("companyId", companyId);
    if (materials.error) throw materials.error;

    const makeMethodIds = [
      ...new Set((materials.data ?? []).map((m) => m.makeMethodId))
    ];
    const parentByMethod = new Map<string, string>();
    if (makeMethodIds.length > 0) {
      const methods = await client
        .from("makeMethod")
        .select("id, itemId")
        .in("id", makeMethodIds)
        .eq("companyId", companyId);
      if (methods.error) throw methods.error;
      for (const mm of methods.data ?? []) parentByMethod.set(mm.id, mm.itemId);
    }
    for (const row of materials.data ?? []) {
      const parent = parentByMethod.get(row.makeMethodId);
      if (parent) parentsCache.get(row.itemId)?.add(parent);
    }
  };

  let queue = [...start];
  let nodeBudget = 20000;
  try {
    while (queue.length > 0 && nodeBudget > 0) {
      const batch = [...new Set(queue)];
      queue = [];
      nodeBudget -= batch.length;
      await fetchParents(batch);

      for (const id of batch) {
        const parents = parentsCache.get(id);
        const idOrigins = origins.get(id) ?? new Set<string>();

        if (!parents || parents.size === 0) {
          // used by nothing → a top-level product; record its origins
          if (!roots.has(id)) roots.set(id, new Set());
          const rootOrigins = roots.get(id)!;
          for (const o of idOrigins) rootOrigins.add(o);
          continue;
        }

        for (const parent of parents) {
          if (!origins.has(parent)) origins.set(parent, new Set());
          const target = origins.get(parent)!;
          const before = target.size;
          for (const o of idOrigins) target.add(o);
          // Re-enqueue when the parent's origin set grew (monotonic, finite → the
          // loop terminates even on cyclic data) so provenance fully propagates.
          if (target.size > before) queue.push(parent);
        }
      }
    }
  } catch (err) {
    return { data: [], error: { message: (err as Error).message } };
  }

  return {
    data: [...roots.entries()].map(([productId, srcs]) => ({
      productId,
      sourceItemIds: [...srcs]
    })),
    error: null
  };
}

// G3 — forward-reference to a not-yet-synced part. Mints a REAL item row
// (active=false, revisionStatus='Design') through the standard item shape so
// `changeOrderStagedMaterial.itemId` is always non-null and no placeholder branch
// is threaded downstream. Onshape sync reconciles by matching readableId+company
// (flip active, fill details). A cancelled CO can leave an inactive stub — it's
// filterable and tied to the CO, far cheaper than nullable-threading everywhere.
export async function mintPlaceholderPart(
  client: SupabaseClient<Database>,
  input: {
    readableId: string;
    name: string;
    companyId: string;
    createdBy: string;
    unitOfMeasureCode?: string;
  }
): Promise<{
  data: { id: string } | null;
  error: ChangeOrderError | null;
}> {
  const item = await client
    .from("item")
    .insert({
      readableId: input.readableId,
      revision: "0",
      name: input.name,
      type: "Part",
      replenishmentSystem: "Buy",
      defaultMethodType: "Pull from Inventory",
      itemTrackingType: "Inventory",
      unitOfMeasureCode: input.unitOfMeasureCode ?? "EA",
      active: false,
      revisionStatus: "Design",
      companyId: input.companyId,
      createdBy: input.createdBy
    })
    .select("id")
    .single();

  if (item.error || !item.data) return { data: null, error: item.error };

  const part = await client.from("part").insert({
    id: input.readableId,
    companyId: input.companyId,
    createdBy: input.createdBy
  });
  if (part.error) return { data: null, error: part.error };

  return { data: { id: item.data.id }, error: null };
}

// =============================================================================
// Phase 3 — Impact panel (open POs for deleted parts, at Implementation)
// =============================================================================
export type ChangeOrderImpactRow = {
  itemId: string;
  itemReadableId: string | null;
  itemName: string | null;
  openPurchaseOrderLines: Array<{
    id: string;
    purchaseOrderId: string;
    purchaseOrderReadableId: string | null;
    supplierName: string | null;
    quantityToReceive: number | null;
  }>;
};

// PRD §3.3: read-only, non-blocking. Surfaces open (not-yet-received) PO lines
// for the parts being DELETED, so procurement has visibility before the change
// goes live. Flat selects + JS stitch (no PostgREST embeds — TS2589 budget).
export async function getChangeOrderImpact(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<{
  data: ChangeOrderImpactRow[];
  error: { message: string } | null;
}> {
  // Top-to-bottom model: a "removed part" is a component that appears on an
  // affected item's live source (Active) make method but has NO surviving staged
  // material referencing it — i.e. the user deleted that staged line. We compute
  // it here by comparing, per affected item, the live methodMaterial itemIds
  // against the staged material itemIds still present in the CO.
  const affected = await client
    .from("changeOrderAffectedItem")
    .select("id, itemId")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId);
  if (affected.error) return { data: [], error: affected.error };

  const affectedItems = affected.data ?? [];
  if (affectedItems.length === 0) return { data: [], error: null };

  // Resolve each affected item's current Active make method (per item).
  const affectedItemIds = [
    ...new Set(affectedItems.map((a) => a.itemId).filter(Boolean))
  ] as string[];
  const activeMethods = affectedItemIds.length
    ? await client
        .from("activeMakeMethods")
        .select("id, itemId")
        .in("itemId", affectedItemIds)
        .eq("companyId", companyId)
    : { data: [], error: null };
  if (activeMethods.error) return { data: [], error: activeMethods.error };
  const makeMethodIdByItem = new Map<string, string>();
  for (const m of activeMethods.data ?? []) {
    if (m.id && m.itemId) makeMethodIdByItem.set(m.itemId, m.id);
  }

  const makeMethodIds = [...new Set([...makeMethodIdByItem.values()])];

  // Live component itemIds on the source methods, and staged material itemIds
  // still present (keyed by affectedItemId so removal is scoped per assembly).
  const [liveMaterials, stagedMaterials] = await Promise.all([
    makeMethodIds.length
      ? client
          .from("methodMaterial")
          .select("itemId, makeMethodId")
          .in("makeMethodId", makeMethodIds)
          .eq("companyId", companyId)
      : Promise.resolve({ data: [], error: null }),
    client
      .from("changeOrderStagedMaterial")
      .select("itemId, affectedItemId")
      .eq("changeOrderId", changeOrderId)
      .eq("companyId", companyId)
  ]);
  if (liveMaterials.error) return { data: [], error: liveMaterials.error };
  if (stagedMaterials.error) return { data: [], error: stagedMaterials.error };

  // Staged component itemIds per affected item (the surviving BOM).
  const stagedByAffected = new Map<string, Set<string>>();
  for (const s of stagedMaterials.data ?? []) {
    if (!s.affectedItemId || !s.itemId) continue;
    const set = stagedByAffected.get(s.affectedItemId) ?? new Set<string>();
    set.add(s.itemId);
    stagedByAffected.set(s.affectedItemId, set);
  }

  // Live component itemIds per make method → map back to affected items.
  const liveByMakeMethod = new Map<string, Set<string>>();
  for (const l of liveMaterials.data ?? []) {
    if (!l.makeMethodId || !l.itemId) continue;
    const set = liveByMakeMethod.get(l.makeMethodId) ?? new Set<string>();
    set.add(l.itemId);
    liveByMakeMethod.set(l.makeMethodId, set);
  }

  // Removed = live component present on the source method with no surviving
  // staged material referencing it, for that affected item.
  const removedItemIds = new Set<string>();
  for (const a of affectedItems) {
    const makeMethodId = a.itemId
      ? makeMethodIdByItem.get(a.itemId)
      : undefined;
    if (!makeMethodId) continue;
    const live = liveByMakeMethod.get(makeMethodId);
    if (!live) continue;
    const staged = stagedByAffected.get(a.id) ?? new Set<string>();
    for (const componentId of live) {
      if (!staged.has(componentId)) removedItemIds.add(componentId);
    }
  }

  const partIds = [...removedItemIds];
  if (partIds.length === 0) return { data: [], error: null };

  const lines = await client
    .from("openPurchaseOrderLines")
    .select("id, itemId, quantityToReceive, purchaseOrderId")
    .in("itemId", partIds)
    .eq("companyId", companyId)
    .limit(500);
  if (lines.error) return { data: [], error: lines.error };

  const poIds = [
    ...new Set((lines.data ?? []).map((l) => l.purchaseOrderId).filter(Boolean))
  ] as string[];
  const pos = poIds.length
    ? await client
        .from("purchaseOrders")
        .select("id, purchaseOrderId, supplierId")
        .in("id", poIds)
        .eq("companyId", companyId)
    : { data: [], error: null };
  if (pos.error) return { data: [], error: pos.error };
  const poById = new Map<
    string,
    { readable: string | null; supplier: string | null }
  >(
    (pos.data ?? []).flatMap((p) =>
      p.id
        ? [[p.id, { readable: p.purchaseOrderId, supplier: p.supplierId }]]
        : []
    )
  );

  const items = await getItemLabelMap(client, partIds, companyId);

  const byPart = new Map<string, ChangeOrderImpactRow>();
  for (const partId of partIds) {
    const label = items.get(partId);
    byPart.set(partId, {
      itemId: partId,
      itemReadableId: label?.readableIdWithRevision ?? null,
      itemName: label?.name ?? null,
      openPurchaseOrderLines: []
    });
  }
  for (const l of lines.data ?? []) {
    const itemId = l.itemId;
    const poId = l.purchaseOrderId;
    const lineId = l.id;
    if (!itemId || !poId || !lineId) continue;
    const row = byPart.get(itemId);
    if (!row) continue;
    const po = poById.get(poId);
    row.openPurchaseOrderLines.push({
      id: lineId,
      purchaseOrderId: poId,
      purchaseOrderReadableId: po?.readable ?? null,
      supplierName: po?.supplier ?? null,
      quantityToReceive: l.quantityToReceive
    });
  }

  return { data: [...byPart.values()], error: null };
}
