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
import type { supersessionModes } from "./items.models";

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

export async function getChangeOrderProductsAffected(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<{
  data: Array<
    Database["public"]["Tables"]["changeOrderProductAffected"]["Row"] & {
      item: ChangeOrderItemLabel | null;
      // The targeted assemblies that rolled up into this product (provenance for
      // the "affected by" display). Excludes the product itself.
      affectedBy: Array<{
        id: string;
        readableIdWithRevision: string | null;
        name: string | null;
      }>;
    }
  > | null;
  error: ChangeOrderError | null;
}> {
  const rows = await client
    .from("changeOrderProductAffected")
    .select("*")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
  if (rows.error) return { data: null, error: rows.error };

  // Recompute provenance (product → the targeted assemblies under it) from the CO's
  // BOM-change assemblies — same derivation that materialized the rows.
  const bomRows = await client
    .from("changeOrderBomChange")
    .select("id")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId);
  const bomIds = (bomRows.data ?? []).map((r) => r.id);

  let assemblyItemIds: string[] = [];
  if (bomIds.length > 0) {
    const asm = await client
      .from("changeOrderBomChangeAssembly")
      .select("assemblyItemId")
      .in("bomChangeId", bomIds)
      .eq("companyId", companyId);
    assemblyItemIds = [
      ...new Set((asm.data ?? []).map((a) => a.assemblyItemId))
    ];
  }

  const provenance = await getTopLevelProductsForItems(
    client,
    assemblyItemIds,
    companyId
  );
  const sourcesByProduct = new Map(
    provenance.data.map((p) => [p.productId, p.sourceItemIds])
  );

  const labelIds = [
    ...new Set([
      ...(rows.data ?? []).map((r) => r.itemId),
      ...provenance.data.flatMap((p) => p.sourceItemIds)
    ])
  ];
  const items = await getItemLabelMap(client, labelIds, companyId);

  return {
    data: (rows.data ?? []).map((r) => ({
      ...r,
      item: items.get(r.itemId) ?? null,
      affectedBy: (sourcesByProduct.get(r.itemId) ?? [])
        .filter((sourceId) => sourceId !== r.itemId)
        .map((sourceId) => {
          const label = items.get(sourceId);
          return {
            id: sourceId,
            readableIdWithRevision: label?.readableIdWithRevision ?? null,
            name: label?.name ?? null
          };
        })
    })),
    error: null
  };
}

// Products Affected are DERIVED, not hand-entered: they are the top-level products
// that the BOM-change assemblies roll up into. `syncChangeOrderProductsAffected`
// recomputes and reconciles the rows whenever a BOM change is written, so the two
// can never drift. See `getTopLevelProductsForItems` for the rollup.

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

// Recompute Products Affected for a CO from its BOM-change assemblies and reconcile
// the `changeOrderProductAffected` rows (insert new / delete stale). Best-effort:
// the caller runs it after a BOM change write; a failure just means the next write
// recomputes. Returns the raw {error} so the route can log without blocking.
export async function syncChangeOrderProductsAffected(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string,
  userId: string
): Promise<{ error: { message: string } | null }> {
  const bomChanges = await getChangeOrderBomChanges(
    client,
    changeOrderId,
    companyId
  );
  if (bomChanges.error) return { error: bomChanges.error };

  const assemblyItemIds = [
    ...new Set(
      (bomChanges.data ?? []).flatMap((row) =>
        row.assemblies.map((a) => a.assemblyItemId)
      )
    )
  ];

  const products = await getTopLevelProductsForItems(
    client,
    assemblyItemIds,
    companyId
  );
  if (products.error) return { error: products.error };
  const desired = new Set(products.data.map((p) => p.productId));

  const existing = await client
    .from("changeOrderProductAffected")
    .select("id, itemId")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId);
  if (existing.error) return { error: existing.error };

  const existingItemIds = new Set((existing.data ?? []).map((r) => r.itemId));
  const toInsert = [...desired].filter(
    (itemId) => !existingItemIds.has(itemId)
  );
  const toDeleteIds = (existing.data ?? [])
    .filter((r) => !desired.has(r.itemId))
    .map((r) => r.id);

  if (toInsert.length > 0) {
    const ins = await client.from("changeOrderProductAffected").insert(
      toInsert.map((itemId) => ({
        changeOrderId,
        itemId,
        companyId,
        createdBy: userId
      }))
    );
    if (ins.error) return { error: ins.error };
  }

  if (toDeleteIds.length > 0) {
    const del = await client
      .from("changeOrderProductAffected")
      .delete()
      .in("id", toDeleteIds);
    if (del.error) return { error: del.error };
  }

  return { error: null };
}

// =============================================================================
// Phase 2 — BOM change rows (Delete / Add, per-assembly)
// =============================================================================
// Fetched as two shallow queries and stitched, rather than one 3-level nested
// select: PostgREST's inferred type for deeply-nested embeds blows TS's
// instantiation-depth budget (TS2589) and surfaces "excessively deep" errors in
// unrelated files. Two 1-level selects keep the inferred types shallow.
export type ChangeOrderBomChangeWithAssemblies =
  Database["public"]["Tables"]["changeOrderBomChange"]["Row"] & {
    item: {
      id: string;
      readableIdWithRevision: string | null;
      name: string;
      type: Database["public"]["Enums"]["itemType"];
      active: boolean;
      revisionStatus: Database["public"]["Enums"]["itemRevisionStatus"];
    } | null;
    assemblies: Array<{
      id: string;
      bomChangeId: string;
      assemblyItemId: string;
      quantity: number;
      supersessionMode: Database["public"]["Enums"]["supersessionMode"] | null;
      assembly: {
        id: string;
        readableIdWithRevision: string | null;
        name: string;
      } | null;
    }>;
  };

// Explicit return type (built from cheap Database Row references, not the deep
// inferred PostgREST select type) so the shape does NOT re-instantiate through
// the loader's Promise.all + useLoaderData + UI props — that multiplication is
// what exhausts TS's global instantiation budget (TS2589) in unrelated files.
export async function getChangeOrderBomChanges(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<{
  data: ChangeOrderBomChangeWithAssemblies[] | null;
  error: ChangeOrderError | null;
}> {
  const rows = await client
    .from("changeOrderBomChange")
    .select("*")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });

  if (rows.error) return { data: null, error: rows.error };

  const rowIds = (rows.data ?? []).map((r) => r.id);
  const assemblies = await client
    .from("changeOrderBomChangeAssembly")
    .select("*")
    .in("bomChangeId", rowIds)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });

  if (assemblies.error) return { data: null, error: assemblies.error };

  // One flat item fetch covering both the change-row parts and the assembly
  // targets, then stitch (no embeds — see ChangeOrderItemLabel note above).
  const itemIds = [
    ...(rows.data ?? []).map((r) => r.itemId),
    ...(assemblies.data ?? []).map((a) => a.assemblyItemId)
  ];
  const items = await getItemLabelMap(client, itemIds, companyId);

  const byRow = new Map<
    string,
    ChangeOrderBomChangeWithAssemblies["assemblies"]
  >();
  for (const a of assemblies.data ?? []) {
    const label = items.get(a.assemblyItemId);
    const list = byRow.get(a.bomChangeId) ?? [];
    list.push({
      id: a.id,
      bomChangeId: a.bomChangeId,
      assemblyItemId: a.assemblyItemId,
      quantity: a.quantity,
      supersessionMode: a.supersessionMode,
      assembly: label
        ? {
            id: label.id,
            readableIdWithRevision: label.readableIdWithRevision,
            name: label.name
          }
        : null
    });
    byRow.set(a.bomChangeId, list);
  }

  const data: ChangeOrderBomChangeWithAssemblies[] = (rows.data ?? []).map(
    (r) => {
      const label = items.get(r.itemId);
      return {
        ...r,
        item: label ?? null,
        assemblies: byRow.get(r.id) ?? []
      };
    }
  );

  return { data, error: null };
}

// G7 — the single canonical "which assemblies consume this part" query, used by
// the Delete-row assembly picker to suggest the assemblies that reference a
// part. An assembly is any item whose make method's BOM (methodMaterial) lists
// the part. Returns one row per referencing make method; callers dedupe by
// assemblyId.
export async function getAssembliesUsingItem(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<{
  data: Array<{
    assemblyId: string;
    assemblyReadableId: string | null;
    assemblyName: string | null;
    assemblyType: string | null;
  }>;
  error: { message: string } | null;
}> {
  // Two flat queries (methodMaterial → makeMethod → item) instead of a nested
  // spread select: keeps the inferred types shallow (TS2589 budget) and yields
  // the distinct assemblies that consume this part.
  const materials = await client
    .from("methodMaterial")
    .select("makeMethodId")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .limit(500);
  if (materials.error) return { data: [], error: materials.error };

  const makeMethodIds = [
    ...new Set((materials.data ?? []).map((m) => m.makeMethodId))
  ];
  if (makeMethodIds.length === 0) return { data: [], error: null };

  const methods = await client
    .from("makeMethod")
    .select("itemId")
    .in("id", makeMethodIds)
    .eq("companyId", companyId);
  if (methods.error) return { data: [], error: methods.error };

  const assemblyItems = await getItemLabelMap(
    client,
    (methods.data ?? []).map((m) => m.itemId),
    companyId
  );

  const byId = new Map<
    string,
    {
      assemblyId: string;
      assemblyReadableId: string | null;
      assemblyName: string | null;
      assemblyType: string | null;
    }
  >();
  for (const label of assemblyItems.values()) {
    if (!byId.has(label.id)) {
      byId.set(label.id, {
        assemblyId: label.id,
        assemblyReadableId: label.readableIdWithRevision,
        assemblyName: label.name,
        assemblyType: label.type
      });
    }
  }
  return { data: [...byId.values()], error: null };
}

// G3 — forward-reference to a not-yet-synced part. Mints a REAL item row
// (active=false, revisionStatus='Design') through the standard item shape so
// `changeOrderBomChange.itemId` is always non-null and no placeholder branch is
// threaded downstream. Onshape sync reconciles by matching readableId+company
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

// upsertBomChange — resolves the target part (existing itemId, or a minted
// placeholder for an Add forward-reference) then writes the row.
export async function upsertBomChange(
  client: SupabaseClient<Database>,
  input: {
    id?: string;
    changeOrderId: string;
    changeType: "Add" | "Delete";
    itemId?: string;
    newItemReadableId?: string;
    newItemName?: string;
    companyId: string;
    userId: string;
  }
): Promise<{
  data: { id: string } | null;
  error: { message: string } | null;
}> {
  let itemId = input.itemId;

  if (!itemId) {
    if (
      input.changeType !== "Add" ||
      !input.newItemReadableId ||
      !input.newItemName
    ) {
      return { data: null, error: { message: "A part is required" } };
    }
    const minted = await mintPlaceholderPart(client, {
      readableId: input.newItemReadableId,
      name: input.newItemName,
      companyId: input.companyId,
      createdBy: input.userId
    });
    if (minted.error || !minted.data) {
      return {
        data: null,
        error: { message: minted.error?.message ?? "Failed to create part" }
      };
    }
    itemId = minted.data.id;
  }

  if (input.id) {
    const result = await client
      .from("changeOrderBomChange")
      .update({ itemId, changeType: input.changeType, updatedBy: input.userId })
      .eq("id", input.id)
      .select("id")
      .single();
    if (result.error) return { data: null, error: result.error };
    return { data: { id: result.data.id }, error: null };
  }

  const result = await client
    .from("changeOrderBomChange")
    .insert({
      changeOrderId: input.changeOrderId,
      changeType: input.changeType,
      itemId,
      companyId: input.companyId,
      createdBy: input.userId
    })
    .select("id")
    .single();
  if (result.error) return { data: null, error: result.error };
  return { data: { id: result.data.id }, error: null };
}

export async function deleteChangeOrderBomChange(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderBomChange").delete().eq("id", id);
}

export async function upsertChangeOrderBomChangeAssembly(
  client: SupabaseClient<Database>,
  input: {
    id?: string;
    bomChangeId: string;
    assemblyItemId: string;
    quantity: number;
    supersessionMode?: (typeof supersessionModes)[number];
    companyId: string;
    userId: string;
  }
) {
  // Supersession mode is only meaningful on a Delete row's assemblies; null it
  // out on Add rows regardless of what the client sent (G8 — the mode belongs to
  // a removal's stock cutover, an addition has none).
  const parent = await client
    .from("changeOrderBomChange")
    .select("changeType, changeOrderId")
    .eq("id", input.bomChangeId)
    .single();
  const supersessionMode =
    parent.data?.changeType === "Delete"
      ? (input.supersessionMode ?? null)
      : null;

  if (input.id) {
    return client
      .from("changeOrderBomChangeAssembly")
      .update({
        assemblyItemId: input.assemblyItemId,
        quantity: input.quantity,
        supersessionMode,
        updatedBy: input.userId
      })
      .eq("id", input.id)
      .select("id")
      .single();
  }

  if (!parent.data?.changeOrderId) {
    return {
      data: null,
      error: { message: "Parent BOM change row not found" }
    };
  }

  return client
    .from("changeOrderBomChangeAssembly")
    .insert({
      bomChangeId: input.bomChangeId,
      // Denormalized for audit rollup to the owning CO (set once at insert).
      changeOrderId: parent.data.changeOrderId,
      assemblyItemId: input.assemblyItemId,
      quantity: input.quantity,
      supersessionMode,
      companyId: input.companyId,
      createdBy: input.userId
    })
    .select("id")
    .single();
}

export async function deleteChangeOrderBomChangeAssembly(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderBomChangeAssembly").delete().eq("id", id);
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
  const deletes = await client
    .from("changeOrderBomChange")
    .select("itemId")
    .eq("changeOrderId", changeOrderId)
    .eq("changeType", "Delete")
    .eq("companyId", companyId);
  if (deletes.error) return { data: [], error: deletes.error };

  const partIds = [...new Set((deletes.data ?? []).map((d) => d.itemId))];
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
