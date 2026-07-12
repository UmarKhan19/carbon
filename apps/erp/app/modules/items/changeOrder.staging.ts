import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { sanitize } from "~/utils/supabase";
import type {
  changeOrderAffectedItemValidator,
  changeOrderStagedItemAttributesValidator,
  changeOrderStagedMaterialValidator,
  changeOrderStagedOperationValidator,
  changeOrderSupersessionValidator
} from "./changeOrder.models";
import { changeOrderOpenStatuses } from "./changeOrder.models";
import { mintPlaceholderPart } from "./changeOrder.service";

// =============================================================================
// Change Orders — affected-item selection + staged BOM material CRUD, with
// snapshot-on-add. Split out of changeOrder.service.ts to keep each concern file
// under the module's 1000-line budget (G4). Top-to-bottom model: the user picks
// affected parts first; adding one snapshots the item's current Active make
// method (materials + operations) and its editable attributes into CO-owned
// staging tables (full desired end-state, git-style). Editing/reordering staged
// materials happens here; operations are Task 8, attributes Task 10.
//
// All functions take the supabase client (or a Kysely db for transactions) as
// the first arg, return raw { data, error } (no throw), and scope by companyId.
// Reads use flat selects + JS stitch (no composite-FK PostgREST embeds — the erp
// TS2589 instantiation budget; see lessons).
// =============================================================================

// The minimal item label rendered next to each affected item / staged material.
export type ChangeOrderStagingItemLabel = {
  id: string;
  readableId: string;
  readableIdWithRevision: string | null;
  name: string;
  type: Database["public"]["Enums"]["itemType"];
  active: boolean;
  revisionStatus: Database["public"]["Enums"]["itemRevisionStatus"];
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
};

type ChangeOrderAffectedItemRow =
  Database["public"]["Tables"]["changeOrderAffectedItem"]["Row"];

export type ChangeOrderAffectedItemWithLabel = ChangeOrderAffectedItemRow & {
  item: ChangeOrderStagingItemLabel | null;
};

type ChangeOrderStagedMaterialRow =
  Database["public"]["Tables"]["changeOrderStagedMaterial"]["Row"];

export type ChangeOrderStagedMaterialWithLabel =
  ChangeOrderStagedMaterialRow & {
    item: ChangeOrderStagingItemLabel | null;
  };

const ITEM_LABEL_COLUMNS =
  "id, readableId, readableIdWithRevision, name, type, active, revisionStatus, replenishmentSystem";

// -----------------------------------------------------------------------------
// Affected items
// -----------------------------------------------------------------------------

// The affected items of a CO, each stitched to a minimal item label. Flat query
// on changeOrderAffectedItem + a second item read, joined in JS (no embed).
export async function getChangeOrderAffectedItems(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<{
  data: ChangeOrderAffectedItemWithLabel[];
  error: { message: string } | null;
}> {
  const affected = await client
    .from("changeOrderAffectedItem")
    .select("*")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });

  if (affected.error) return { data: [], error: affected.error };
  const rows = affected.data ?? [];
  if (rows.length === 0) return { data: [], error: null };

  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  const items = await client
    .from("item")
    .select(ITEM_LABEL_COLUMNS)
    .in("id", itemIds)
    .eq("companyId", companyId);

  if (items.error) return { data: [], error: items.error };
  const labels = new Map<string, ChangeOrderStagingItemLabel>();
  for (const it of items.data ?? [])
    labels.set(it.id, it as ChangeOrderStagingItemLabel);

  return {
    data: rows.map((r) => ({ ...r, item: labels.get(r.itemId) ?? null })),
    error: null
  };
}

// Add an affected item + SNAPSHOT-ON-ADD its current Active make method and
// editable attributes into staging. Multi-row across tables → the inserts run in
// one Kysely transaction. The live-method reads use the supabase client BEFORE
// the txn (Kysely has no RLS context). Guard: reject if another OPEN change order
// already references this item (one open CO per part).
export async function addChangeOrderAffectedItem(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: {
    changeOrderId: string;
    itemId: string;
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { changeOrderId, itemId, companyId, userId } = input;

  // Read the source item (label + editable attributes) up front.
  const item = await client
    .from("item")
    .select(
      "id, readableId, name, description, unitOfMeasureCode, itemTrackingType, defaultMethodType, replenishmentSystem, sourcingType, requiresInspection, thumbnailPath"
    )
    .eq("id", itemId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (item.error) return { data: null, error: item.error };
  if (!item.data) return { data: null, error: { message: "Item not found" } };
  const itemAttributes = item.data;

  // One-open-CO-per-part guard. changeOrder.reads.ts references dropped tables
  // and does not currently compile, so we inline a minimal guard against
  // changeOrderAffectedItem here rather than importing findOtherOpenChangeOrders
  // ForItem. TODO(Task 17): switch to the canonical read once reads.ts is fixed.
  const otherAffected = await client
    .from("changeOrderAffectedItem")
    .select("changeOrderId")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .neq("changeOrderId", changeOrderId);
  if (otherAffected.error) return { data: null, error: otherAffected.error };
  const otherCoIds = [
    ...new Set((otherAffected.data ?? []).map((r) => r.changeOrderId))
  ];
  if (otherCoIds.length > 0) {
    const openCos = await client
      .from("changeOrder")
      .select("id")
      .in("id", otherCoIds)
      .eq("companyId", companyId)
      .in("status", changeOrderOpenStatuses);
    if (openCos.error) return { data: null, error: openCos.error };
    if ((openCos.data ?? []).length > 0) {
      return {
        data: null,
        error: {
          message: "This item is already on another open change order"
        }
      };
    }
  }

  // Resolve the item's current Active make method (per item, status Active).
  const activeMethod = await client
    .from("activeMakeMethods")
    .select("id")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (activeMethod.error) return { data: null, error: activeMethod.error };
  const makeMethodId = activeMethod.data?.id ?? null;

  // Read the live method's materials + operations to snapshot (if any).
  let liveMaterials: Database["public"]["Tables"]["methodMaterial"]["Row"][] =
    [];
  let liveOperations: Database["public"]["Tables"]["methodOperation"]["Row"][] =
    [];
  if (makeMethodId) {
    const [materials, operations] = await Promise.all([
      client
        .from("methodMaterial")
        .select("*")
        .eq("makeMethodId", makeMethodId)
        .eq("companyId", companyId)
        .order("order", { ascending: true }),
      client
        .from("methodOperation")
        .select("*")
        .eq("makeMethodId", makeMethodId)
        .eq("companyId", companyId)
        .order("order", { ascending: true })
    ]);
    if (materials.error) return { data: null, error: materials.error };
    if (operations.error) return { data: null, error: operations.error };
    liveMaterials = materials.data ?? [];
    liveOperations = operations.data ?? [];
  }

  const now = new Date().toISOString();

  try {
    const affectedItemId = await db.transaction().execute(async (trx) => {
      const affected = await trx
        .insertInto("changeOrderAffectedItem")
        .values({
          changeOrderId,
          itemId,
          companyId,
          createdBy: userId,
          createdAt: now
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      // Snapshot the item's editable attributes (one row per affected item).
      await trx
        .insertInto("changeOrderStagedItemAttributes")
        .values({
          changeOrderId,
          affectedItemId: affected.id,
          name: itemAttributes.name,
          description: itemAttributes.description,
          unitOfMeasureCode: itemAttributes.unitOfMeasureCode,
          itemTrackingType: itemAttributes.itemTrackingType,
          defaultMethodType: itemAttributes.defaultMethodType,
          replenishmentSystem: itemAttributes.replenishmentSystem,
          sourcingType: itemAttributes.sourcingType,
          requiresInspection: itemAttributes.requiresInspection,
          thumbnailPath: itemAttributes.thumbnailPath,
          companyId,
          createdBy: userId,
          createdAt: now
        })
        .execute();

      // Snapshot the live make method's materials (sourceMaterialId = live id).
      if (liveMaterials.length > 0) {
        await trx
          .insertInto("changeOrderStagedMaterial")
          .values(
            liveMaterials.map((m) => ({
              changeOrderId,
              affectedItemId: affected.id,
              itemId: m.itemId,
              quantity: m.quantity,
              unitOfMeasureCode: m.unitOfMeasureCode,
              methodType: m.methodType,
              sourcingType: m.sourcingType,
              materialMakeMethodId: m.materialMakeMethodId,
              order: m.order,
              itemType: m.itemType,
              sourceMaterialId: m.id,
              companyId,
              createdBy: userId,
              createdAt: now
            }))
          )
          .execute();
      }

      // Snapshot the live make method's operations (sourceOperationId = live id).
      // The staged-operation columns mirror the CURRENT methodOperation header;
      // copy every mirrored field so the staged copy is a faithful end-state.
      if (liveOperations.length > 0) {
        await trx
          .insertInto("changeOrderStagedOperation")
          .values(
            liveOperations.map((o) => ({
              changeOrderId,
              affectedItemId: affected.id,
              order: o.order,
              operationOrder: o.operationOrder,
              operationType: o.operationType,
              processId: o.processId,
              workCenterId: o.workCenterId,
              operationSupplierProcessId: o.operationSupplierProcessId,
              procedureId: o.procedureId,
              description: o.description,
              setupTime: o.setupTime,
              setupUnit: o.setupUnit,
              laborTime: o.laborTime,
              laborUnit: o.laborUnit,
              machineTime: o.machineTime,
              machineUnit: o.machineUnit,
              workInstruction: o.workInstruction,
              sourceOperationId: o.id,
              companyId,
              createdBy: userId,
              createdAt: now
            }))
          )
          .execute();
      }

      return affected.id;
    });

    return { data: { id: affectedItemId }, error: null };
  } catch (err) {
    return {
      data: null,
      error: {
        message:
          err instanceof Error
            ? err.message
            : "Failed to add affected item to change order"
      }
    };
  }
}

// Delete an affected item. Staging rows (materials/operations/attributes) cascade
// via their affectedItemId FK.
export async function removeChangeOrderAffectedItem(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderAffectedItem").delete().eq("id", id);
}

// Update the per-item revision cutover config (mode + dates). The existence of
// the oldRev→newRev supersession is automatic at release; this only tunes it.
export async function updateChangeOrderAffectedItemCutover(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    supersessionMode: Database["public"]["Enums"]["supersessionMode"];
    discontinuationDate?: string;
    successorEffectivityDate?: string;
    userId: string;
  }
) {
  const { id, userId, ...rest } = input;
  return client
    .from("changeOrderAffectedItem")
    .update({
      ...sanitize(rest),
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

// -----------------------------------------------------------------------------
// Staged materials
// -----------------------------------------------------------------------------

// The staged BOM lines for one affected item, stitched to item labels. Flat
// select + JS stitch (no embed).
export async function getChangeOrderStagedMaterials(
  client: SupabaseClient<Database>,
  affectedItemId: string,
  companyId: string
): Promise<{
  data: ChangeOrderStagedMaterialWithLabel[];
  error: { message: string } | null;
}> {
  const materials = await client
    .from("changeOrderStagedMaterial")
    .select("*")
    .eq("affectedItemId", affectedItemId)
    .eq("companyId", companyId)
    .order("order", { ascending: true });

  if (materials.error) return { data: [], error: materials.error };
  const rows = materials.data ?? [];
  if (rows.length === 0) return { data: [], error: null };

  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  const items = await client
    .from("item")
    .select(ITEM_LABEL_COLUMNS)
    .in("id", itemIds)
    .eq("companyId", companyId);

  if (items.error) return { data: [], error: items.error };
  const labels = new Map<string, ChangeOrderStagingItemLabel>();
  for (const it of items.data ?? [])
    labels.set(it.id, it as ChangeOrderStagingItemLabel);

  return {
    data: rows.map((r) => ({ ...r, item: labels.get(r.itemId) ?? null })),
    error: null
  };
}

// Insert/update a staged BOM line. Resolves the component itemId (existing, or
// minted via mintPlaceholderPart for a forward-referenced not-yet-synced part),
// then re-derives methodType/sourcingType from the component item exactly like
// upsertMethodMaterial (the submitted form values are advisory/display-only).
export async function upsertChangeOrderStagedMaterial(
  client: SupabaseClient<Database>,
  input: z.infer<typeof changeOrderStagedMaterialValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const {
    id,
    companyId,
    userId,
    itemId: inputItemId,
    newItemReadableId,
    newItemName,
    methodType: _submittedMethodType,
    sourcingType: _submittedSourcingType,
    ...rest
  } = input;

  // Resolve the component item: mint a placeholder when a forward-ref is given.
  let itemId = inputItemId ?? undefined;
  if (!itemId && newItemReadableId && newItemName) {
    const minted = await mintPlaceholderPart(client, {
      readableId: newItemReadableId,
      name: newItemName,
      companyId,
      createdBy: userId,
      unitOfMeasureCode: rest.unitOfMeasureCode ?? undefined
    });
    if (minted.error || !minted.data)
      return { data: null, error: minted.error };
    itemId = minted.data.id;
  }
  if (!itemId)
    return { data: null, error: { message: "A component item is required" } };

  // Re-derive methodType/sourcingType from the component item (method-material-
  // sourcing rule): the item-level properties are authoritative, not the form.
  const componentItem = await client
    .from("item")
    .select("defaultMethodType, sourcingType")
    .eq("id", itemId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (componentItem.error) return { data: null, error: componentItem.error };

  const methodType: Database["public"]["Enums"]["methodType"] =
    componentItem.data?.defaultMethodType ?? "Pull from Inventory";
  const sourcingType: Database["public"]["Enums"]["sourcingType"] =
    componentItem.data?.sourcingType ?? "Specified";

  const payload = {
    itemId,
    quantity: rest.quantity,
    unitOfMeasureCode: rest.unitOfMeasureCode,
    methodType,
    sourcingType,
    materialMakeMethodId: rest.materialMakeMethodId,
    stagedOperationId: rest.stagedOperationId,
    order: rest.order,
    itemType: rest.itemType,
    sourceMaterialId: rest.sourceMaterialId
  };

  if (id) {
    return client
      .from("changeOrderStagedMaterial")
      .update({
        ...sanitize(payload),
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("changeOrderStagedMaterial")
    .insert({
      changeOrderId: rest.changeOrderId,
      affectedItemId: rest.affectedItemId,
      companyId,
      createdBy: userId,
      ...sanitize(payload)
    })
    .select("id")
    .single();
}

export async function deleteChangeOrderStagedMaterial(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderStagedMaterial").delete().eq("id", id);
}

// Bulk reorder of staged materials — multi-row write in one Kysely transaction
// (precedent: updatePurchaseOrderLineOrder). Kysely bypasses RLS and throws on
// rollback; authorize at the route.
export async function reorderChangeOrderStagedMaterials(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; order: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, order, updatedBy } of updates) {
      await trx
        .updateTable("changeOrderStagedMaterial")
        .set({ order, updatedBy, updatedAt: new Date().toISOString() })
        .where("id", "=", id)
        .execute();
    }
  });
}

// -----------------------------------------------------------------------------
// Staged operations (Task 8) — CO-owned mirror of methodOperation headers. The
// columns mirror the CURRENT methodOperation shape; enum-typed fields are cast
// from the (advisory) text validator fields to the generated Insert types.
// -----------------------------------------------------------------------------

// The staged BOP operations for one affected item. Flat select ordered by
// "order" — no embeds (process/work-center labels are stitched by the loader).
export async function getChangeOrderStagedOperations(
  client: SupabaseClient<Database>,
  affectedItemId: string,
  companyId: string
) {
  return client
    .from("changeOrderStagedOperation")
    .select("*")
    .eq("affectedItemId", affectedItemId)
    .eq("companyId", companyId)
    .order("order", { ascending: true });
}

// Insert/update one staged operation, mirroring the corrected columns. The
// enum-typed fields arrive as text from the form validator; the DB enum column
// is the real guard, so we cast to the generated Insert types.
export async function upsertChangeOrderStagedOperation(
  client: SupabaseClient<Database>,
  input: z.infer<typeof changeOrderStagedOperationValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { id, companyId, userId, changeOrderId, affectedItemId, ...rest } =
    input;

  type OperationInsert =
    Database["public"]["Tables"]["changeOrderStagedOperation"]["Insert"];

  const payload = {
    order: rest.order,
    operationOrder: rest.operationOrder as OperationInsert["operationOrder"],
    operationType: rest.operationType as OperationInsert["operationType"],
    processId: rest.processId,
    workCenterId: rest.workCenterId,
    operationSupplierProcessId: rest.operationSupplierProcessId,
    procedureId: rest.procedureId,
    description: rest.description,
    setupTime: rest.setupTime,
    setupUnit: rest.setupUnit as OperationInsert["setupUnit"],
    laborTime: rest.laborTime,
    laborUnit: rest.laborUnit as OperationInsert["laborUnit"],
    machineTime: rest.machineTime,
    machineUnit: rest.machineUnit as OperationInsert["machineUnit"],
    sourceOperationId: rest.sourceOperationId
  };

  if (id) {
    return client
      .from("changeOrderStagedOperation")
      .update({
        ...sanitize(payload),
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("changeOrderStagedOperation")
    .insert({
      changeOrderId,
      affectedItemId,
      companyId,
      createdBy: userId,
      ...sanitize(payload)
    })
    .select("id")
    .single();
}

export async function deleteChangeOrderStagedOperation(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderStagedOperation").delete().eq("id", id);
}

// Bulk reorder of staged operations — multi-row write in one Kysely transaction
// (precedent: reorderChangeOrderStagedMaterials above). Kysely bypasses RLS and
// throws on rollback; authorize at the route.
export async function reorderChangeOrderStagedOperations(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; order: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, order, updatedBy } of updates) {
      await trx
        .updateTable("changeOrderStagedOperation")
        .set({ order, updatedBy, updatedAt: new Date().toISOString() })
        .where("id", "=", id)
        .execute();
    }
  });
}

// -----------------------------------------------------------------------------
// Staged item attributes (Task 10) — one CO-owned redline row per affected item
// (unique on affectedItemId). The affected-item add snapshots this row; this is
// the editor's get/upsert.
// -----------------------------------------------------------------------------

// The single staged-attributes row for an affected item (unique per affected
// item). maybeSingle — a Buy part added before its snapshot may have none yet.
export async function getChangeOrderStagedItemAttributes(
  client: SupabaseClient<Database>,
  affectedItemId: string,
  companyId: string
) {
  return client
    .from("changeOrderStagedItemAttributes")
    .select("*")
    .eq("affectedItemId", affectedItemId)
    .eq("companyId", companyId)
    .maybeSingle();
}

// Insert/update the staged-attributes row. Enum-typed fields arrive as text from
// the validator; cast to the generated Insert types (the DB enum is the guard).
export async function upsertChangeOrderStagedItemAttributes(
  client: SupabaseClient<Database>,
  input: z.infer<typeof changeOrderStagedItemAttributesValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { id, companyId, userId, changeOrderId, affectedItemId, ...rest } =
    input;

  type AttributesInsert =
    Database["public"]["Tables"]["changeOrderStagedItemAttributes"]["Insert"];

  const payload = {
    name: rest.name,
    description: rest.description,
    unitOfMeasureCode: rest.unitOfMeasureCode,
    itemTrackingType: rest.itemTrackingType,
    defaultMethodType:
      rest.defaultMethodType as AttributesInsert["defaultMethodType"],
    replenishmentSystem: rest.replenishmentSystem,
    sourcingType: rest.sourcingType as AttributesInsert["sourcingType"],
    requiresInspection: rest.requiresInspection,
    thumbnailPath: rest.thumbnailPath
  };

  if (id) {
    return client
      .from("changeOrderStagedItemAttributes")
      .update({
        ...sanitize(payload),
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("changeOrderStagedItemAttributes")
    .insert({
      changeOrderId,
      affectedItemId,
      companyId,
      createdBy: userId,
      ...sanitize(payload)
    })
    .select("id")
    .single();
}

// -----------------------------------------------------------------------------
// Manual different-part supersession (Task 11) — genuinely-different-part
// obsolescence declarations, NOT the per-affected-item revision cutover (that is
// auto-written at release). predecessor → optional successor + mode/dates.
// -----------------------------------------------------------------------------

type ChangeOrderSupersessionRow =
  Database["public"]["Tables"]["changeOrderSupersession"]["Row"];

export type ChangeOrderSupersessionWithLabels = ChangeOrderSupersessionRow & {
  predecessorItem: ChangeOrderStagingItemLabel | null;
  successorItem: ChangeOrderStagingItemLabel | null;
};

// The manual supersessions of a CO, each stitched to predecessor/successor item
// labels. Flat select + a single item read joined in JS (no embed).
export async function getChangeOrderSupersessions(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<{
  data: ChangeOrderSupersessionWithLabels[];
  error: { message: string } | null;
}> {
  const supersessions = await client
    .from("changeOrderSupersession")
    .select("*")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });

  if (supersessions.error) return { data: [], error: supersessions.error };
  const rows = supersessions.data ?? [];
  if (rows.length === 0) return { data: [], error: null };

  const itemIds = [
    ...new Set(
      rows.flatMap((r) =>
        [r.predecessorItemId, r.successorItemId].filter((v): v is string => !!v)
      )
    )
  ];
  const items = await client
    .from("item")
    .select(ITEM_LABEL_COLUMNS)
    .in("id", itemIds)
    .eq("companyId", companyId);

  if (items.error) return { data: [], error: items.error };
  const labels = new Map<string, ChangeOrderStagingItemLabel>();
  for (const it of items.data ?? [])
    labels.set(it.id, it as ChangeOrderStagingItemLabel);

  return {
    data: rows.map((r) => ({
      ...r,
      predecessorItem: labels.get(r.predecessorItemId) ?? null,
      successorItem: r.successorItemId
        ? (labels.get(r.successorItemId) ?? null)
        : null
    })),
    error: null
  };
}

// Insert/update one manual supersession declaration.
export async function upsertChangeOrderSupersession(
  client: SupabaseClient<Database>,
  input: z.infer<typeof changeOrderSupersessionValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { id, companyId, userId, changeOrderId, ...rest } = input;

  const payload = {
    predecessorItemId: rest.predecessorItemId,
    successorItemId: rest.successorItemId,
    supersessionMode: rest.supersessionMode,
    discontinuationDate: rest.discontinuationDate,
    successorEffectivityDate: rest.successorEffectivityDate
  };

  if (id) {
    return client
      .from("changeOrderSupersession")
      .update({
        ...sanitize(payload),
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("changeOrderSupersession")
    .insert({
      changeOrderId,
      companyId,
      createdBy: userId,
      ...sanitize(payload)
    })
    .select("id")
    .single();
}

export async function deleteChangeOrderSupersession(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderSupersession").delete().eq("id", id);
}

// Re-export the affected-item validator type for route convenience.
export type ChangeOrderAffectedItemInput = z.infer<
  typeof changeOrderAffectedItemValidator
>;
