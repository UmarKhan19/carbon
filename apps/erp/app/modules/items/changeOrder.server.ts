import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { trigger } from "@carbon/jobs";
import type { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getChangeOrderNotificationRecipients } from "./changeOrder.service";
import {
  getMakeMethods,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId
} from "./items.service";
import type { Material, Operation } from "./ui/ChangeOrder/RedlineDiff";

// =============================================================================
// notifyChangeOrderTransition — fires a `notify` job at a real change-order
// transition commit point. Resolves recipients (reviewers ∪ affected-item
// product managers, deduped, nulls skipped) and dispatches a single
// `type:"users"` notification. Best-effort: never throws into the caller's
// transaction/redirect path. Server-only (imports @carbon/jobs); lives here
// rather than in changeOrder.service.ts (which is re-exported to the client
// bundle).
// =============================================================================

export async function notifyChangeOrderTransition(
  client: SupabaseClient<Database>,
  args: {
    event: NotificationEvent;
    changeOrderId: string;
    companyId: string;
    userId: string;
  }
): Promise<void> {
  try {
    const userIds = await getChangeOrderNotificationRecipients(
      client,
      args.changeOrderId,
      args.companyId
    );
    if (userIds.length === 0) return;
    await trigger("notify", {
      event: args.event,
      companyId: args.companyId,
      documentId: args.changeOrderId,
      recipient: { type: "users", userIds },
      from: args.userId
    });
  } catch (e) {
    console.error("Failed to trigger change order notification", e);
  }
}

// =============================================================================
// releaseChangeOrder — the release transaction.
//
// Promotes each affected item's pending revision into Production and supersedes
// the prior (currently-released) revision to Obsolete, stamps effectivity, and
// flips the change order to Released. All writes happen in a single Kysely
// transaction (mirrors accounting.server.ts db.transaction().execute()).
// =============================================================================

export async function releaseChangeOrder(
  db: Kysely<KyselyDatabase>,
  args: {
    changeOrderId: string;
    userId: string;
    companyId: string;
  }
): Promise<{
  data: { id: string } | null;
  error: { message: string } | null;
}> {
  const { changeOrderId, userId, companyId } = args;
  const today = new Date().toISOString().split("T")[0];

  try {
    const result = await db.transaction().execute(async (trx) => {
      // (a) load the change order + its affected items.
      const changeOrder = await trx
        .selectFrom("changeOrder")
        .select(["id", "status", "effectiveDate"])
        .where("id", "=", changeOrderId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();

      if (!changeOrder) throw new Error("Change order not found");

      // Only an Approved change order may be released. Throwing here rolls back
      // the whole transaction.
      if (changeOrder.status !== "Approved") {
        throw new Error("Change order must be approved before release");
      }

      const changeOrderItems = await trx
        .selectFrom("changeOrderItem")
        .select(["id", "itemId", "pendingItemId"])
        .where("changeOrderId", "=", changeOrderId)
        .where("companyId", "=", companyId)
        .execute();

      // (b) for each item with a pending revision: promote the pending item to
      // Production and obsolete the prior (current) revision.
      //
      // TODO: tiered release (Prototype / Pre-Production) is a later phase.
      // Phase 1 promotes straight to Production on release.
      for (const coItem of changeOrderItems) {
        if (!coItem.pendingItemId) continue;

        await trx
          .updateTable("item")
          .set({ revisionStatus: "Production", updatedBy: userId })
          .where("id", "=", coItem.pendingItemId)
          .where("companyId", "=", companyId)
          .execute();

        await trx
          .updateTable("item")
          .set({ revisionStatus: "Obsolete", updatedBy: userId })
          .where("id", "=", coItem.itemId)
          .where("companyId", "=", companyId)
          .execute();

        // Flip make-method lifecycle: the new revision's Draft make methods go
        // Active; the prior revision's Active make methods become Archived so
        // activeMakeMethods resolves to the freshly released revision.
        await trx
          .updateTable("makeMethod")
          .set({ status: "Active", updatedBy: userId })
          .where("itemId", "=", coItem.pendingItemId)
          .where("companyId", "=", companyId)
          .where("status", "=", "Draft")
          .execute();

        await trx
          .updateTable("makeMethod")
          .set({ status: "Archived", updatedBy: userId })
          .where("itemId", "=", coItem.itemId)
          .where("companyId", "=", companyId)
          .where("status", "=", "Active")
          .execute();
      }

      // (c) stamp effectiveDate if not already set.
      const effectiveDate = changeOrder.effectiveDate ?? today;

      // (d) flip the change order to Released. The status="Approved" predicate
      // makes this a compare-and-swap: under READ COMMITTED a second concurrent
      // release blocks on this row, then re-evaluates the predicate against the
      // now-Released row and updates 0 rows. Treat 0 updated rows as
      // already-released and roll back (throw) so two releases never both fire
      // the revision-promotion + make-method flip.
      const flip = await trx
        .updateTable("changeOrder")
        .set({
          status: "Released",
          effectiveDate,
          updatedBy: userId
        })
        .where("id", "=", changeOrderId)
        .where("companyId", "=", companyId)
        .where("status", "=", "Approved")
        .executeTakeFirst();

      if (Number(flip.numUpdatedRows) === 0) {
        throw new Error("Change order has already been released");
      }

      return { id: changeOrderId };
    });

    return { data: result, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : "Release failed" }
    };
  }
}

// =============================================================================
// getChangeOrderValidations — pragmatic pre-release checks.
//
// Returns { errors, warnings }. Errors block release; warnings are advisory.
//   - error: an affected item on an Engineering CO that has no pendingItemId
//     (nothing to release for that item).
//   - error: a pending revision whose status would exceed any of its child
//     materials' revisionStatus (parent must not be more mature than children).
//   - warning: a pending revision being released has no controlled drawing.
// =============================================================================

const REVISION_STATUS_RANK: Record<string, number> = {
  Design: 0,
  Prototype: 1,
  Production: 2,
  Obsolete: 3
};

export async function getChangeOrderValidations(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const changeOrder = await client
    .from("changeOrder")
    .select("id, type")
    .eq("id", changeOrderId)
    .eq("companyId", companyId)
    .single();

  if (changeOrder.error || !changeOrder.data) {
    return { errors: ["Change order not found"], warnings };
  }

  const items = await client
    .from("changeOrderItem")
    .select(
      "id, itemId, pendingItemId, ...item!changeOrderItem_itemId_fkey(itemReadableId:readableIdWithRevision), pendingItem:item!changeOrderItem_pendingItemId_fkey(id, readableIdWithRevision, revisionStatus)"
    )
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId);

  const affectedItems = (items.data ?? []) as Array<{
    id: string;
    itemId: string;
    pendingItemId: string | null;
    itemReadableId: string | null;
    pendingItem: {
      id: string;
      readableIdWithRevision: string | null;
      revisionStatus: string | null;
    } | null;
  }>;

  // Engineering COs must produce a pending revision for each affected item.
  for (const item of affectedItems) {
    if (changeOrder.data.type === "Engineering" && !item.pendingItemId) {
      errors.push(
        `Affected item ${
          item.itemReadableId ?? item.itemId
        } has no pending revision to release`
      );
    }
  }

  // Parent revisionStatus must not exceed any child material's status. Resolve
  // each pending item's make method, then its child materials' items, and
  // compare ranks.
  const pendingItemIds = affectedItems
    .map((i) => i.pendingItem?.id)
    .filter((id): id is string => Boolean(id));

  if (pendingItemIds.length > 0) {
    const makeMethods = await client
      .from("makeMethod")
      .select("id, itemId")
      .in("itemId", pendingItemIds)
      .eq("companyId", companyId);

    const makeMethodIdsByItem = new Map<string, string[]>();
    for (const mm of makeMethods.data ?? []) {
      const list = makeMethodIdsByItem.get(mm.itemId) ?? [];
      list.push(mm.id);
      makeMethodIdsByItem.set(mm.itemId, list);
    }

    const allMakeMethodIds = (makeMethods.data ?? []).map((mm) => mm.id);

    if (allMakeMethodIds.length > 0) {
      const materials = await client
        .from("methodMaterial")
        .select(
          "makeMethodId, itemId, ...item(childReadableId:readableIdWithRevision, childRevisionStatus:revisionStatus)"
        )
        .in("makeMethodId", allMakeMethodIds)
        .eq("companyId", companyId);

      const childrenByMakeMethod = new Map<
        string,
        Array<{ readableId: string | null; status: string | null }>
      >();
      for (const m of (materials.data ?? []) as Array<{
        makeMethodId: string;
        childReadableId: string | null;
        childRevisionStatus: string | null;
      }>) {
        const list = childrenByMakeMethod.get(m.makeMethodId) ?? [];
        list.push({
          readableId: m.childReadableId,
          status: m.childRevisionStatus
        });
        childrenByMakeMethod.set(m.makeMethodId, list);
      }

      for (const item of affectedItems) {
        const pending = item.pendingItem;
        if (!pending?.id) continue;
        const parentRank =
          REVISION_STATUS_RANK[pending.revisionStatus ?? ""] ?? 0;
        const mmIds = makeMethodIdsByItem.get(pending.id) ?? [];
        for (const mmId of mmIds) {
          for (const child of childrenByMakeMethod.get(mmId) ?? []) {
            const childRank = REVISION_STATUS_RANK[child.status ?? ""] ?? 0;
            // Obsolete children are excluded — they don't gate parent maturity.
            if (child.status === "Obsolete") continue;
            if (parentRank > childRank) {
              errors.push(
                `${
                  pending.readableIdWithRevision ?? pending.id
                } cannot be more mature than child ${
                  child.readableId ?? "material"
                } (${child.status})`
              );
            }
          }
        }
      }
    }
  }

  // Drawing SSOT (spec §7, Task 34) — warn (never block) when a pending revision
  // being released has no controlled 2D drawing attached. The manual controlled
  // drawing lives in the per-item `drawing` externalIntegrationMapping metadata
  // slot (its own integration key, decoupled from the parked OnShape importer's
  // `onshape` slot to avoid collision/clobber). Release still proceeds; this is
  // purely advisory in the existing ValidationBanner.
  if (pendingItemIds.length > 0) {
    const drawingMappings = await client
      .from("externalIntegrationMapping")
      .select("entityId, metadata")
      .eq("entityType", "item")
      .eq("integration", "drawing")
      .in("entityId", pendingItemIds)
      .eq("companyId", companyId);

    const itemsWithDrawing = new Set<string>();
    for (const m of drawingMappings.data ?? []) {
      const metadata = m.metadata as { drawingPath?: string | null } | null;
      if (metadata?.drawingPath) {
        itemsWithDrawing.add(m.entityId);
      }
    }

    for (const item of affectedItems) {
      const pending = item.pendingItem;
      if (!pending?.id) continue;
      if (!itemsWithDrawing.has(pending.id)) {
        warnings.push(
          `${
            pending.readableIdWithRevision ?? pending.id
          } has no controlled drawing attached`
        );
      }
    }
  }

  return { errors, warnings };
}

// =============================================================================
// Method snapshot — resolves an item's active make method into a flat
// (multi-level) materials list + top-level operations, shaped for RedlineDiff.
// Moved out of the route loader so both the affected-items sidebar (for the
// +/−/~ signal) and the focused per-item view can share one implementation.
// =============================================================================

// Max recursion depth for the multi-level BOM walk (defensive cap; real BOMs
// are far shallower). Guards against pathological / cyclic data.
const MAX_BOM_DEPTH = 20;

// Recursively flatten a make method's materials, descending into any material
// that is itself a sub-assembly (has a materialMakeMethodId). Each flattened
// material carries its `level` (0 = top) and a stable `key` (a path of item ids
// like `parentKey>itemId`) so the same item appearing at multiple levels never
// collides in the redline diff. `visited` tracks makeMethodIds already walked
// to break cycles.
async function flattenMaterials(
  client: SupabaseClient<Database>,
  makeMethodId: string,
  level: number,
  parentKey: string,
  visited: Set<string>
): Promise<Material[]> {
  if (level > MAX_BOM_DEPTH || visited.has(makeMethodId)) return [];
  visited.add(makeMethodId);

  const { data } = await getMethodMaterialsByMakeMethod(client, makeMethodId);
  const rows = (data ?? []) as any[];

  const result: Material[] = [];
  for (const m of rows) {
    const key = `${parentKey}>${m.itemId ?? m.id}`;
    result.push({
      key,
      level,
      itemId: m.itemId,
      itemReadableId: m.itemId,
      description: m.item?.name ?? null,
      quantity: m.quantity,
      unitOfMeasureCode: m.unitOfMeasureCode
    });

    if (m.materialMakeMethodId) {
      const children = await flattenMaterials(
        client,
        m.materialMakeMethodId,
        level + 1,
        key,
        visited
      );
      result.push(...children);
    }
  }

  return result;
}

// Resolves the active make method for an item, then its (multi-level) materials
// + top-level operations. Seeds the material key path with a SIDE-INDEPENDENT
// constant ("root"), NOT the owning item id — the current snapshot is keyed off
// the original item and the pending snapshot off the pending revision, which
// have different ids; if either id were in the key no key would ever match
// across the two sides and the redline would mark every material removed+added.
// Child item ids are identical across revisions (createRevision copies the BOM
// pointing at the same children), so a constant seed makes unchanged rows
// collapse correctly.
export async function getMethodSnapshot(
  client: SupabaseClient<Database>,
  itemId: string | null,
  companyId: string
): Promise<{
  materials: Material[];
  operations: Operation[];
}> {
  if (!itemId) return { materials: [], operations: [] };

  const makeMethods = await getMakeMethods(client, itemId, companyId);
  const active =
    makeMethods.data?.find((m) => m.status === "Active") ??
    makeMethods.data?.[0];
  if (!active) return { materials: [], operations: [] };

  const [materials, operations] = await Promise.all([
    flattenMaterials(client, active.id, 0, "root", new Set<string>()),
    getMethodOperationsByMakeMethodId(client, active.id)
  ]);

  return {
    materials,
    operations: (operations.data ?? []).map((o: any) => ({
      description: o.description,
      order: o.order,
      workCenter: null
    }))
  };
}
