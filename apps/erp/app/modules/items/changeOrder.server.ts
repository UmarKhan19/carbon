import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { trigger } from "@carbon/jobs";
import { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { itemRevisionStatus } from "./items.models";
import {
  getChangeOrderNotificationRecipients,
  getControlledDrawings,
  getMakeMethods,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId
} from "./items.service";
import type { Material, Operation } from "./ui/ChangeOrder/RedlineDiff";

// notifyChangeOrderTransition — fires a `notify` job at a real change-order
// transition commit point. Resolves recipients (reviewers ∪ affected-item
// assignees, deduped, nulls skipped) and dispatches a single `type:"users"`
// notification. Best-effort: never throws into the caller's transaction /
// redirect path. Server-only (imports @carbon/jobs).
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

// notifyIfAutoAdvanced — the SINGLE place the "auto-advanced → Approved" email
// fires. Both review entry points (the reviewer-decision route and the
// reviewer-task-completion route) funnel their reevaluation result through here,
// so the Approved notification is written once, not duplicated per route. The
// CAS inside reevaluateChangeOrderApproval guarantees only one caller ever sees
// autoAdvanced === true, so this fires exactly once even under concurrency.
export async function notifyIfAutoAdvanced(
  client: SupabaseClient<Database>,
  result: { data: { autoAdvanced: boolean } | null },
  args: { changeOrderId: string; companyId: string; userId: string }
): Promise<void> {
  if (!result.data?.autoAdvanced) return;
  await notifyChangeOrderTransition(client, {
    event: NotificationEvent.ChangeOrderApproved,
    ...args
  });
}

// releaseChangeOrder — the release transaction. Promotes each affected item's
// pending revision to Production, supersedes the prior revision to Obsolete,
// flips make-method lifecycle (Draft→Active / Active→Archived), stamps
// effectivity, and flips the CO to Released — all in one Kysely transaction. The
// status="Approved" predicate on the final flip is a compare-and-swap: a second
// concurrent release updates 0 rows and rolls back, so the revision-promotion
// never fires twice.
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
      const changeOrder = await trx
        .selectFrom("changeOrder")
        .select(["id", "status", "effectiveDate"])
        .where("id", "=", changeOrderId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();

      if (!changeOrder) throw new Error("Change order not found");

      if (changeOrder.status !== "Approved") {
        throw new Error("Change order must be approved before release");
      }

      const changeOrderItems = await trx
        .selectFrom("changeOrderItem")
        .select(["id", "itemId", "pendingItemId"])
        .where("changeOrderId", "=", changeOrderId)
        .where("companyId", "=", companyId)
        .execute();

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

      const effectiveDate = changeOrder.effectiveDate ?? today;

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

// Maturity rank derived from the canonical itemRevisionStatus enum (which is
// declared in maturity order: Design < Prototype < Production < Obsolete), so a
// new tier added to the enum ranks correctly here without a second edit.
// Unknown/unlisted statuses fall back to the lowest rank.
const revisionRank = (status: string | null | undefined): number => {
  const i = itemRevisionStatus.indexOf(
    status as (typeof itemRevisionStatus)[number]
  );
  return i === -1 ? 0 : i;
};

// getChangeOrderValidations — pre-release checks. Returns { errors, warnings }:
// errors block release, warnings are advisory.
//   - error: an Engineering-CO affected item with no pending revision.
//   - error: a pending revision more mature than a (non-obsolete) child material.
//   - error/warning (§5): affected items lacking an explicit disposition, gated
//     by companySettings.plmReleaseControl (enforce → error, warn → warning,
//     off → skipped).
//   - warning: a released pending revision with no controlled drawing.
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

  const settings = await client
    .from("companySettings")
    .select("plmReleaseControl")
    .eq("id", companyId)
    .single();
  const releaseControl = settings.data?.plmReleaseControl ?? "enforce";

  const items = await client
    .from("changeOrderItem")
    .select(
      "id, itemId, pendingItemId, disposition, ...item!changeOrderItem_itemId_fkey(itemReadableId:readableIdWithRevision), pendingItem:item!changeOrderItem_pendingItemId_fkey(id, readableIdWithRevision, revisionStatus)"
    )
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId);

  const affectedItems = (items.data ?? []) as Array<{
    id: string;
    itemId: string;
    pendingItemId: string | null;
    disposition: string | null;
    itemReadableId: string | null;
    pendingItem: {
      id: string;
      readableIdWithRevision: string | null;
      revisionStatus: string | null;
    } | null;
  }>;

  for (const item of affectedItems) {
    if (changeOrder.data.type === "Engineering" && !item.pendingItemId) {
      errors.push(
        `Affected item ${
          item.itemReadableId ?? item.itemId
        } has no pending revision to release`
      );
    }

    // §5: an "explicit disposition" means the user moved it off the "No Change"
    // default. enforce blocks release; warn is advisory; off skips the check.
    if (releaseControl !== "off") {
      const hasExplicitDisposition =
        !!item.disposition && item.disposition !== "No Change";
      if (!hasExplicitDisposition) {
        const message = `Affected item ${
          item.itemReadableId ?? item.itemId
        } needs an explicit disposition before release`;
        if (releaseControl === "enforce") {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      }
    }
  }

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
        const parentRank = revisionRank(pending.revisionStatus);
        const mmIds = makeMethodIdsByItem.get(pending.id) ?? [];
        for (const mmId of mmIds) {
          for (const child of childrenByMakeMethod.get(mmId) ?? []) {
            const childRank = revisionRank(child.status);
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

  // Controlled-drawing SSOT — warn (never block) when a released pending
  // revision has no controlled 2D drawing in the per-item `drawing`
  // externalIntegrationMapping slot.
  if (pendingItemIds.length > 0) {
    const drawings = await getControlledDrawings(client, {
      itemIds: pendingItemIds,
      companyId
    });

    for (const item of affectedItems) {
      const pending = item.pendingItem;
      if (!pending?.id) continue;
      if (!drawings.has(pending.id)) {
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

// Max recursion depth for the multi-level BOM walk (defensive cap; real BOMs
// are far shallower). Guards against pathological / cyclic data.
const MAX_BOM_DEPTH = 20;

// Recursively flatten a make method's materials, descending into any material
// that is itself a sub-assembly. Each material carries its `level` and a stable
// `key` (a path of item ids) so the same item at multiple levels never collides
// in the redline. `visited` breaks cycles.
async function flattenMaterials(
  client: SupabaseClient<Database>,
  makeMethodId: string,
  level: number,
  parentKey: string,
  ancestors: Set<string>
): Promise<Material[]> {
  // `ancestors` is a per-PATH set (the make methods on the branch above this
  // one), NOT a global visited set — a sub-assembly legitimately reused under
  // two different parents (a diamond BOM) must expand under BOTH; only a true
  // cycle (a make method that reappears among its own ancestors) is skipped.
  if (level > MAX_BOM_DEPTH || ancestors.has(makeMethodId)) return [];
  const path = new Set(ancestors).add(makeMethodId);

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
        path
      );
      result.push(...children);
    }
  }

  return result;
}

// Resolves the active make method for an item, then its (multi-level) materials
// + top-level operations. Seeds the material key path with a SIDE-INDEPENDENT
// constant ("root"), NOT the owning item id — the current snapshot is keyed off
// the original item and the pending snapshot off the pending revision (different
// ids); a constant seed makes unchanged rows collapse across Before/After.
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
  // A released item's working method is Active; a pending (unreleased) revision's
  // is still Draft (it only flips to Active at release). Prefer Active, then the
  // Draft — otherwise the pending "After" snapshot would fall back to an
  // arbitrary/Archived method and the redline would show the wrong BOM.
  const method =
    makeMethods.data?.find((m) => m.status === "Active") ??
    makeMethods.data?.find((m) => m.status === "Draft") ??
    makeMethods.data?.[0];
  if (!method) return { materials: [], operations: [] };

  const [materials, operations] = await Promise.all([
    flattenMaterials(client, method.id, 0, "root", new Set<string>()),
    getMethodOperationsByMakeMethodId(client, method.id)
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
