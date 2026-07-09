import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { trigger } from "@carbon/jobs";
import { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import {
  activateMethodVersion,
  copyMakeMethod,
  deleteMethodMaterial,
  getMethodMaterialsByMakeMethod,
  upsertItemSupersession,
  upsertMakeMethodVersion,
  upsertMethodMaterial
} from "~/modules/items";
import { isItemFullyObsoleted } from "./change-orders.models";
import {
  getAssembliesUsingItem,
  getChangeOrderBomChanges
} from "./change-orders.service";

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
// applyChangeOrder — the "release" equivalent, run on the Implementation → Done
// transition (this function IS that transition). Orchestrates Carbon's canonical
// make-method helpers (G1) — it does NOT re-implement version lifecycle.
//
// Atomicity (G2): copyMakeMethod / activateMethodVersion are edge-function
// (functions.invoke) calls, so they cannot run inside a Kysely transaction. The
// apply is therefore an idempotent, CAS-guarded orchestration, NOT one txn:
//   - the final flip to 'Done' is a compare-and-swap on status='Implementation',
//     so a re-run can't double-apply at the CO level (a Done CO returns early);
//   - only the closing status flip is transactional.
// Known V1 limitation: after a PARTIAL failure (some assemblies activated, CO
// still Implementation) a re-run reprocesses every assembly and may create extra
// draft versions — there is no per-assembly applied-marker yet. The CO-level CAS
// still prevents a double transition to Done.
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
  const effectiveFrom =
    co.data.effectiveDate ?? new Date().toISOString().split("T")[0];

  const bom = await getChangeOrderBomChanges(client, changeOrderId, companyId);
  if (bom.error) return { data: null, error: { message: bom.error.message } };
  const rows = bom.data ?? [];

  // Resolve each targeted assembly's active make method ONCE, up front — shared
  // by the pre-flight validation and the apply loop (one lookup per assembly).
  const activeByAssembly = new Map<
    string,
    { id: string; version: number } | null
  >();
  for (const assemblyItemId of new Set(
    rows.flatMap((r) => r.assemblies.map((a) => a.assemblyItemId))
  )) {
    const active = await client
      .from("activeMakeMethods")
      .select("id, version")
      .eq("itemId", assemblyItemId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (active.error) return { data: null, error: active.error };
    activeByAssembly.set(
      assemblyItemId,
      active.data?.id
        ? { id: active.data.id, version: active.data.version ?? 1 }
        : null
    );
  }

  // Pre-flight validation (plan §3b): a Delete target must be applicable — the
  // targeted assembly must have an Active make method AND that method must
  // currently carry the part being removed. Without this, a mismatched Delete
  // would silently no-op below (skip an assembly with no method / find no
  // material to delete) and the CO would flip to Done having changed nothing.
  const deleteRowsToValidate = rows.filter((r) => r.changeType === "Delete");
  const problems: string[] = [];
  for (const row of deleteRowsToValidate) {
    for (const asm of row.assemblies) {
      const active = activeByAssembly.get(asm.assemblyItemId);
      if (!active) {
        problems.push(
          `Assembly ${asm.assemblyItemId} has no active make method to remove ${row.itemId} from`
        );
        continue;
      }
      const materials = await getMethodMaterialsByMakeMethod(client, active.id);
      const present = (materials.data ?? []).some(
        (m) => m.itemId === row.itemId
      );
      if (!present) {
        problems.push(
          `${row.itemId} is not on the active method of assembly ${asm.assemblyItemId}`
        );
      }
    }
  }
  if (problems.length > 0) {
    return { data: null, error: { message: problems.join("; ") } };
  }

  // Group the row ops by the assembly they target: deletes remove that part's
  // methodMaterial, adds insert a new methodMaterial (qty per assembly).
  const assemblyOps = new Map<
    string,
    { deletes: Set<string>; adds: Array<{ itemId: string; quantity: number }> }
  >();
  for (const row of rows) {
    for (const asm of row.assemblies) {
      const ops = assemblyOps.get(asm.assemblyItemId) ?? {
        deletes: new Set<string>(),
        adds: []
      };
      if (row.changeType === "Delete") ops.deletes.add(row.itemId);
      else ops.adds.push({ itemId: row.itemId, quantity: asm.quantity });
      assemblyOps.set(asm.assemblyItemId, ops);
    }
  }

  // Per-assembly: spin a Draft version off the current Active method, copy its
  // BOM/BOP, apply the row ops on the draft, then activate (Draft→Active).
  for (const [assemblyItemId, ops] of assemblyOps) {
    const active = activeByAssembly.get(assemblyItemId);
    if (!active) continue; // no make method on this assembly — skip

    const version = await upsertMakeMethodVersion(client, {
      copyFromId: active.id,
      version: active.version + 1,
      companyId,
      createdBy: userId
    });
    if (version.error || !version.data?.id) {
      return {
        data: null,
        error: { message: "Failed to create method version" }
      };
    }
    const draftId = version.data.id;

    const copy = await copyMakeMethod(client, {
      sourceId: active.id,
      targetId: draftId,
      billOfMaterial: true,
      billOfProcess: true,
      parameters: true,
      tools: true,
      steps: true,
      workInstructions: true,
      companyId,
      userId
    });
    if (copy.error)
      return { data: null, error: { message: "Failed to copy method" } };

    const materials = await getMethodMaterialsByMakeMethod(client, draftId);
    const draftMaterials = materials.data ?? [];
    for (const m of draftMaterials) {
      if (m.itemId && ops.deletes.has(m.itemId)) {
        const del = await deleteMethodMaterial(client, m.id);
        if (del.error) {
          return {
            data: null,
            error: { message: "Failed to remove material" }
          };
        }
      }
    }

    let order = draftMaterials.length + 1;
    for (const add of ops.adds) {
      const upsert = await upsertMethodMaterial(client, {
        id: nanoid(),
        makeMethodId: draftId,
        itemId: add.itemId,
        quantity: add.quantity,
        unitOfMeasureCode: "EA",
        order: order++,
        itemType: "Part",
        // methodType / sourcingType are re-derived from the component item by
        // upsertMethodMaterial; these satisfy the validator shape only.
        methodType: "Pull from Inventory",
        sourcingType: "Specified",
        kit: false,
        storageUnitIds: {} as unknown as Record<string, string>,
        effectiveFrom,
        companyId,
        createdBy: userId
      });
      if (upsert.error) {
        return { data: null, error: { message: "Failed to add material" } };
      }
    }

    const activate = await activateMethodVersion(client, {
      id: draftId,
      companyId,
      userId
    });
    if (activate.error) {
      return { data: null, error: { message: "Failed to activate method" } };
    }
  }

  // Supersession (G8 predicate): write a GLOBAL itemSupersession only for a
  // deleted part that is fully obsoleted (removed from every assembly using it
  // and not re-added). The per-assembly modes remain the recorded stock
  // instructions on the CO.
  const deleteRows = rows.filter((r) => r.changeType === "Delete");
  const addRows = rows.filter((r) => r.changeType === "Add");
  // Successor link is recorded only for an unambiguous 1→1 replacement (V1
  // single-swap): with multiple distinct added parts we can't say which one
  // succeeds an obsoleted part, so we record the discontinuation without an
  // auto-successor rather than arbitrarily pick the first Add row.
  const addItemIds = [...new Set(addRows.map((r) => r.itemId))];
  const successorItemId = addItemIds.length === 1 ? addItemIds[0] : undefined;
  for (const del of deleteRows) {
    const using = await getAssembliesUsingItem(client, del.itemId, companyId);
    const fullyObsoleted = isItemFullyObsoleted({
      deleteAssemblyIds: del.assemblies.map((a) => a.assemblyItemId),
      assembliesUsingItem: (using.data ?? []).map((a) => a.assemblyId),
      isReAddedElsewhere: addRows.some((a) => a.itemId === del.itemId)
    });
    if (!fullyObsoleted) continue;
    const mode = del.assemblies.find(
      (a) => a.supersessionMode
    )?.supersessionMode;
    const sup = await upsertItemSupersession(client, {
      itemId: del.itemId,
      successorItemId,
      supersessionMode: mode ?? undefined,
      discontinuationDate: effectiveFrom,
      successorEffectivityDate: effectiveFrom,
      companyId,
      createdBy: userId,
      updatedBy: userId
    });
    if (sup.error) console.error("Failed to write supersession", sup.error);
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
