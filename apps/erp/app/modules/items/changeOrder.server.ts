import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { trigger } from "@carbon/jobs";
import { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import {
  activateMethodVersion,
  assertMethodOperationIsDraft,
  createRevision,
  deleteMethodMaterial,
  deleteMethodOperation,
  getItem,
  getNextRevision,
  upsertItemSupersession,
  upsertMethodMaterial,
  upsertMethodOperation
} from "~/modules/items";
import { supersessionModes } from "./items.models";

// =============================================================================
// Change Orders — server-only helpers (imports @carbon/jobs).
// =============================================================================

// Maps a broadcast stage to its notification event. Only Start / Implementation
// / Done broadcast (PRD §3.1); Draft / Engineering Complete are silent, so
// callers simply don't invoke this for those stages.
export const changeOrderStageEvent: Record<string, NotificationEvent> = {
  Start: NotificationEvent.ChangeOrderStarted,
  Implementation: NotificationEvent.ChangeOrderImplementation,
  Done: NotificationEvent.ChangeOrderDone
};

// notifyChangeOrderTransition — broadcasts a stage transition to the whole
// company team (PRD §3.1 "Broadcast to team"). The recipient is the company
// employee group; the `notify` job expands it via the users_for_groups RPC.
// Best-effort: never throws into the caller's redirect path.
export async function notifyChangeOrderTransition(args: {
  event: NotificationEvent;
  changeOrderId: string;
  companyId: string;
  companyGroupId: string;
  userId: string;
}): Promise<void> {
  try {
    await trigger("notify", {
      event: args.event,
      companyId: args.companyId,
      documentId: args.changeOrderId,
      recipient: { type: "group", groupIds: [args.companyGroupId] },
      from: args.userId
    });
  } catch (e) {
    console.error("Failed to trigger change order notification", e);
  }
}

// =============================================================================
// applyChangeOrder — the top-to-bottom "release", run on the Implementation →
// Done transition (this function IS that transition). It materializes each
// affected item's CO-staged end-state onto a NEW inactive revision, activates
// it, then auto-writes the oldRev → newRev supersession (Q1/Q2/Q5).
//
// Atomicity (G2): createRevision + activateMethodVersion are edge-function
// (functions.invoke → get-method / convert) calls, so this CANNOT be one Kysely
// transaction. The apply is therefore an idempotent, CAS-guarded orchestration:
//   - PER-AFFECTED-ITEM idempotency: each changeOrderAffectedItem gets its
//     created revision id stamped into `newItemId` at the END of its processing.
//     A re-run skips any affected item whose `newItemId` is already set, so a
//     partial failure re-run resumes at the first unprocessed item instead of
//     re-creating revisions.
//   - CO-LEVEL idempotency: the final flip to 'Done' is a compare-and-swap on
//     status='Implementation', so a re-run can't double-transition the CO; only
//     the closing status flip is transactional.
// =============================================================================
export async function applyChangeOrder(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { changeOrderId: string; userId: string; companyId: string }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { changeOrderId, userId, companyId } = args;

  const co = await client
    .from("changeOrder")
    .select("id, status, effectiveDate")
    .eq("id", changeOrderId)
    .eq("companyId", companyId)
    .single();
  if (co.error || !co.data) {
    return { data: null, error: { message: "Change order not found" } };
  }
  if (co.data.status !== "Implementation") {
    return {
      data: null,
      error: { message: "Change order must be at Implementation to apply" }
    };
  }
  const effectiveDate =
    co.data.effectiveDate ?? new Date().toISOString().split("T")[0];

  // Load the affected items with the per-item cutover config. `newItemId` is the
  // idempotency marker — a non-null value means this item was already released.
  const affectedItems = await client
    .from("changeOrderAffectedItem")
    .select(
      "id, itemId, newItemId, supersessionMode, discontinuationDate, successorEffectivityDate"
    )
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
  if (affectedItems.error) {
    return { data: null, error: affectedItems.error };
  }

  for (const affected of affectedItems.data ?? []) {
    // Idempotent skip: this affected item already produced a revision.
    if (affected.newItemId) continue;

    const result = await releaseAffectedItem(client, {
      changeOrderId,
      companyId,
      userId,
      effectiveDate,
      affected
    });
    if (result.error) return { data: null, error: result.error };
  }

  // Manual different-part supersessions (declared on the CO, not revision
  // cutover). Written after all revisions exist so successors resolve.
  const supersessions = await client
    .from("changeOrderSupersession")
    .select(
      "predecessorItemId, successorItemId, supersessionMode, discontinuationDate, successorEffectivityDate"
    )
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId);
  if (supersessions.error) return { data: null, error: supersessions.error };
  for (const sup of supersessions.data ?? []) {
    const written = await upsertItemSupersession(client, {
      itemId: sup.predecessorItemId,
      successorItemId: sup.successorItemId ?? undefined,
      supersessionMode: normalizeSupersessionMode(sup.supersessionMode),
      discontinuationDate: sup.discontinuationDate ?? effectiveDate,
      successorEffectivityDate: sup.successorEffectivityDate ?? effectiveDate,
      companyId,
      createdBy: userId,
      updatedBy: userId
    });
    if (written.error) {
      console.error("Failed to write manual supersession", written.error);
    }
  }

  // Final compare-and-swap: Implementation → Done (the only transactional write).
  try {
    const updated = await db.transaction().execute(async (trx) => {
      const res = await trx
        .updateTable("changeOrder")
        .set({ status: "Done", updatedBy: userId })
        .where("id", "=", changeOrderId)
        .where("companyId", "=", companyId)
        .where("status", "=", "Implementation")
        .executeTakeFirst();
      return Number(res.numUpdatedRows);
    });
    if (updated === 0) {
      return {
        data: null,
        error: { message: "Change order has already been applied" }
      };
    }
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : "Apply failed" }
    };
  }

  return { data: { id: changeOrderId }, error: null };
}

// -----------------------------------------------------------------------------
// releaseAffectedItem — the 7-step per-item release (see applyChangeOrder).
// -----------------------------------------------------------------------------
async function releaseAffectedItem(
  client: SupabaseClient<Database>,
  input: {
    changeOrderId: string;
    companyId: string;
    userId: string;
    effectiveDate: string;
    affected: {
      id: string;
      itemId: string;
      supersessionMode: Database["public"]["Enums"]["supersessionMode"] | null;
      discontinuationDate: string | null;
      successorEffectivityDate: string | null;
    };
  }
): Promise<{ error: { message: string } | null }> {
  const { changeOrderId, companyId, userId, effectiveDate, affected } = input;
  const sourceItemId = affected.itemId;

  // Load the full source item row (createRevision copies its core fields +
  // modelUploadId, i.e. the drawing/CAD reference, onto the new revision).
  const source = await getItem(client, sourceItemId);
  if (source.error || !source.data) {
    return { error: { message: "Failed to load source item" } };
  }
  const sourceItem = source.data;
  const isBuy = sourceItem.replenishmentSystem === "Buy";

  // ---- Step 1: create the new inactive revision -----------------------------
  // Derive the next revision letter from the source's sibling revisions (same
  // readableId + type + company), reusing getNextRevision (the same helper the
  // manual "New Revision" flow uses via the type-table version switcher).
  const nextRevision = await computeNextRevision(client, sourceItem, companyId);
  if (nextRevision.error) return { error: nextRevision.error };

  const revision = await createRevision(client, {
    item: sourceItem,
    revision: nextRevision.data,
    active: false,
    createdBy: userId
  });
  if (revision.error || !revision.data?.id) {
    return { error: { message: "Failed to create revision" } };
  }
  const newItemId = revision.data.id;

  // The new revision's auto-created make method is Draft (create_make_method
  // trigger default). For non-Buy items createRevision copied the source method
  // into it. Resolve it so we can materialize the staged end-state onto it.
  let draftMakeMethodId: string | null = null;
  if (!isBuy) {
    const draft = await client
      .from("makeMethod")
      .select("id")
      .eq("itemId", newItemId)
      .eq("companyId", companyId)
      .eq("status", "Draft")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (draft.error) return { error: draft.error };
    draftMakeMethodId = draft.data?.id ?? null;
  }

  // ---- Step 2: materialize the staged end-state onto the Draft method -------
  // Q5 end-state (not delta-replay): the staged rows ARE the desired method.
  if (draftMakeMethodId) {
    const materialized = await materializeMethod(client, {
      affectedItemId: affected.id,
      draftMakeMethodId,
      companyId,
      userId
    });
    if (materialized.error) return { error: materialized.error };
  }

  // ---- Step 3: apply staged attributes onto the new revision item -----------
  const attributes = await applyStagedAttributes(client, {
    affectedItemId: affected.id,
    newItemId,
    companyId,
    userId
  });
  if (attributes.error) return { error: attributes.error };

  // ---- Step 4: activate the Draft method (Make items only) ------------------
  if (draftMakeMethodId) {
    const activated = await activateMethodVersion(client, {
      id: draftMakeMethodId,
      companyId,
      userId
    });
    if (activated.error) {
      return { error: { message: "Failed to activate method" } };
    }
  }

  // ---- Step 5: flip the new revision active + stamp its originating CO -------
  const activate = await client
    .from("item")
    .update({
      active: true,
      changeOrderId,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", newItemId)
    .eq("companyId", companyId);
  if (activate.error) return { error: activate.error };

  // ---- Step 6: auto-write the oldRev → newRev supersession ------------------
  const sup = await upsertItemSupersession(client, {
    itemId: sourceItemId,
    successorItemId: newItemId,
    supersessionMode: normalizeSupersessionMode(affected.supersessionMode),
    discontinuationDate: affected.discontinuationDate ?? effectiveDate,
    successorEffectivityDate:
      affected.successorEffectivityDate ?? effectiveDate,
    companyId,
    createdBy: userId,
    updatedBy: userId
  });
  if (sup.error) {
    console.error("Failed to write revision supersession", sup.error);
  }

  // ---- Step 7: stamp newItemId (per-item idempotency marker) ----------------
  const marker = await client
    .from("changeOrderAffectedItem")
    .update({
      newItemId,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", affected.id)
    .eq("companyId", companyId);
  if (marker.error) return { error: marker.error };

  return { error: null };
}

// Derive the next revision string from the source's sibling revisions. Siblings
// share readableId + type + company (revision-system.md). getNextRevision does
// the numeric/alpha bump (…0→1, A→B, Z→AA). Pick the max sibling revision.
async function computeNextRevision(
  client: SupabaseClient<Database>,
  sourceItem: {
    readableId: string;
    type: Database["public"]["Enums"]["itemType"];
  },
  companyId: string
): Promise<{ data: string; error: { message: string } | null }> {
  const siblings = await client
    .from("item")
    .select("revision")
    .eq("readableId", sourceItem.readableId)
    .eq("type", sourceItem.type)
    .eq("companyId", companyId);
  if (siblings.error) return { data: "", error: siblings.error };

  const revisions = (siblings.data ?? [])
    .map((r) => r.revision)
    .filter((r): r is string => !!r);
  // Prefer the max NAMED (alpha) revision, else the max numeric, mirroring the
  // list view's "named beats initial" ordering. getNextRevision handles both.
  const alpha = revisions.filter((r) => /^[A-Z]{1,2}$/.test(r)).sort();
  const numeric = revisions
    .filter((r) => /^\d+$/.test(r))
    .sort((a, b) => Number(a) - Number(b));
  const max =
    alpha.length > 0
      ? alpha[alpha.length - 1]
      : (numeric[numeric.length - 1] ?? "0");
  return { data: getNextRevision(max), error: null };
}

// Materialize staged operations + materials onto the new revision's Draft
// method (Q5 end-state — a FULL replace, not delta-replay). createRevision
// copied the source method into the Draft; that copy produces fresh op/material
// ids with NO back-pointer to the source, so the staged rows' sourceOperationId
// / sourceMaterialId cannot be mapped onto the copied Draft rows. We therefore
// wipe the copied Draft method and re-insert the staged end-state verbatim.
// Operations FIRST (materials reference them via stagedOperationId → the new
// methodOperation id, kept in a map). No per-line effectiveFrom (revision-level
// cutover is handled by the supersession in step 6).
async function materializeMethod(
  client: SupabaseClient<Database>,
  input: {
    affectedItemId: string;
    draftMakeMethodId: string;
    companyId: string;
    userId: string;
  }
): Promise<{ error: { message: string } | null }> {
  const { affectedItemId, draftMakeMethodId, companyId, userId } = input;

  // --- Operations: wipe the copied Draft ops, then re-insert every staged op --
  const [stagedOps, draftOps] = await Promise.all([
    client
      .from("changeOrderStagedOperation")
      .select("*")
      .eq("affectedItemId", affectedItemId)
      .eq("companyId", companyId)
      .order("order", { ascending: true }),
    client
      .from("methodOperation")
      .select("id")
      .eq("makeMethodId", draftMakeMethodId)
      .eq("companyId", companyId)
  ]);
  if (stagedOps.error) return { error: stagedOps.error };
  if (draftOps.error) return { error: draftOps.error };

  // The Draft method is fresh (just created by createRevision), but guard each
  // delete with assertMethodOperationIsDraft (throws on Active/Archived) as a
  // defense-in-depth invariant before removing a copied op.
  for (const op of draftOps.data ?? []) {
    try {
      await assertMethodOperationIsDraft(client, op.id);
    } catch (err) {
      return {
        error: {
          message: err instanceof Error ? err.message : "Operation not Draft"
        }
      };
    }
    const del = await deleteMethodOperation(client, op.id);
    if (del.error) return { error: del.error };
  }

  // Insert every staged op. Keep stagedOpId → new methodOperation id for the
  // material → operation link.
  const stagedOpToNewOpId = new Map<string, string>();
  for (const op of stagedOps.data ?? []) {
    const written = await upsertMethodOperation(client, {
      // Cast: the staged columns mirror methodOperation; the validator-shaped
      // insert type is narrower than the raw row, and the DB enum columns are
      // the real guard.
      id: nanoid(),
      makeMethodId: draftMakeMethodId,
      order: op.order,
      operationOrder: op.operationOrder,
      operationType: op.operationType,
      processId: op.processId ?? "",
      workCenterId: op.workCenterId ?? undefined,
      operationSupplierProcessId: op.operationSupplierProcessId ?? undefined,
      procedureId: op.procedureId ?? undefined,
      description: op.description ?? "",
      setupTime: op.setupTime ?? undefined,
      setupUnit: op.setupUnit ?? undefined,
      laborTime: op.laborTime ?? undefined,
      laborUnit: op.laborUnit ?? undefined,
      machineTime: op.machineTime ?? undefined,
      machineUnit: op.machineUnit ?? undefined,
      companyId,
      createdBy: userId
    } as never);
    if (written.error || !written.data?.id) {
      return { error: { message: "Failed to materialize operation" } };
    }
    stagedOpToNewOpId.set(op.id, written.data.id);
  }

  // --- Materials: wipe the copied Draft materials, then re-insert staged set --
  const [stagedMaterials, draftMaterials] = await Promise.all([
    client
      .from("changeOrderStagedMaterial")
      .select("*")
      .eq("affectedItemId", affectedItemId)
      .eq("companyId", companyId)
      .order("order", { ascending: true }),
    client
      .from("methodMaterial")
      .select("id")
      .eq("makeMethodId", draftMakeMethodId)
      .eq("companyId", companyId)
  ]);
  if (stagedMaterials.error) return { error: stagedMaterials.error };
  if (draftMaterials.error) return { error: draftMaterials.error };

  for (const m of draftMaterials.data ?? []) {
    const del = await deleteMethodMaterial(client, m.id);
    if (del.error) return { error: del.error };
  }

  for (const m of stagedMaterials.data ?? []) {
    const newOperationId = m.stagedOperationId
      ? stagedOpToNewOpId.get(m.stagedOperationId)
      : undefined;

    const written = await upsertMethodMaterial(client, {
      // upsertMethodMaterial re-derives methodType/sourcingType from the
      // component item; the values here only satisfy the validator shape (the
      // staged columns are DB `string`, narrower than the zod enums — cast).
      id: nanoid(),
      makeMethodId: draftMakeMethodId,
      itemId: m.itemId,
      quantity: m.quantity,
      unitOfMeasureCode: m.unitOfMeasureCode ?? "EA",
      order: m.order,
      itemType: (m.itemType ?? "Part") as never,
      methodType: m.methodType as never,
      sourcingType: m.sourcingType as never,
      materialMakeMethodId: m.materialMakeMethodId ?? undefined,
      methodOperationId: newOperationId,
      kit: false,
      storageUnitIds: {} as unknown as Record<string, string>,
      companyId,
      createdBy: userId
    } as never);
    if (written.error) {
      return { error: { message: "Failed to materialize material" } };
    }
  }

  return { error: null };
}

// Apply the staged attribute redline onto the new revision's item columns.
// Only item-table columns are staged (name/description/uom/tracking/method/
// sourcing/inspection/thumbnail); no extension-table writes needed. Buy items
// with no method still get their attributes applied here.
async function applyStagedAttributes(
  client: SupabaseClient<Database>,
  input: {
    affectedItemId: string;
    newItemId: string;
    companyId: string;
    userId: string;
  }
): Promise<{ error: { message: string } | null }> {
  const { affectedItemId, newItemId, companyId, userId } = input;
  const staged = await client
    .from("changeOrderStagedItemAttributes")
    .select("*")
    .eq("affectedItemId", affectedItemId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (staged.error) return { error: staged.error };
  if (!staged.data) return { error: null };

  const a = staged.data;
  // Build an update of only the mirrored item columns that were staged.
  const update: Database["public"]["Tables"]["item"]["Update"] = {
    updatedBy: userId,
    updatedAt: new Date().toISOString()
  };
  if (a.name != null) update.name = a.name;
  if (a.description != null) update.description = a.description;
  if (a.unitOfMeasureCode != null)
    update.unitOfMeasureCode = a.unitOfMeasureCode;
  if (a.itemTrackingType != null)
    update.itemTrackingType =
      a.itemTrackingType as Database["public"]["Enums"]["itemTrackingType"];
  if (a.defaultMethodType != null)
    update.defaultMethodType = a.defaultMethodType;
  if (a.replenishmentSystem != null)
    update.replenishmentSystem =
      a.replenishmentSystem as Database["public"]["Enums"]["itemReplenishmentSystem"];
  if (a.sourcingType != null) update.sourcingType = a.sourcingType;
  if (a.requiresInspection != null)
    update.requiresInspection = a.requiresInspection;
  if (a.thumbnailPath != null) update.thumbnailPath = a.thumbnailPath;

  const written = await client
    .from("item")
    .update(update)
    .eq("id", newItemId)
    .eq("companyId", companyId);
  if (written.error) return { error: written.error };
  return { error: null };
}

// Coerce a possibly-null DB supersession mode to a valid enum member, defaulting
// to 'Consume First' (Q3 default) when unset/invalid.
function normalizeSupersessionMode(
  mode: string | null | undefined
): Database["public"]["Enums"]["supersessionMode"] {
  return (supersessionModes as readonly string[]).includes(mode ?? "")
    ? (mode as Database["public"]["Enums"]["supersessionMode"])
    : "Consume First";
}
