import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type {
  ExpressionBuilder,
  Kysely,
  KyselyDatabase,
  KyselyTx
} from "@carbon/database/client";
import type { JSONContent } from "@carbon/react";
import { getLocalTimeZone, now, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type { nonConformancePriority } from "../quality/quality.models";
import type {
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator
} from "../shared";
import {
  lookupBuyPriceFromMap,
  type MethodType,
  type PriceBreak,
  type SourcingType,
  type SupplierPriceMap
} from "../shared";
import {
  canEditChangeOrderItems,
  type changeOrderApprovalType,
  type changeOrderDisposition,
  type changeOrderStatus,
  type changeOrderTaskStatus,
  type changeOrderType,
  type configurationParameterGroupOrderValidator,
  type configurationParameterGroupValidator,
  type configurationParameterOrderValidator,
  type configurationParameterValidator,
  type configurationRuleValidator,
  type consumableValidator,
  type customerPartValidator,
  evaluateApprovalThreshold,
  type getMethodValidator,
  ItemTrackingType,
  isAllowedChangeOrderTransition,
  type itemCostValidator,
  type itemManufacturingValidator,
  type itemPlanningValidator,
  type itemPostingGroupValidator,
  type itemPurchasingValidator,
  type itemSupersessionValidator,
  type itemUnitSalePriceValidator,
  type itemValidator,
  type makeMethodVersionValidator,
  type materialDimensionValidator,
  type materialFinishValidator,
  type materialFormValidator,
  type materialGradeValidator,
  type materialSubstanceValidator,
  type materialTypeValidator,
  type materialValidator,
  type methodMaterialValidator,
  type methodOperationValidator,
  type partValidator,
  type pickMethodSortMethods,
  type pickMethodValidator,
  type serviceValidator,
  type shelfLifeModes,
  type shelfLifeTriggerTimings,
  type supplierPartValidator,
  type toolValidator,
  type unitOfMeasureValidator
} from "./items.models";
import type { InventoryItemType } from "./types";

export async function activateMethodVersion(
  client: SupabaseClient<Database>,
  payload: {
    id: string;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke<{ convertedId: string }>("convert", {
    body: {
      type: "methodVersionToActive",
      ...payload
    }
  });
}

export async function copyItem(
  client: SupabaseClient<Database>,
  args: z.infer<typeof getMethodValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("get-method", {
    body: {
      type: "itemToItem",
      sourceId: args.sourceId,
      targetId: args.targetId,
      companyId: args.companyId,
      userId: args.userId,
      parts: {
        billOfMaterial: args.billOfMaterial,
        billOfProcess: args.billOfProcess,
        parameters: args.parameters,
        tools: args.tools,
        steps: args.steps,
        workInstructions: args.workInstructions
      }
    }
  });
}

export async function copyMakeMethod(
  client: SupabaseClient<Database>,
  args: z.infer<typeof getMethodValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("get-method", {
    body: {
      type: "makeMethodToMakeMethod",
      sourceId: args.sourceId,
      targetId: args.targetId,
      companyId: args.companyId,
      userId: args.userId,
      parts: {
        billOfMaterial: args.billOfMaterial,
        billOfProcess: args.billOfProcess,
        parameters: args.parameters,
        tools: args.tools,
        steps: args.steps,
        workInstructions: args.workInstructions
      }
    }
  });
}

export async function createRevision(
  client: SupabaseClient<Database>,
  args: {
    item: NonNullable<Awaited<ReturnType<typeof getItem>>["data"]>;
    revision: string;
    createdBy: string;
  }
) {
  const { item, revision, createdBy } = args;
  const itemInsert = await client
    .from("item")
    .insert({
      readableId: item.readableId,
      revision: revision,
      name: item.name,
      type: item.type,
      replenishmentSystem: item.replenishmentSystem,
      defaultMethodType: item.defaultMethodType,
      itemTrackingType: item.itemTrackingType,
      unitOfMeasureCode: item.unitOfMeasureCode,
      active: true,
      modelUploadId: item.modelUploadId,
      companyId: item.companyId,
      createdBy: createdBy
    })
    .select("id")
    .single();

  if (itemInsert.error) {
    return itemInsert;
  }

  if (item.replenishmentSystem !== "Buy") {
    await client.functions.invoke("get-method", {
      body: {
        type: "itemToItem",
        sourceId: item.id,
        targetId: itemInsert.data.id,
        companyId: item.companyId,
        userId: createdBy
      }
    });
  }

  return itemInsert;
}

// =============================================================================
// PLM / change orders (ECO). Reviewer, approval-task, and release behavior are
// not implemented yet.
// =============================================================================

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

export async function getChangeOrderItems(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("changeOrderItem")
    .select(
      "*, ...item!changeOrderItem_itemId_fkey(revision, readableIdWithRevision, revisionStatus), pendingItem:item!changeOrderItem_pendingItemId_fkey(id, readableIdWithRevision, revision, revisionStatus)"
    )
    .eq("changeOrderId", id)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}

export async function getChangeOrderActionTasks(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("changeOrderActionTask")
    .select("*")
    .eq("changeOrderId", id)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function getChangeOrderApprovalTasks(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("changeOrderApprovalTask")
    .select("*")
    .eq("changeOrderId", id)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function getChangeOrderReviewers(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("changeOrderReviewer")
    .select("*")
    .eq("changeOrderId", id)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("id", { ascending: true });
}

export async function getChangeOrderTasks(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return Promise.all([
    getChangeOrderActionTasks(client, id, companyId),
    getChangeOrderApprovalTasks(client, id, companyId)
  ]);
}

export async function getChangeOrderWorkflow(
  client: SupabaseClient<Database>,
  changeOrderWorkflowId: string
) {
  return client
    .from("changeOrderWorkflow")
    .select("*")
    .eq("id", changeOrderWorkflowId)
    .single();
}

export async function getChangeOrderWorkflows(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("changeOrderWorkflow")
    .select("*", { count: "exact" })
    .eq("companyId", companyId)
    .eq("active", true);

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

export async function getChangeOrderWorkflowsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("changeOrderWorkflow")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");
}

// getMyChangeOrderTasks — the signed-in user's still-Pending change-order
// sign-offs (reviewer rows ∪ approval tasks), each joined to its parent CO so
// the inbox links straight through. Identity is scoped by the caller's
// userId + companyId (both from requirePermissions, never client input).
export type MyChangeOrderTask = {
  changeOrderId: string;
  changeOrderReadableId: string;
  changeOrderName: string;
  changeOrderStatus: (typeof changeOrderStatus)[number];
  taskTitle: string;
  dueDate: string | null;
};

export async function getMyChangeOrderTasks(
  client: SupabaseClient<Database>,
  args: { userId: string; companyId: string }
): Promise<{
  data: MyChangeOrderTask[];
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { userId, companyId } = args;
  const pending: (typeof changeOrderTaskStatus)[number] = "Pending";

  const [reviewers, approvals] = await Promise.all([
    client
      .from("changeOrderReviewer")
      .select(
        "title, dueDate, changeOrder:changeOrderId(id, changeOrderId, name, status)"
      )
      .eq("assignee", userId)
      .eq("status", pending)
      .eq("companyId", companyId),
    client
      .from("changeOrderApprovalTask")
      .select(
        "name, dueDate, changeOrder:changeOrderId(id, changeOrderId, name, status)"
      )
      .eq("assignee", userId)
      .eq("status", pending)
      .eq("companyId", companyId)
  ]);

  if (reviewers.error) return { data: [], error: reviewers.error };
  if (approvals.error) return { data: [], error: approvals.error };

  const tasks: MyChangeOrderTask[] = [];

  for (const r of reviewers.data ?? []) {
    const co = r.changeOrder;
    if (!co) continue;
    tasks.push({
      changeOrderId: co.id,
      changeOrderReadableId: co.changeOrderId,
      changeOrderName: co.name,
      changeOrderStatus: co.status,
      taskTitle: r.title,
      dueDate: r.dueDate
    });
  }

  for (const a of approvals.data ?? []) {
    const co = a.changeOrder;
    if (!co) continue;
    tasks.push({
      changeOrderId: co.id,
      changeOrderReadableId: co.changeOrderId,
      changeOrderName: co.name,
      changeOrderStatus: co.status,
      taskTitle: a.name ?? "Approval",
      dueDate: a.dueDate
    });
  }

  tasks.sort((a, b) => {
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return a.changeOrderReadableId.localeCompare(b.changeOrderReadableId);
  });

  return { data: tasks, error: null };
}

// getChangeOrderImpact — read-only "where used" blast radius for a change
// order's affected items: the jobs, purchase-order lines, sales-order lines, and
// parent BOMs that reference each affected item today, so a reviewer sees what a
// release touches. The four join shapes mirror getPartUsedIn's (kept in sync by
// hand); item-type-independent (works for parts, materials, etc.).
export type ChangeOrderImpactItem = {
  itemId: string;
  itemReadableId: string | null;
  jobs: Array<{ id: string; documentReadableId: string | null }>;
  purchaseOrderLines: Array<{ id: string; documentReadableId: string | null }>;
  salesOrderLines: Array<{ id: string; documentReadableId: string | null }>;
  parentBoms: Array<{ id: string; documentReadableId: string | null }>;
};

export async function getChangeOrderImpact(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<ChangeOrderImpactItem[]> {
  const affected = await client
    .from("changeOrderItem")
    .select(
      "itemId, ...item!changeOrderItem_itemId_fkey(itemReadableId:readableIdWithRevision)"
    )
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId);

  const rows = (affected.data ?? []) as Array<{
    itemId: string;
    itemReadableId: string | null;
  }>;

  return Promise.all(
    rows.map(async (row) => {
      const [jobs, purchaseOrderLines, salesOrderLines, parentBoms] =
        await Promise.all([
          client
            .from("job")
            .select("id, documentReadableId:jobId")
            .eq("itemId", row.itemId)
            .eq("companyId", companyId)
            .limit(100),
          client
            .from("purchaseOrderLine")
            .select(
              "id, documentReadableId:purchaseOrder(purchaseOrderId), purchaseOrderId"
            )
            .eq("itemId", row.itemId)
            .eq("companyId", companyId)
            .limit(100),
          client
            .from("salesOrderLine")
            .select("id, ...salesOrder(documentReadableId:salesOrderId)")
            .eq("itemId", row.itemId)
            .eq("companyId", companyId)
            .limit(100),
          client
            .from("methodMaterial")
            .select(
              "id, ...makeMethod!makeMethodId(...item(documentReadableId:readableIdWithRevision))"
            )
            .eq("itemId", row.itemId)
            .eq("companyId", companyId)
            .limit(100)
        ]);

      const norm = (
        data: any[] | null
      ): Array<{ id: string; documentReadableId: string | null }> =>
        (data ?? []).map((r) => ({
          id: r.id,
          documentReadableId:
            typeof r.documentReadableId === "object"
              ? (r.documentReadableId?.purchaseOrderId ?? null)
              : (r.documentReadableId ?? null)
        }));

      return {
        itemId: row.itemId,
        itemReadableId: row.itemReadableId,
        jobs: norm(jobs.data),
        purchaseOrderLines: norm(purchaseOrderLines.data),
        salesOrderLines: norm(salesOrderLines.data),
        parentBoms: norm(parentBoms.data)
      };
    })
  );
}

export async function insertChangeOrder(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    changeOrderId?: string;
    name: string;
    type: (typeof changeOrderType)[number];
    approvalType: (typeof changeOrderApprovalType)[number];
    priority?: (typeof nonConformancePriority)[number];
    openDate: string;
    description?: Json;
    changeOrderWorkflowId?: string;
    dueDate?: string;
    effectiveDate?: string;
    requiredActionIds?: string[];
    approvalRequirements?: string[];
    sourceType?: string;
    sourceId?: string;
    assignee?: string;
    // Approver picker output: verbose-prefixed "group_…"/"user_…" ids. Resolved
    // to one changeOrderReviewer per user below.
    approvers?: string[];
    items?: string[];
    customFields?: Json;
  }
): Promise<{
  data: { id: string; changeOrderId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
  // Non-fatal seeding failures (per-item attach, reviewer/action-task seeding).
  // Creation is not a single DB transaction because attachAffectedItem invokes
  // the get-method edge function mid-chain, so partial failures are surfaced
  // here rather than swallowed — the caller flashes them.
  warnings: string[];
}> {
  const warnings: string[] = [];
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
        error:
          seq.error ??
          ({
            message: "Failed to generate changeOrder sequence"
          } as import("@supabase/supabase-js").PostgrestError),
        warnings
      };
    }
    changeOrderId = seq.data;
  }

  const { items, approvers, ...data } = input;

  // Split the approver picker output into group ids and individual user ids.
  const approverPicks = approvers ?? [];
  const approverGroupIds = approverPicks
    .filter((a) => a.startsWith("group_"))
    .map((a) => a.slice(6));
  const approverUserIds = approverPicks
    .filter((a) => a.startsWith("user_"))
    .map((a) => a.slice(5));

  // Runs under the service role (RLS bypassed), so validate every supplied
  // item / group / user resolves within this company before trusting it.
  if (items && items.length > 0) {
    const validItems = await client
      .from("item")
      .select("id")
      .in("id", items)
      .eq("companyId", input.companyId);
    if (validItems.error)
      return { data: null, error: validItems.error, warnings };
    const validItemIds = new Set((validItems.data ?? []).map((i) => i.id));
    if (items.some((id) => !validItemIds.has(id))) {
      return {
        data: null,
        error: {
          message: "One or more items do not belong to this company"
        } as import("@supabase/supabase-js").PostgrestError,
        warnings
      };
    }
  }

  if (approverGroupIds.length > 0) {
    const validGroups = await client
      .from("group")
      .select("id")
      .in("id", approverGroupIds)
      .eq("companyId", input.companyId);
    if (validGroups.error)
      return { data: null, error: validGroups.error, warnings };
    const validGroupIds = new Set((validGroups.data ?? []).map((g) => g.id));
    if (approverGroupIds.some((id) => !validGroupIds.has(id))) {
      return {
        data: null,
        error: {
          message: "One or more approver groups do not belong to this company"
        } as import("@supabase/supabase-js").PostgrestError,
        warnings
      };
    }
  }

  if (approverUserIds.length > 0) {
    const validUsers = await client
      .from("userToCompany")
      .select("userId")
      .in("userId", approverUserIds)
      .eq("companyId", input.companyId);
    if (validUsers.error)
      return { data: null, error: validUsers.error, warnings };
    const validUserIds = new Set((validUsers.data ?? []).map((u) => u.userId));
    if (approverUserIds.some((id) => !validUserIds.has(id))) {
      return {
        data: null,
        error: {
          message: "One or more approvers do not belong to this company"
        } as import("@supabase/supabase-js").PostgrestError,
        warnings
      };
    }
  }

  // Persist the picked GROUP ids in the repurposed approvalRequirements column,
  // falling back to any explicitly-passed value when no picker groups arrived.
  const approvalRequirements =
    approverGroupIds.length > 0
      ? approverGroupIds
      : (data.approvalRequirements ?? []);

  const result = await client
    .from("changeOrder")
    .insert({
      changeOrderId,
      name: data.name,
      type: data.type,
      approvalType: data.approvalType,
      priority: data.priority ?? null,
      openDate: data.openDate,
      description: data.description ?? {},
      changeOrderWorkflowId: data.changeOrderWorkflowId ?? null,
      dueDate: data.dueDate ?? null,
      effectiveDate: data.effectiveDate ?? null,
      requiredActionIds: data.requiredActionIds ?? [],
      approvalRequirements,
      sourceType: data.sourceType ?? null,
      sourceId: data.sourceId ?? null,
      assignee: data.assignee ?? null,
      customFields: data.customFields,
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id, changeOrderId")
    .single();

  if (result.error || !result.data) {
    return { data: null, error: result.error, warnings };
  }

  const coId = result.data.id;

  if (items && items.length > 0) {
    // Attach via the shared path so the one-open-CO-per-item guard runs and
    // Engineering COs get a staged pending revision. A guard rejection skips
    // that item (surfaced as a warning) rather than aborting the whole create.
    for (const itemId of items) {
      const attached = await attachAffectedItem(client, {
        changeOrderId: coId,
        itemId,
        userId: input.createdBy,
        companyId: input.companyId,
        type: data.type
      });
      if (attached.error) {
        warnings.push(attached.error.message);
      }
    }
  }

  // Single-writer reviewer seeding (§4): resolve the picked approvers to a
  // deduped set of user ids — expand groups via users_for_groups, merge with the
  // picked individuals — and seed one Pending changeOrderReviewer per user. This
  // is the ONLY reviewer seeder (no edge function), so there is no double-seed
  // race.
  const fromGroups =
    approverGroupIds.length > 0
      ? await client.rpc("users_for_groups", { groups: approverGroupIds })
      : { data: [] as string[], error: null };

  if (fromGroups.error) {
    warnings.push("Failed to resolve approver groups");
  }

  const groupUserIds = Array.isArray(fromGroups.data)
    ? (fromGroups.data as string[])
    : [];

  const resolvedUserIds = [
    ...new Set([...approverUserIds, ...groupUserIds])
  ].filter(Boolean);

  if (resolvedUserIds.length > 0) {
    const users = await client
      .from("user")
      .select("id, fullName")
      .in("id", resolvedUserIds);

    if (users.error) {
      warnings.push("Failed to resolve approver names");
    }

    const fullNameById = new Map(
      (users.data ?? []).map((u) => [u.id, u.fullName])
    );

    const reviewerInsert = await client.from("changeOrderReviewer").insert(
      resolvedUserIds.map((assignee, index) => ({
        changeOrderId: coId,
        title: fullNameById.get(assignee) ?? "Reviewer",
        assignee,
        status: "Pending" as const,
        sortOrder: index + 1,
        companyId: input.companyId,
        createdBy: input.createdBy
      }))
    );

    if (reviewerInsert.error) {
      warnings.push("Failed to seed reviewers");
    }
  }

  // Single-writer action-task seeding (§4): one changeOrderActionTask per
  // requiredActionId, folded app-side (the reference used the create edge
  // function, whose own comments documented a double-seed bug from the split).
  const requiredActionIds = data.requiredActionIds ?? [];
  if (requiredActionIds.length > 0) {
    const actionInsert = await client.from("changeOrderActionTask").insert(
      requiredActionIds.map((actionId, index) => ({
        changeOrderId: coId,
        name: actionId,
        status: "Pending" as const,
        sortOrder: index + 1,
        companyId: input.companyId,
        createdBy: input.createdBy
      }))
    );
    if (actionInsert.error) {
      warnings.push("Failed to seed action tasks");
    }
  }

  return {
    data: { id: coId, changeOrderId: result.data.changeOrderId },
    error: null,
    warnings
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
    approvalType?: (typeof changeOrderApprovalType)[number];
    priority?: (typeof nonConformancePriority)[number] | null;
    openDate?: string;
    description?: Json;
    changeOrderWorkflowId?: string | null;
    dueDate?: string | null;
    effectiveDate?: string | null;
    requiredActionIds?: string[];
    approvalRequirements?: string[];
    sourceType?: string | null;
    sourceId?: string | null;
    assignee?: string | null;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
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
  changeOrderId: string
) {
  return client.from("changeOrder").delete().eq("id", changeOrderId);
}

// updateChangeOrderStatus — the single guarded status writer, implemented as a
// compare-and-swap (§2). The caller states the status it observed (fromStatus);
// the DAG (isAllowedChangeOrderTransition) rejects illegal moves, a
// Draft → In Review submit is blocked unless at least one reviewer exists, and
// the UPDATE lands ONLY while the row is still fromStatus. 0 rows updated ⇒ a
// stale read / concurrent transition ⇒ a typed error. Release (Approved →
// Released) is intentionally NOT in the DAG — it goes through releaseChangeOrder
// so the revision-promotion + make-method flip can never be bypassed here.
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

  if (toStatus === "In Review") {
    const reviewers = await client
      .from("changeOrderReviewer")
      .select("id", { count: "exact", head: true })
      .eq("changeOrderId", id)
      .eq("companyId", companyId);
    if (reviewers.error) {
      return { data: null, error: reviewers.error };
    }
    if ((reviewers.count ?? 0) === 0) {
      return {
        data: null,
        error: {
          message:
            "At least one reviewer is required before submitting for review."
        }
      };
    }

    // A CO with zero affected items has nothing to review or release. Guard the
    // Draft → In Review submit only — the Approved → In Review downgrade (a
    // reopened reviewer decision) must never be blocked by this.
    if (fromStatus === "Draft") {
      const affectedItems = await client
        .from("changeOrderItem")
        .select("id", { count: "exact", head: true })
        .eq("changeOrderId", id)
        .eq("companyId", companyId);
      if (affectedItems.error) {
        return { data: null, error: affectedItems.error };
      }
      if ((affectedItems.count ?? 0) === 0) {
        return {
          data: null,
          error: {
            message:
              "At least one affected item is required before submitting for review."
          }
        };
      }
    }
  }

  // Build the update explicitly rather than sanitize({...rest}): sanitize
  // coerces every `undefined` field to null, which would wipe an existing
  // assignee/effectiveDate on any transition where the caller passes those as
  // undefined (e.g. the status route sends assignee: undefined on submit). Only
  // set an optional field when the caller actually provided a value (including
  // an explicit null, e.g. Cancelled clears the assignee).
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

// applyChangeOrderReviewerDecision — records the caller's reviewer decision and
// applies the peer-review threshold. The CO must be In Review and the caller
// must own a reviewer row.
//   - Reject: reset every reviewer to Pending, store {reason} on the caller's
//     row, send the CO back to Draft.
//   - Approve: mark the caller's row Completed (+ reason), then re-evaluate; if
//     the threshold is met the CO auto-advances to Approved, else it stays In
//     Review awaiting the remaining sign-offs.
export async function applyChangeOrderReviewerDecision(
  client: SupabaseClient<Database>,
  args: {
    changeOrderId: string;
    userId: string;
    companyId: string;
    decision: "approve" | "reject";
    reason: string;
  }
): Promise<{
  data: {
    status: (typeof changeOrderStatus)[number];
    autoAdvanced: boolean;
  } | null;
  error: { message: string } | null;
}> {
  const { changeOrderId, userId, companyId, decision, reason } = args;

  const co = await getChangeOrder(client, changeOrderId, companyId);
  if (co.error || !co.data) {
    return {
      data: null,
      error: co.error ?? { message: "Change order not found" }
    };
  }
  if (co.data.status !== "In Review") {
    return { data: null, error: { message: "Change order is not in review" } };
  }

  const reviewers = await client
    .from("changeOrderReviewer")
    .select("id, assignee, status")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId);
  if (reviewers.error) {
    return { data: null, error: reviewers.error };
  }

  const mine = (reviewers.data ?? []).find((r) => r.assignee === userId);
  if (!mine) {
    return { data: null, error: { message: "You are not a reviewer" } };
  }

  const today = new Date().toISOString().split("T")[0];

  if (decision === "reject") {
    // Flip the status FIRST (compare-and-swap In Review → Draft). If the CAS
    // loses to a concurrent transition it returns an error and we bail BEFORE
    // touching any reviewer rows — otherwise a lost CAS would leave every
    // reviewer wiped to Pending while the status stayed Approved/whatever.
    const status = await updateChangeOrderStatus(client, {
      id: changeOrderId,
      companyId,
      fromStatus: "In Review",
      toStatus: "Draft",
      updatedBy: userId
    });
    if (status.error) return { data: null, error: status.error };

    // Now that the CO is safely back in Draft, reset every reviewer to Pending
    // so a fresh review starts after the author addresses the rejection; clear
    // stale notes so a prior round's decision doesn't surface next round (the
    // rejecter's own note is re-stamped immediately below).
    const reset = await client
      .from("changeOrderReviewer")
      .update({
        status: "Pending",
        completedDate: null,
        notes: {},
        updatedBy: userId
      })
      .eq("changeOrderId", changeOrderId)
      .eq("companyId", companyId);
    if (reset.error) return { data: null, error: reset.error };

    const note = await client
      .from("changeOrderReviewer")
      .update({ notes: { reason, decision: "reject" }, updatedBy: userId })
      .eq("id", mine.id)
      .eq("companyId", companyId);
    if (note.error) return { data: null, error: note.error };

    return { data: { status: "Draft", autoAdvanced: false }, error: null };
  }

  const record = await client
    .from("changeOrderReviewer")
    .update({
      status: "Completed",
      completedDate: today,
      notes: { reason, decision: "approve" },
      updatedBy: userId
    })
    .eq("id", mine.id)
    .eq("companyId", companyId);
  if (record.error) return { data: null, error: record.error };

  return reevaluateChangeOrderApproval(
    client,
    changeOrderId,
    userId,
    companyId
  );
}

// reevaluateChangeOrderApproval — the single source of truth for auto-advancing
// a CO from In Review → Approved. Called from BOTH the reviewer-decision path
// and the generic reviewer-task-completion path, so any reviewer completion can
// auto-advance regardless of entry point. Always re-reads the live reviewer set
// (race-safe against concurrent approvals) and lets the CAS in
// updateChangeOrderStatus guarantee the In Review → Approved flip lands once.
export async function reevaluateChangeOrderApproval(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  userId: string,
  companyId: string
): Promise<{
  data: {
    status: (typeof changeOrderStatus)[number];
    autoAdvanced: boolean;
  } | null;
  error: { message: string } | null;
}> {
  const co = await getChangeOrder(client, changeOrderId, companyId);
  if (co.error || !co.data) {
    return {
      data: null,
      error: co.error ?? { message: "Change order not found" }
    };
  }

  // Only In Review (may advance) and Approved (may be withdrawn back) are
  // sensitive to reviewer-set changes. Draft/Released/Cancelled never re-derive
  // their status from the threshold.
  if (co.data.status !== "In Review" && co.data.status !== "Approved") {
    return {
      data: {
        status: co.data.status as (typeof changeOrderStatus)[number],
        autoAdvanced: false
      },
      error: null
    };
  }

  const reviewers = await client
    .from("changeOrderReviewer")
    .select("status")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId);
  if (reviewers.error) {
    return { data: null, error: reviewers.error };
  }

  const met = evaluateApprovalThreshold(
    co.data.approvalType,
    (reviewers.data ?? []).map((r) => ({ status: r.status }))
  );

  // Already Approved: a reviewer reopening/withdrawing their sign-off can drop
  // the set below threshold. Downgrade Approved → In Review so the CO can never
  // sit Approved while its live reviewer set no longer meets the bar.
  if (co.data.status === "Approved") {
    if (met) {
      return { data: { status: "Approved", autoAdvanced: false }, error: null };
    }
    const status = await updateChangeOrderStatus(client, {
      id: changeOrderId,
      companyId,
      fromStatus: "Approved",
      toStatus: "In Review",
      updatedBy: userId
    });
    if (status.error && status.data === null) {
      const fresh = await getChangeOrder(client, changeOrderId, companyId);
      if (fresh.data?.status === "In Review") {
        return {
          data: { status: "In Review", autoAdvanced: false },
          error: null
        };
      }
      return { data: null, error: status.error };
    }
    return { data: { status: "In Review", autoAdvanced: false }, error: null };
  }

  if (met) {
    const status = await updateChangeOrderStatus(client, {
      id: changeOrderId,
      companyId,
      fromStatus: "In Review",
      toStatus: "Approved",
      updatedBy: userId
    });
    // A concurrent approval may have already flipped the row; the CAS then
    // updated 0 rows. That is not an error here — the CO is Approved either way.
    if (status.error && status.data === null) {
      const fresh = await getChangeOrder(client, changeOrderId, companyId);
      if (fresh.data?.status === "Approved") {
        return {
          data: { status: "Approved", autoAdvanced: false },
          error: null
        };
      }
      return { data: null, error: status.error };
    }
    return { data: { status: "Approved", autoAdvanced: true }, error: null };
  }

  return { data: { status: "In Review", autoAdvanced: false }, error: null };
}

// getChangeOrderNotificationRecipients — the set of user ids to notify on a
// transition: every reviewer plus every affected item's assignee, deduped,
// nulls skipped. Pure data; the trigger("notify") call lives in the server-only
// notifyChangeOrderTransition helper.
export async function getChangeOrderNotificationRecipients(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<string[]> {
  const [reviewers, items] = await Promise.all([
    client
      .from("changeOrderReviewer")
      .select("assignee")
      .eq("changeOrderId", changeOrderId)
      .eq("companyId", companyId),
    client
      .from("changeOrderItem")
      .select("...item!changeOrderItem_itemId_fkey(assignee)")
      .eq("changeOrderId", changeOrderId)
      .eq("companyId", companyId)
  ]);

  const ids = new Set<string>();
  for (const r of reviewers.data ?? []) {
    if (r.assignee) ids.add(r.assignee);
  }
  for (const it of (items.data ?? []) as Array<{ assignee: string | null }>) {
    if (it.assignee) ids.add(it.assignee);
  }
  return [...ids];
}

export async function updateChangeOrderTaskStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    status: (typeof changeOrderTaskStatus)[number];
    type: "action" | "approval" | "review";
    userId?: string;
    assignee?: string | null;
  }
) {
  const { id, companyId, status, type, userId, assignee } = args;
  const table =
    type === "action"
      ? "changeOrderActionTask"
      : type === "review"
        ? "changeOrderReviewer"
        : "changeOrderApprovalTask";

  const finalAssignee = assignee || userId;

  const updateData: {
    status: typeof status;
    updatedBy: string | undefined;
    assignee: string | null | undefined;
    completedDate?: string;
  } = {
    status,
    updatedBy: userId,
    assignee: finalAssignee
  };

  if (status === "Completed") {
    updateData.completedDate = new Date().toISOString().split("T")[0];
  }

  return client
    .from(table)
    .update(updateData)
    .eq("id", id)
    .eq("companyId", companyId)
    .select("changeOrderId")
    .single();
}

export async function updateChangeOrderTaskContent(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    type: "action" | "approval" | "review";
    content: JSONContent;
  }
) {
  const { id, companyId, content, type } = args;
  const table =
    type === "action"
      ? "changeOrderActionTask"
      : type === "review"
        ? "changeOrderReviewer"
        : "changeOrderApprovalTask";

  return client
    .from(table)
    .update({ notes: content })
    .eq("id", id)
    .eq("companyId", companyId)
    .select("changeOrderId")
    .single();
}

export async function upsertChangeOrderWorkflow(
  client: SupabaseClient<Database>,
  // The changeOrderWorkflow table stores the template payload (priority,
  // approvalType, approvers) inside the `content` JSON column — no dedicated
  // columns. Routes serialize the validated form fields into `content` before
  // calling this, so the upsert accepts the real columns (name + content).
  changeOrderWorkflow:
    | {
        name: string;
        content: Json;
        companyId: string;
        createdBy: string;
      }
    | {
        id: string;
        name: string;
        content: Json;
        updatedBy: string;
      }
) {
  if ("createdBy" in changeOrderWorkflow) {
    return client
      .from("changeOrderWorkflow")
      .insert([changeOrderWorkflow])
      .select("id")
      .single();
  }
  return client
    .from("changeOrderWorkflow")
    .update(sanitize(changeOrderWorkflow))
    .eq("id", changeOrderWorkflow.id);
}

export async function deleteChangeOrderWorkflow(
  client: SupabaseClient<Database>,
  changeOrderWorkflowId: string
) {
  return client
    .from("changeOrderWorkflow")
    .update({ active: false })
    .eq("id", changeOrderWorkflowId);
}

export async function addChangeOrderItem(
  client: SupabaseClient<Database>,
  input: {
    changeOrderId: string;
    itemId: string;
    disposition?: (typeof changeOrderDisposition)[number];
    dispositionNotes?: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client
    .from("changeOrderItem")
    .insert({
      changeOrderId: input.changeOrderId,
      itemId: input.itemId,
      disposition: input.disposition ?? "No Change",
      dispositionNotes: input.dispositionNotes ?? null,
      companyId: input.companyId,
      createdBy: input.createdBy
    })
    .select("id")
    .single();
}

export async function deleteChangeOrderItem(
  client: SupabaseClient<Database>,
  changeOrderItemId: string
) {
  return client.from("changeOrderItem").delete().eq("id", changeOrderItemId);
}

// removeAffectedItem — the single path for removing an affected item from a
// change order. Loads the row (company-scoped) with its parent CO status +
// staged pending revision, enforces the draft-only edit window, deletes the
// orphaned pending revision (cascades its makeMethod / materials), then removes
// the association.
export async function removeAffectedItem(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string }
): Promise<{ error: { message: string } | null }> {
  const row = await client
    .from("changeOrderItem")
    .select("id, pendingItemId, changeOrder:changeOrderId(status)")
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .single();
  if (row.error || !row.data) {
    return { error: { message: "Affected item not found" } };
  }

  if (!canEditChangeOrderItems(row.data.changeOrder?.status)) {
    return {
      error: {
        message:
          "Affected items can only be removed while the change order is a draft."
      }
    };
  }

  if (row.data.pendingItemId) {
    await client
      .from("item")
      .delete()
      .eq("id", row.data.pendingItemId)
      .eq("companyId", args.companyId);
  }

  const deletion = await deleteChangeOrderItem(client, args.id);
  if (deletion.error) {
    console.error(deletion.error);
    return { error: { message: "Failed to delete affected item" } };
  }

  return { error: null };
}

// attachAffectedItem — the single path for associating an item with a change
// order. (a) enforces the at-most-one-open-CO-per-item invariant via
// getOpenChangeOrderForItem, (b) inserts the changeOrderItem row, and (c) for
// Engineering COs stages a pending revision so the redline / release path has
// somewhere to record the change. Shared by the create flow (insertChangeOrder),
// the incremental add flow, and the Onshape import, so none can bypass the guard
// or skip the pending revision.
export async function attachAffectedItem(
  client: SupabaseClient<Database>,
  args: {
    changeOrderId: string;
    itemId: string;
    userId: string;
    companyId: string;
    type: (typeof changeOrderType)[number];
  }
): Promise<{
  data: { id: string } | null;
  error: { message: string } | null;
}> {
  const { changeOrderId, itemId, userId, companyId, type } = args;

  // (a) Concurrency guard: an item may be on at most one open change order.
  const openCo = await getOpenChangeOrderForItem(client, {
    itemId,
    companyId,
    excludeChangeOrderId: changeOrderId
  });
  if (openCo.error) {
    return { data: null, error: openCo.error };
  }
  if (openCo.data) {
    return {
      data: null,
      error: {
        message: `This item is already on open change order ${openCo.data.changeOrderId}.`
      }
    };
  }

  // (b) Insert the association row.
  const insert = await addChangeOrderItem(client, {
    changeOrderId,
    itemId,
    companyId,
    createdBy: userId
  });
  if (insert.error || !insert.data) {
    return {
      data: null,
      error: insert.error ?? { message: "Failed to add affected item" }
    };
  }

  // (c) Engineering COs stage a pending revision per affected item.
  if (type === "Engineering") {
    const revision = await createPendingRevision(client, {
      changeOrderId,
      changeOrderItemId: insert.data.id,
      itemId,
      userId,
      companyId
    });
    if (revision.error) {
      // Roll back the association row we just inserted — otherwise it persists
      // with pendingItemId=null AND occupies the (changeOrderId, itemId) unique
      // slot, so a clean retry is impossible. Best-effort.
      await deleteChangeOrderItem(client, insert.data.id);
      return { data: null, error: revision.error };
    }
  }

  return { data: { id: insert.data.id }, error: null };
}

// A change order is "open" until it is Released or Cancelled. An item may be on
// at most one open change order at a time, so two in-flight change orders can't
// race the same item.
const OPEN_CHANGE_ORDER_STATUSES = ["Draft", "In Review", "Approved"] as const;

export async function getOpenChangeOrderForItem(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string; excludeChangeOrderId?: string }
): Promise<{
  data: { id: string; changeOrderId: string; status: string } | null;
  error: { message: string } | null;
}> {
  const rows = await client
    .from("changeOrderItem")
    .select(
      "changeOrderId, changeOrder:changeOrderId(id, changeOrderId, status)"
    )
    .eq("itemId", args.itemId)
    .eq("companyId", args.companyId);

  if (rows.error) {
    return { data: null, error: rows.error };
  }

  const conflict = (rows.data ?? []).find((row) => {
    const co = row.changeOrder as {
      id: string;
      changeOrderId: string;
      status: string;
    } | null;
    return (
      row.changeOrderId !== args.excludeChangeOrderId &&
      co != null &&
      (OPEN_CHANGE_ORDER_STATUSES as readonly string[]).includes(co.status)
    );
  });

  const conflictCo = conflict?.changeOrder as
    | { id: string; changeOrderId: string; status: string }
    | null
    | undefined;

  return {
    data: conflictCo
      ? {
          id: conflictCo.id,
          changeOrderId: conflictCo.changeOrderId,
          status: conflictCo.status
        }
      : null,
    error: null
  };
}

// getNextRevision — numeric → +1, A → …→ Z → AA, AA → AB, etc.
export function getNextRevision(maxRevision: string): string {
  if (/^\d+$/.test(maxRevision)) {
    return (parseInt(maxRevision) + 1).toString();
  } else if (/^[A-Z]{1,2}$/.test(maxRevision)) {
    if (maxRevision.length === 1) {
      return maxRevision === "Z"
        ? "AA"
        : String.fromCharCode(maxRevision.charCodeAt(0) + 1);
    }
    const firstChar = maxRevision[0];
    const secondChar = maxRevision[1];
    if (secondChar === "Z") {
      return String.fromCharCode(firstChar.charCodeAt(0) + 1) + "A";
    }
    return firstChar + String.fromCharCode(secondChar.charCodeAt(0) + 1);
  }
  return maxRevision;
}

export async function createPendingRevision(
  client: SupabaseClient<Database>,
  args: {
    changeOrderId: string;
    changeOrderItemId: string;
    itemId: string;
    userId: string;
    companyId: string;
  }
): Promise<{
  data: { id: string; revision: string } | null;
  error: { message: string } | null;
}> {
  const { changeOrderItemId, itemId, userId } = args;

  const item = await getItem(client, itemId);
  if (item.error || !item.data) {
    return {
      data: null,
      error: item.error ?? { message: "Item not found" }
    };
  }

  // Compute the next revision against ALL existing revisions of this item so the
  // pending revision never collides with one that already exists (the item
  // unique key is (readableId, revision, companyId, type)).
  const existingRevisions = await client
    .from("item")
    .select("revision")
    .eq("readableId", item.data.readableId)
    .eq("companyId", args.companyId)
    .eq("type", item.data.type);
  const taken = new Set(
    (existingRevisions.data ?? []).map((r) => r.revision ?? "0")
  );
  let revision = getNextRevision(item.data.revision ?? "0");
  let guard = 0;
  while (taken.has(revision) && guard++ < 100) {
    revision = getNextRevision(revision);
  }

  const newItem = await createRevision(client, {
    item: item.data,
    revision,
    createdBy: userId
  });

  if (newItem.error || !newItem.data) {
    return {
      data: null,
      error: newItem.error ?? { message: "Failed to create revision" }
    };
  }

  const newItemId = newItem.data.id;

  // createRevision() already deep-copies the full method tree for non-Buy items
  // via the get-method edge function. Do NOT issue a second copyItem() here.

  const link = await client
    .from("changeOrderItem")
    .update({ pendingItemId: newItemId, updatedBy: userId })
    .eq("id", changeOrderItemId);

  if (link.error) {
    // Roll back the orphaned revision item (cascades its makeMethod/materials).
    await client.from("item").delete().eq("id", newItemId);
    return { data: null, error: link.error };
  }

  return { data: { id: newItemId, revision }, error: null };
}

export async function deleteConfigurationParameter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("configurationParameter").delete().eq("id", id);
}

export async function deleteConfigurationRule(
  client: SupabaseClient<Database>,
  field: string,
  itemId: string
) {
  return client
    .from("configurationRule")
    .delete()
    .eq("field", field)
    .eq("itemId", itemId);
}

export async function deleteItemCustomerPart(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("customerPartToItem")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function deleteConfigurationParameterGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  // Get any parameters that belong to this group
  const { data: parameters } = await client
    .from("configurationParameter")
    .select("id")
    .eq("configurationParameterGroupId", id);

  if (parameters && parameters.length > 0) {
    // Get the ungrouped group
    const { data: ungrouped } = await client
      .from("configurationParameterGroup")
      .select("id")
      .eq("isUngrouped", true)
      .single();

    if (ungrouped) {
      // Update all parameters to use the ungrouped group
      await client
        .from("configurationParameter")
        .update({ configurationParameterGroupId: ungrouped.id })
        .eq("configurationParameterGroupId", id);
    }
  }
  return client.from("configurationParameterGroup").delete().eq("id", id);
}

export async function deleteItem(client: SupabaseClient<Database>, id: string) {
  return client.from("item").delete().eq("id", id);
}

export async function deleteItemPostingGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("itemPostingGroup").delete().eq("id", id);
}

export async function deleteMaterialDimension(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialDimension").delete().eq("id", id);
}

export async function deleteMaterialFinish(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialFinish").delete().eq("id", id);
}

export async function deleteMaterialForm(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialForm").delete().eq("id", id);
}

export async function deleteMaterialGrade(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialGrade").delete().eq("id", id);
}

export async function deleteMaterialSubstance(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialSubstance").delete().eq("id", id);
}

export async function deleteMethodMaterial(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodMaterial").delete().eq("id", id);
}

export async function assertMethodOperationIsDraft(
  client: SupabaseClient<Database>,
  operationId: string
) {
  const result = await client
    .from("methodOperation")
    .select("makeMethodId, makeMethod!inner(status)")
    .eq("id", operationId)
    .single();

  if (result.error || !result.data) {
    throw new Error("Failed to find method operation");
  }

  const status = (result.data.makeMethod as { status: string }).status;
  if (status !== "Draft") {
    throw new Error(
      `Cannot modify steps on a method version with status "${status}". Only Draft versions can be modified.`
    );
  }
}

export async function deleteMethodOperation(
  client: SupabaseClient<Database>,
  methodOperationId: string
) {
  return client.from("methodOperation").delete().eq("id", methodOperationId);
}

export async function deleteMethodOperationStep(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodOperationStep").delete().eq("id", id);
}

export async function deleteMethodOperationParameter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodOperationParameter").delete().eq("id", id);
}

export async function deleteMethodOperationTool(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodOperationTool").delete().eq("id", id);
}

export async function deleteUnitOfMeasure(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("unitOfMeasure").delete().eq("id", id);
}

export async function getConfigurationParameters(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [parameters, groups] = await Promise.all([
    client
      .from("configurationParameter")
      .select("*")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("configurationParameterGroup")
      .select("*")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
  ]);

  if (parameters.error) {
    console.error(parameters.error);
    return { groups: [], parameters: [] };
  }

  if (groups.error) {
    console.error(groups.error);
    return { groups: [], parameters: [] };
  }

  return { groups: groups.data ?? [], parameters: parameters.data ?? [] };
}

export async function getConfigurationRules(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const result = await client
    .from("configurationRule")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
  if (result.error) {
    console.error(result.error);
    return [];
  }
  return result.data ?? [];
}

export async function getConsumable(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .rpc("get_consumable_details", {
      item_id: itemId
    })
    .single();
}

export async function getConsumables(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("consumables")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%,mpn.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getConsumablesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    readableIdWithRevision: string;
  }>(client, "item", "id, name, readableIdWithRevision", (query) =>
    query
      .eq("type", "Consumable")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name")
  );
}
export type ControlledDrawing = {
  drawingPath: string;
  drawingRevisionLabel: string | null;
  drawingSource: "onshape" | "manual";
};

function parseControlledDrawing(
  metadata: Json | null
): ControlledDrawing | null {
  const drawingMetadata = metadata as {
    drawingPath?: string | null;
    drawingRevisionLabel?: string | null;
    drawingSource?: string | null;
  } | null;
  if (!drawingMetadata?.drawingPath) return null;
  return {
    drawingPath: drawingMetadata.drawingPath,
    drawingRevisionLabel: drawingMetadata.drawingRevisionLabel ?? null,
    drawingSource:
      drawingMetadata.drawingSource === "onshape" ? "onshape" : "manual"
  };
}

export async function getControlledDrawing(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string }
): Promise<ControlledDrawing | null> {
  const drawings = await getControlledDrawings(client, {
    itemIds: [args.itemId],
    companyId: args.companyId
  });
  return drawings.get(args.itemId) ?? null;
}

// The one home of the controlled-drawing query (entityType="item",
// integration="drawing"). The table's unique constraint on
// (entityType, entityId, integration, companyId) guarantees at most one row
// per item. A query error degrades to "no drawing" (the drawing is advisory
// on every surface), never a thrown 500.
export async function getControlledDrawings(
  client: SupabaseClient<Database>,
  args: { itemIds: string[]; companyId: string }
): Promise<Map<string, ControlledDrawing>> {
  const drawingsByItemId = new Map<string, ControlledDrawing>();
  if (args.itemIds.length === 0) return drawingsByItemId;

  const mappings = await client
    .from("externalIntegrationMapping")
    .select("entityId, metadata")
    .eq("entityType", "item")
    .eq("integration", "drawing")
    .in("entityId", args.itemIds)
    .eq("companyId", args.companyId);

  if (mappings.error) {
    console.error("getControlledDrawings failed", mappings.error);
    return drawingsByItemId;
  }

  for (const mapping of mappings.data ?? []) {
    const drawing = parseControlledDrawing(mapping.metadata);
    if (drawing) {
      drawingsByItemId.set(mapping.entityId, drawing);
    }
  }

  return drawingsByItemId;
}

export async function getItem(client: SupabaseClient<Database>, id: string) {
  return client.from("item").select("*").eq("id", id).single();
}

export async function getItemCost(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemCost")
    .select("*, ...item(readableIdWithRevision)")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .single();
}

export async function getItemCostHistory(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const dateOneYearAgo = today(getLocalTimeZone())
    .subtract({ years: 1 })
    .toString();

  return client
    .from("costLedger")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .gte("postingDate", dateOneYearAgo)
    .order("postingDate", { ascending: false });
}

export async function getItemCustomerPart(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("customerPartToItem")
    .select("*, customer(id, name)")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getItemCustomerParts(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("customerPartToItem")
    .select("*, customer(id, name)")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
}

export async function getItemDemand(
  client: SupabaseClient<Database>,
  {
    itemId,
    locationId,
    periods,
    companyId
  }: {
    itemId: string;
    locationId: string;
    periods: string[];
    companyId: string;
  }
) {
  const [actuals, forecasts] = await Promise.all([
    client
      .from("demandActual")
      .select("*")
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId)
      .in("periodId", periods),
    client
      .from("demandForecast")
      .select("*")
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId)
      .in("periodId", periods)
      .order("periodId")
  ]);

  return {
    actuals: actuals.data ?? [],
    forecasts: forecasts.data ?? []
  };
}

export type DemandForecastSourceRow = {
  itemId: string;
  locationId: string | null;
  periodId: string;
  sourceType: "Job Material" | "Sales Order" | "Demand Projection";
  quantity: number;
  jobId: string | null;
  salesOrderLineId: string | null;
  demandProjectionId: string | null;
  parentItemId: string;
  parentItem: { id: string; readableId: string; name: string } | null;
  redirectedFromItemId: string | null;
  redirectedFromItem: {
    id: string;
    readableIdWithRevision: string;
  } | null;
  job: {
    id: string;
    jobId: string;
    dueDate: string | null;
    status: string | null;
  } | null;
  salesOrderLine: {
    id: string;
    salesOrderId: string;
    promisedDate: string | null;
    salesOrder: { id: string; salesOrderId: string } | null;
  } | null;
  demandProjection: {
    id: string;
    forecastQuantity: number;
    forecastMethod: string | null;
    confidence: number | null;
    notes: string | null;
    createdBy: string;
    createdAt: string;
    period: { startDate: string } | null;
  } | null;
};

export async function getDemandForecastSources(
  client: SupabaseClient<Database>,
  {
    itemId,
    locationId,
    periods,
    companyId
  }: {
    itemId: string;
    locationId: string;
    periods: string[];
    companyId: string;
  }
) {
  const result = await client
    .from("demandForecastSource")
    .select(
      `
        itemId,
        locationId,
        periodId,
        sourceType,
        quantity,
        jobId,
        salesOrderLineId,
        demandProjectionId,
        parentItemId,
        parentItem:item!demandForecastSource_parentItemId_fkey(id, readableId, name),
        redirectedFromItemId,
        redirectedFromItem:item!demandForecastSource_redirectedFromItemId_fkey(id, readableIdWithRevision),
        job:job!demandForecastSource_jobId_fkey(id, jobId, dueDate, status),
        salesOrderLine:salesOrderLine!demandForecastSource_salesOrderLineId_fkey(
          id,
          salesOrderId,
          promisedDate,
          salesOrder:salesOrder(id, salesOrderId)
        ),
        demandProjection:demandProjection!demandForecastSource_demandProjectionId_fkey(
          id,
          forecastQuantity,
          forecastMethod,
          confidence,
          notes,
          period(startDate),
          createdBy,
          createdAt
        )
      `
    )
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId)
    .in("periodId", periods);

  return {
    data: result.data ?? [],
    error: result.error
  };
}

export async function getItemFiles(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const result = await client.storage
    .from("private")
    .list(`${companyId}/parts/${itemId}`);
  return result.data || [];
}

export async function getItemPostingGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("itemPostingGroup").select("*").eq("id", id).single();
}

export async function getItemPostingGroups(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("itemPostingGroup")
    .select("*", {
      count: "exact"
    })
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

export async function getItemPostingGroupsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("itemPostingGroup")
    .select("id, name", { count: "exact" })
    .eq("companyId", companyId)
    .order("name");
}

export async function getItemManufacturing(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("itemReplenishment")
    .select("*")
    .eq("itemId", id)
    .eq("companyId", companyId)
    .single();
}

export async function getItemPlanning(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client
    .from("itemPlanning")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .maybeSingle();
}

export async function getItemQuantities(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client
    .rpc("get_inventory_quantities", {
      location_id: locationId,
      company_id: companyId
    })
    .eq("id", itemId)
    .maybeSingle();
}

export async function getItemReplenishment(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemReplenishment")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .single();
}

export async function getItemSupersession(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  // itemSupersession has two FKs to item, so embeds must hint the FK.
  return client
    .from("itemSupersession")
    .select(
      "*, successor:item!itemSupersession_successorItemId_fkey(id, readableIdWithRevision, name)"
    )
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .maybeSingle();
}

// Parts that point to this item as their successor (the "Supersedes" back-ref).
export async function getItemSupersededBy(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemSupersession")
    .select(
      "itemId, supersessionMode, successorEffectivityDate, predecessor:item!itemSupersession_itemId_fkey(id, readableIdWithRevision, name)"
    )
    .eq("successorItemId", itemId)
    .eq("companyId", companyId);
}

export async function getSupersessionChain(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  // Forward chain (this item -> successor -> ...), cycle-safe, capped depth.
  type ChainLink = {
    itemId: string;
    supersessionMode: Database["public"]["Enums"]["supersessionMode"];
    successorItemId: string | null;
    successorEffectivityDate: string | null;
    successor: {
      id: string;
      readableIdWithRevision: string | null;
      name: string;
    } | null;
  };
  const chain: ChainLink[] = [];
  const visited = new Set<string>();
  let currentId: string | null = itemId;
  while (currentId && !visited.has(currentId) && chain.length < 5) {
    visited.add(currentId);
    const link = await client
      .from("itemSupersession")
      .select(
        "itemId, supersessionMode, successorItemId, successorEffectivityDate, successor:item!itemSupersession_successorItemId_fkey(id, readableIdWithRevision, name)"
      )
      .eq("itemId", currentId)
      .eq("companyId", companyId)
      .maybeSingle();
    const data = link.data as ChainLink | null;
    if (!data) break;
    chain.push(data);
    currentId = data.successorItemId;
  }

  const supersededBy = await getItemSupersededBy(client, itemId, companyId);

  return { chain, supersededBy: supersededBy.data ?? [] };
}

export async function getItemStorageUnitQuantities(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client.rpc("get_item_quantities_by_tracking_id", {
    item_id: itemId,
    company_id: companyId,
    location_id: locationId
  });
}

export async function getItemSupply(
  client: SupabaseClient<Database>,
  {
    itemId,
    locationId,
    periods,
    companyId
  }: {
    itemId: string;
    locationId: string;
    periods: string[];
    companyId: string;
  }
) {
  const [actuals, forecasts] = await Promise.all([
    client
      .from("supplyActual")
      .select("*")
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId)
      .in("periodId", periods)
      .order("periodId"),
    client
      .from("supplyForecast")
      .select("*")
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId)
      .in("periodId", periods)
      .order("periodId")
  ]);

  return {
    actuals: actuals.data ?? [],
    forecasts: forecasts.data ?? []
  };
}

export async function getItemUnitSalePrice(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("itemUnitSalePrice")
    .select("*")
    .eq("itemId", id)
    .eq("companyId", companyId)
    .single();
}

export async function getJobMaterialUsageForItem(
  client: SupabaseClient<Database>,
  { itemId, companyId }: { itemId: string; companyId: string }
): Promise<{
  byMaterialId: Record<string, number>;
  byJobId: Record<string, number>;
}> {
  const [materials, jobs] = await Promise.all([
    client
      .from("jobMaterial")
      .select("id, estimatedQuantity")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("job")
      .select("id, quantity")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
  ]);

  const byMaterialId: Record<string, number> = {};
  for (const row of materials.data ?? []) {
    if (row.id) byMaterialId[row.id] = row.estimatedQuantity ?? 0;
  }

  const byJobId: Record<string, number> = {};
  for (const row of jobs.data ?? []) {
    if (row.id) byJobId[row.id] = row.quantity ?? 0;
  }

  return { byMaterialId, byJobId };
}

export async function getMaterialUsedIn(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [
    issues,
    jobMaterials,
    maintenanceDispatchItems,
    methodMaterials,
    purchaseOrderLines,
    receiptLines,
    quoteMaterials,
    salesOrderLines,
    shipmentLines,
    supplierQuotes,
    jobMaterialUsage
  ] = await Promise.all([
    client
      .from("nonConformanceItem")
      .select(
        "id, ...nonConformance(documentReadableId:nonConformanceId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("jobMaterial")
      .select("id, methodType, ...job(documentReadableId:jobId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("maintenanceDispatchItem")
      .select(
        "id, ...maintenanceDispatch!maintenanceDispatchId(documentReadableId:maintenanceDispatchId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("methodMaterial")
      .select(
        "id, methodType, ...makeMethod!makeMethodId(documentId:id, version, ...item(documentReadableId:readableIdWithRevision, documentParentId:id, itemType:type))"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("purchaseOrderLine")
      .select(
        "id, ...purchaseOrder(documentReadableId:purchaseOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("receiptLine")
      .select("id, ...receipt(documentReadableId:receiptId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("quoteMaterial")
      .select(
        "id, methodType, documentParentId:quoteId, documentId:quoteLineId, ...quoteLine(...item(documentReadableId:readableIdWithRevision))"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("salesOrderLine")
      .select(
        "id, methodType, ...salesOrder(documentReadableId:salesOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("shipmentLine")
      .select("id, ...shipment(documentReadableId:shipmentId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("supplierQuoteLine")
      .select(
        "id, ...supplierQuote(documentReadableId:supplierQuoteId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100),
    getJobMaterialUsageForItem(client, { itemId, companyId })
  ]);

  return {
    issues: issues.data ?? [],
    jobMaterials: jobMaterials.data ?? [],
    maintenanceDispatchItems: maintenanceDispatchItems.data ?? [],
    methodMaterials: methodMaterials.data ?? [],
    purchaseOrderLines: purchaseOrderLines.data ?? [],
    receiptLines: receiptLines.data ?? [],
    quoteMaterials: quoteMaterials.data ?? [],
    salesOrderLines: salesOrderLines.data ?? [],
    shipmentLines: shipmentLines.data ?? [],
    supplierQuotes: supplierQuotes.data ?? [],
    jobMaterialUsage
  };
}

export async function getMakeMethods(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("makeMethod")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
}

export async function getMakeMethodById(
  client: SupabaseClient<Database>,
  makeMethodId: string,
  companyId: string
) {
  return client
    .from("makeMethod")
    .select("*")
    .eq("id", makeMethodId)
    .eq("companyId", companyId)
    .single();
}

export async function getMaterial(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .rpc("get_material_details", {
      item_id: itemId
    })
    .single();
}

export async function getMaterials(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("materials")
    .select("*", {
      count: "exact"
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args.search) {
    query = query.or(
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%,mpn.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getMaterialsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    readableIdWithRevision: string;
  }>(client, "item", "id, name, readableIdWithRevision", (query) =>
    query
      .eq("type", "Material")
      .or(`companyId.eq.${companyId},companyId.is.null`)
      .eq("active", true)
      .order("name")
  );
}

export async function getMaterialDimension(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialDimension").select("*").eq("id", id).single();
}

export async function getMaterialDimensions(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null; isMetric: boolean }
) {
  let query = client
    .from("materialDimensions")
    .select("*", {
      count: "exact"
    })
    .eq("isMetric", args?.isMetric ?? false)
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "formName", ascending: true },
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialDimensionList(
  client: SupabaseClient<Database>,
  materialFormId: string,
  isMetric: boolean,
  companyId: string
) {
  return client
    .from("materialDimension")
    .select("*")
    .eq("materialFormId", materialFormId)
    .eq("isMetric", isMetric)
    .or(`companyId.eq.${companyId},companyId.is.null`);
}

export async function getMaterialFinish(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialFinish").select("*").eq("id", id).single();
}

export async function getMaterialFinishes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialFinishes")
    .select("*", {
      count: "exact"
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "substanceName", ascending: true },
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialFinishList(
  client: SupabaseClient<Database>,
  materialSubstanceId: string,
  companyId: string
) {
  return client
    .from("materialFinish")
    .select("*")
    .eq("materialSubstanceId", materialSubstanceId)
    .or(`companyId.eq.${companyId},companyId.is.null`);
}

export async function getMaterialForm(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialForm").select("*").eq("id", id).single();
}

export async function getMaterialForms(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialForm")
    .select("*", {
      count: "exact"
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

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

export async function getMaterialFormsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("materialForm")
    .select("id, name, code, companyId")
    .or(`companyId.eq.${companyId},companyId.is.null`)
    .order("name");
}

export async function getMaterialGrades(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialGrades")
    .select("*", {
      count: "exact"
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "substanceName", ascending: true },
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialGrade(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialGrade").select("*").eq("id", id).single();
}

export async function getMaterialGradeList(
  client: SupabaseClient<Database>,
  materialSubstanceId: string,
  companyId: string
) {
  return client
    .from("materialGrade")
    .select("*")
    .eq("materialSubstanceId", materialSubstanceId)
    .or(`companyId.eq.${companyId},companyId.is.null`);
}

export async function getMaterialSubstance(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialSubstance").select("*").eq("id", id).single();
}

export async function getMaterialSubstances(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialSubstance")
    .select("*", {
      count: "exact"
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

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

export async function getMaterialSubstancesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("materialSubstance")
    .select("id, name, code, companyId")
    .or(`companyId.eq.${companyId},companyId.is.null`)
    .order("name");
}

export async function getMethodMaterial(
  client: SupabaseClient<Database>,
  materialId: string
) {
  return client
    .from("methodMaterial")
    .select("*, item(name)")
    .eq("id", materialId)
    .single();
}

export async function getMethodMaterials(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("methodMaterial")
    .select(
      "*, item(name, readableIdWithRevision), makeMethod!makeMethodId(item(id, type, name, readableIdWithRevision))",
      {
        count: "exact"
      }
    )
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("item.readableIdWithRevision", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, []);
  }

  return query;
}

export async function getMethodMaterialsByMakeMethod(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  return client
    .from("methodMaterial")
    .select(
      "*, item(name, itemTrackingType, replenishmentSystem, defaultMethodType, sourcingType)"
    )
    .eq("makeMethodId", makeMethodId)
    .order("order", { ascending: true });
}

export async function getMethodOperations(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("methodOperation")
    .select(
      "*, makeMethod!makeMethodId(item(id, type, name, readableIdWithRevision))",
      {
        count: "exact"
      }
    )
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("description", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "order", ascending: true }
    ]);
  }

  return query;
}

export async function getMethodOperationsByMakeMethodId(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  return client
    .from("methodOperation")
    .select(
      "*, methodOperationTool(*), methodOperationParameter(*), methodOperationStep(*)"
    )
    .eq("makeMethodId", makeMethodId)
    .order("order", { ascending: true });
}

type Method = NonNullable<
  Awaited<ReturnType<typeof getMethodTreeArray>>["data"]
>[number];
type MethodTreeItem = {
  id: string;
  data: Method;
  children: MethodTreeItem[];
};

export async function getMethodTree(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  const items = await getMethodTreeArray(client, makeMethodId);
  if (items.error) return items;

  const tree = getMethodTreeArrayToTree(items.data);

  return {
    data: tree,
    error: null
  };
}

export async function getMethodTreeArray(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  return client.rpc("get_method_tree", {
    uid: makeMethodId
  });
}

function getMethodTreeArrayToTree(items: Method[]): MethodTreeItem[] {
  function traverseAndRenameIds(node: MethodTreeItem) {
    const clone = structuredClone(node);
    clone.id = nanoid();
    clone.children = clone.children.map((n) => traverseAndRenameIds(n));
    return clone;
  }

  const rootItems: MethodTreeItem[] = [];
  const lookup: { [id: string]: MethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-ignore
      lookup[itemId] = { id: itemId, children: [] };
    }

    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-ignore
        lookup[parentId] = { id: parentId, children: [] };
      }

      // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
      lookup[parentId]["children"].push(treeItem);
    }
  }

  return rootItems.map((item) => traverseAndRenameIds(item));
}

export async function getOpenJobMaterials(
  client: SupabaseClient<Database>,
  {
    itemId,
    companyId,
    locationId
  }: { itemId: string; companyId: string; locationId: string }
) {
  return client
    .from("openJobMaterialLines")
    .select(
      "id, parentMaterialId, jobMakeMethodId, jobId, quantity:quantityToIssue, documentReadableId:jobReadableId, documentId:jobId, dueDate"
    )
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId);
}

export async function getOpenProductionOrders(
  client: SupabaseClient<Database>,
  {
    itemId,
    companyId,
    locationId
  }: { itemId: string; companyId: string; locationId: string }
) {
  return client
    .from("openProductionOrders")
    .select(
      "id, quantity:quantityToReceive, documentReadableId:jobId, documentId:id, dueDate"
    )
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId);
}

export async function getOpenPurchaseOrderLines(
  client: SupabaseClient<Database>,
  {
    itemId,
    companyId,
    locationId
  }: { itemId: string; companyId: string; locationId: string }
) {
  return client
    .from("openPurchaseOrderLines")
    .select(
      "id, quantity:quantityToReceive, dueDate:promisedDate, ...purchaseOrder(documentReadableId:purchaseOrderId, documentId:id)"
    )
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId);
}

export async function getOpenSalesOrderLines(
  client: SupabaseClient<Database>,
  {
    itemId,
    companyId,
    locationId
  }: { itemId: string; companyId: string; locationId: string }
) {
  return client
    .from("openSalesOrderLines")
    .select(
      "id, quantity:quantityToSend, dueDate:promisedDate, ...salesOrder(documentReadableId:salesOrderId, documentId:id)"
    )
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId);
}

export async function getPart(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .rpc("get_part_details", {
      item_id: itemId
    })
    .single();
}

export async function getParts(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("parts")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%,mpn.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

// Distinct manufacturer part numbers for the company, used to populate the MPN
// column filter in the item list tables. Deduping happens in the route loader.
export async function getItemMpnsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{ mpn: string }>(client, "item", "mpn", (query) =>
    query
      .eq("companyId", companyId)
      .not("mpn", "is", null)
      .neq("mpn", "")
      .order("mpn")
  );
}

export async function getPartsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    readableIdWithRevision: string;
  }>(client, "item", "id, name, readableIdWithRevision", (query) =>
    query
      .eq("type", "Part")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name")
  );
}

export async function getPartUsedIn(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [
    issues,
    jobMaterials,
    jobs,
    maintenanceDispatchItems,
    methodMaterials,
    purchaseOrderLines,
    receiptLines,
    quoteLines,
    quoteMaterials,
    salesOrderLines,
    shipmentLines,
    supplierQuotes,
    jobMaterialUsage
  ] = await Promise.all([
    client
      .from("nonConformanceItem")
      .select(
        "id, ...nonConformance(documentReadableId:nonConformanceId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("jobMaterial")
      .select("id, methodType, ...job(documentReadableId:jobId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("job")
      .select("id, documentReadableId:jobId")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("maintenanceDispatchItem")
      .select(
        "id, ...maintenanceDispatch!maintenanceDispatchId(documentReadableId:maintenanceDispatchId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("methodMaterial")
      .select(
        "id, methodType, ...makeMethod!makeMethodId(documentId:id, version, ...item(documentReadableId:readableIdWithRevision, documentParentId:id, itemType:type))"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("purchaseOrderLine")
      .select(
        "id, ...purchaseOrder(documentReadableId:purchaseOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("receiptLine")
      .select("id, ...receipt(documentReadableId:receiptId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("quoteLine")
      .select(
        "id, methodType, ...quote(documentReadableId:quoteId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100),

    client
      .from("quoteMaterial")
      .select(
        "id, methodType, documentParentId:quoteId, documentId:quoteLineId, ...quoteLine(...item(documentReadableId:readableIdWithRevision))"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("salesOrderLine")
      .select(
        "id, methodType, ...salesOrder(documentReadableId:salesOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("shipmentLine")
      .select("id, ...shipment(documentReadableId:shipmentId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("supplierQuoteLine")
      .select(
        "id, ...supplierQuote(documentReadableId:supplierQuoteId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100),
    getJobMaterialUsageForItem(client, { itemId, companyId })
  ]);

  return {
    issues: issues.data ?? [],
    jobMaterials: jobMaterials.data ?? [],
    jobs: jobs.data ?? [],
    maintenanceDispatchItems: maintenanceDispatchItems.data ?? [],
    methodMaterials: methodMaterials.data ?? [],
    purchaseOrderLines: purchaseOrderLines.data ?? [],
    receiptLines: receiptLines.data ?? [],
    quoteLines: quoteLines.data ?? [],
    quoteMaterials: quoteMaterials.data ?? [],
    salesOrderLines: salesOrderLines.data ?? [],
    shipmentLines: shipmentLines.data ?? [],
    supplierQuotes: supplierQuotes.data ?? [],
    jobMaterialUsage
  };
}

export async function getPickMethod(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client
    .from("pickMethod")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .maybeSingle();
}

export async function getPickMethods(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("pickMethod")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
}

export async function getServices(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    type: string | null;
    group: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("service")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%`
    );
  }

  if (args.type) {
    query = query.eq(
      "serviceType",
      args.type as NonNullable<"Internal" | "External">
    );
  }

  if (args.group) {
    query = query.eq("itemPostingGroupId", args.group);
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getService(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("service")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .single();
}

export async function getServicesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "item", "id, name", (query) =>
    query
      .eq("type", "Service")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name")
  );
}

export async function getSupplierParts(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("supplierPart")
    .select("*")
    .eq("active", true)
    .eq("itemId", id)
    .eq("companyId", companyId);
}

export async function getTool(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .rpc("get_tool_details", {
      item_id: itemId
    })
    .single();
}

export async function getTools(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("tools")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%,mpn.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getToolsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    readableIdWithRevision: string;
  }>(client, "item", "id, name, readableIdWithRevision", (query) =>
    query
      .eq("type", "Tool")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name")
  );
}

export async function getUnitOfMeasure(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("unitOfMeasure")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getUnitOfMeasures(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("unitOfMeasure")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(`name.ilike.%${args.search}%,code.ilike.%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getUnitOfMeasuresList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("unitOfMeasure")
    .select("name, code")
    .eq("companyId", companyId)
    .order("name");
}

export async function updateConfigurationParameterGroupOrder(
  client: SupabaseClient<Database>,
  data: z.infer<typeof configurationParameterGroupOrderValidator>
) {
  return client
    .from("configurationParameterGroup")
    .update(sanitize(data))
    .eq("id", data.id);
}

export async function updateDefaultRevision(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    updatedBy: string;
  }
) {
  const [item, makeMethod] = await Promise.all([
    client
      .from("item")
      .select("id,readableId, readableIdWithRevision, type, companyId")
      .eq("id", data.id)
      .single(),
    client
      .from("activeMakeMethods")
      .select("id, version")
      .eq("itemId", data.id)
      .maybeSingle()
  ]);
  if (item.error) return item;
  const { readableId, type, companyId } = item.data;
  if (!companyId) return item;
  const relatedItems = await client
    .from("item")
    .select("id")
    .eq("readableId", readableId)
    .eq("type", type)
    .eq("companyId", companyId);

  const itemIds = relatedItems.data?.map((item) => item.id) ?? [];

  return client
    .from("methodMaterial")
    .update({
      itemId: item.data.id,
      materialMakeMethodId: makeMethod.data?.id
    })
    .in("itemId", itemIds);
}

export async function updateConfigurationParameterOrder(
  client: SupabaseClient<Database>,
  data: Omit<
    z.infer<typeof configurationParameterOrderValidator>,
    "configurationParameterGroupId"
  > & {
    configurationParameterGroupId?: string | null;
    updatedBy: string;
  }
) {
  return client
    .from("configurationParameter")
    .update(sanitize(data))
    .eq("id", data.id);
}

export async function updateItemCost(
  client: SupabaseClient<Database>,
  itemId: string,
  cost: {
    unitCost: number;
    updatedBy: string;
  }
) {
  return client
    .from("itemCost")
    .update({
      ...cost,
      costIsAdjusted: true,
      updatedAt: today(getLocalTimeZone()).toString()
    })
    .eq("itemId", itemId)
    .single();
}

export async function updateMaterialOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    order: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, order, updatedBy }) =>
    client.from("methodMaterial").update({ order, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function updateOperationOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    order: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, order, updatedBy }) =>
    client.from("methodOperation").update({ order, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function updateRevision(
  client: SupabaseClient<Database>,
  revision: {
    id: string;
    revision: string;
    updatedBy: string;
  }
) {
  return client
    .from("item")
    .update({
      ...revision,
      updatedAt: today(getLocalTimeZone()).toString()
    })
    .eq("id", revision.id);
}

export async function upsertConfigurationParameter(
  client: SupabaseClient<Database>,
  configurationParameter: z.infer<typeof configurationParameterValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const { userId, ...data } = configurationParameter;
  if (configurationParameter.id) {
    return client
      .from("configurationParameter")
      .update(
        sanitize({
          ...data,
          updatedBy: userId,
          updatedAt: now(getLocalTimeZone()).toAbsoluteString()
        })
      )
      .eq("id", configurationParameter.id);
  }

  let ungroupedGroupId: string | null = null;
  const existingGroups = await client
    .from("configurationParameterGroup")
    .select("id, isUngrouped, sortOrder")
    .eq("itemId", data.itemId);

  const ungroupedGroup = existingGroups.data?.find(
    (group) => group.isUngrouped
  );

  if (ungroupedGroup) {
    ungroupedGroupId = ungroupedGroup.id;
  } else {
    const maxSortOrder =
      existingGroups.data?.reduce(
        (max, group) => Math.max(max, group.sortOrder ?? 1),
        1
      ) ?? 0;
    const ungroupedGroupInsert = await client
      .from("configurationParameterGroup")
      .insert({
        itemId: data.itemId,
        name: "Ungrouped",
        isUngrouped: true,
        sortOrder: maxSortOrder + 1,
        companyId: data.companyId
      })
      .select("id")
      .single();
    if (ungroupedGroupInsert.error) return ungroupedGroupInsert;
    ungroupedGroupId = ungroupedGroupInsert.data.id;
  }

  return client.from("configurationParameter").insert({
    ...data,
    key: data.key ?? "",
    createdBy: userId,
    configurationParameterGroupId: ungroupedGroupId
  });
}

export async function upsertConfigurationParameterGroup(
  client: SupabaseClient<Database>,
  configurationParameterGroup: z.infer<
    typeof configurationParameterGroupValidator
  > & {
    companyId: string;
    itemId: string;
  }
) {
  const { itemId, ...data } = configurationParameterGroup;
  if (configurationParameterGroup.id) {
    return client
      .from("configurationParameterGroup")
      .update({
        name: data.name
      })
      .eq("id", configurationParameterGroup.id);
  }

  const existingGroups = await client
    .from("configurationParameterGroup")
    .select("id, isUngrouped, sortOrder")
    .eq("itemId", itemId);

  const maxSortOrder =
    existingGroups.data?.reduce(
      (max, group) => Math.max(max, group.sortOrder ?? 1),
      1
    ) ?? 0;

  return client.from("configurationParameterGroup").insert({
    ...data,
    itemId,
    name: data.name,
    sortOrder: maxSortOrder + 1
  });
}

export async function upsertConfigurationRule(
  client: SupabaseClient<Database>,
  configurationRule: z.infer<typeof configurationRuleValidator> & {
    itemId: string;
    companyId: string;
    updatedBy: string;
  }
) {
  return client.from("configurationRule").upsert(configurationRule, {
    onConflict: "itemId,field"
  });
}

/**
 * Persist (or clear) the per-item shelf-life policy. Shelf life lives on the
 * "itemShelfLife" table, keyed by itemId. Absence of a row = not managed.
 *
 * Three-way mode handling so this helper can be called from any upsert path
 * safely, including forms that don't surface the shelf-life fields:
 *   - mode undefined         -> no-op. The caller's form didn't opine on
 *                               shelf life; leave whatever row exists alone.
 *   - mode 'NotManaged'      -> explicit opt-out. DELETE any existing row.
 *   - mode 'Fixed Duration' or
 *     'Calculated'           -> UPSERT, clearing fields that don't apply to
 *                               the selected mode so stale values never leak
 *                               between modes.
 *
 * Callers on an item INSERT path should pass companyId so the helper can
 * seed a fresh row without a round-trip; on an UPDATE path where we know
 * the row already exists, companyId is optional.
 */
/**
 * Persist the user's "default storage unit" pick from the item form as a
 * row in the "pickMethod" table. Items are company-wide in Carbon;
 * per-location stocking facts live on pickMethod keyed by
 * (itemId, locationId). Writing the form pick here (rather than as
 * columns on "item") respects that boundary and lets a single item
 * accumulate multiple location defaults over time.
 *
 * The locationId for the pickMethod row is derived from the chosen
 * storageUnit (every storageUnit belongs to exactly one location), so
 * the caller only needs to pass the storageUnitId. This keeps the item
 * form to a single "Default Storage Unit" field - the location is
 * implicit.
 *
 * Semantics:
 *   - storageUnitId undefined -> no-op. Forms that don't surface this
 *     field (e.g. the manufacturing sub-form) can share an action
 *     without accidentally creating or clobbering a pickMethod row.
 *   - storageUnitId set -> UPSERT on (itemId, storageUnit.locationId).
 *     Existing defaultStorageUnit for that location is overwritten with
 *     the new pick.
 */
export async function upsertItemDefaultPickMethod(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    userId: string;
    storageUnitId?: string;
  }
) {
  if (!args.storageUnitId) {
    return { data: null, error: null };
  }

  const storageUnit = await client
    .from("storageUnit")
    .select("locationId, companyId")
    .eq("id", args.storageUnitId)
    .single();
  if (storageUnit.error || !storageUnit.data) return storageUnit;

  return client.from("pickMethod").upsert(
    {
      itemId: args.itemId,
      locationId: storageUnit.data.locationId,
      defaultStorageUnitId: args.storageUnitId,
      companyId: storageUnit.data.companyId,
      createdBy: args.userId,
      updatedBy: args.userId,
      updatedAt: today(getLocalTimeZone()).toString()
    },
    { onConflict: "itemId,locationId" }
  );
}

/**
 * Return the distinct processIds referenced by methodOperation rows on the
 * item's active makeMethod. Used to scope the shelf-life trigger-process
 * picker to processes the recipe will actually run, so users can't pick a
 * process the trigger never matches against (the set-shelf-life helper short-circuits
 * on processId mismatch). Empty array when the item has no active recipe.
 */
export async function getRecipeProcessIdsForItem(
  client: SupabaseClient<Database>,
  itemId: string
) {
  const makeMethod = await client
    .from("activeMakeMethods")
    .select("id")
    .eq("itemId", itemId)
    .maybeSingle();
  if (makeMethod.error || !makeMethod.data?.id) {
    return { data: [] as string[], error: makeMethod.error ?? null };
  }
  const operations = await client
    .from("methodOperation")
    .select("processId")
    .eq("makeMethodId", makeMethod.data.id);
  if (operations.error) {
    return { data: [] as string[], error: operations.error };
  }
  const ids = Array.from(
    new Set(
      (operations.data ?? [])
        .map((o) => o.processId)
        .filter((id): id is string => !!id)
    )
  );
  return { data: ids, error: null };
}

/**
 * Fetch the shelf-life policy for an item. Returns `data: null` (without
 * an error) when the item has no row, since absence = "not managed" and
 * that's a valid state we don't want to treat as an error path.
 */
export async function getItemShelfLife(
  client: SupabaseClient<Database>,
  itemId: string
) {
  return client
    .from("itemShelfLife")
    .select("mode, days, triggerProcessId, triggerTiming, calculateFromBom")
    .eq("itemId", itemId)
    .maybeSingle();
}

/**
 * Returns true when the item's active make-method has at least one BOM
 * input with a managed shelf-life policy. Used to surface a warning when
 * the user picks a BOM-driven shelf-life mode (Calculated, or Fixed
 * Duration with calculateFromBom) but no input would actually contribute
 * an expiry date.
 *
 * Returns false when there is no make-method, no materials, or every
 * material has shelf-life NotManaged. Errors are coerced to false — this
 * is a UI hint, not a correctness gate.
 */
export async function getBomHasShelfLifeManagedInput(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<boolean> {
  const makeMethods = await getMakeMethods(client, itemId, companyId);
  if (makeMethods.error || !makeMethods.data?.length) return false;

  const active =
    makeMethods.data.find((m) => m.status === "Active") ?? makeMethods.data[0];

  const materials = await getMethodMaterialsByMakeMethod(client, active.id);
  const inputItemIds = (materials.data ?? [])
    .map((m) => m.itemId)
    .filter((id): id is string => !!id);
  if (inputItemIds.length === 0) return false;

  // Any row in itemShelfLife is by definition managed - the upsert path
  // deletes the row when mode = 'NotManaged' and the column enum has no
  // such value, so presence is sufficient.
  const managed = await client
    .from("itemShelfLife")
    .select("itemId")
    .in("itemId", inputItemIds)
    .limit(1);

  return !managed.error && (managed.data?.length ?? 0) > 0;
}

export async function upsertItemShelfLife(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    userId: string;
    companyId?: string;
    mode?: (typeof shelfLifeModes)[number];
    days?: number;
    triggerProcessId?: string;
    triggerTiming?: (typeof shelfLifeTriggerTimings)[number];
    calculateFromBom?: boolean;
  }
) {
  if (args.mode === undefined) {
    return { data: null, error: null };
  }

  if (args.mode === "NotManaged") {
    return client.from("itemShelfLife").delete().eq("itemId", args.itemId);
  }

  const days = args.mode === "Fixed Duration" ? (args.days ?? null) : null;
  const triggerProcessId =
    args.mode === "Fixed Duration" ? (args.triggerProcessId ?? null) : null;
  // triggerTiming only matters when there's a trigger process. Reset to the
  // default 'After' otherwise so the column never carries a stale value
  // from a prior config.
  const triggerTiming = triggerProcessId
    ? (args.triggerTiming ?? "After")
    : "After";
  // Calculate-from-BOM is meaningful only on Fixed Duration; the table
  // CHECK enforces the same rule. Coerce any stale flag back to false on
  // mode switches so the row never carries an inconsistent combo.
  const calculateFromBom =
    args.mode === "Fixed Duration" ? (args.calculateFromBom ?? false) : false;

  // Reject trigger processes that aren't on the item's active recipe.
  // The set-shelf-life helper gates on processId equality, so a process
  // outside the recipe would never match and the expiry start date would
  // silently never get set. Mirrors the guard inside
  // upsertPickMethodWithShelfLife.
  if (triggerProcessId) {
    const recipe = await getRecipeProcessIdsForItem(client, args.itemId);
    if (recipe.error) {
      return { data: null, error: recipe.error } as any;
    }
    if (!recipe.data.includes(triggerProcessId)) {
      return {
        data: null,
        error: {
          message:
            "Shelf-life trigger process must be one of the operations on this item's recipe",
          details: "",
          hint: "",
          code: "shelf_life_trigger_process_not_in_recipe"
        }
      } as any;
    }
  }

  const existing = await client
    .from("itemShelfLife")
    .select("itemId")
    .eq("itemId", args.itemId)
    .maybeSingle();

  if (existing.error) return existing;

  if (existing.data) {
    return client
      .from("itemShelfLife")
      .update({
        mode: args.mode,
        days,
        triggerProcessId,
        triggerTiming,
        calculateFromBom,
        updatedBy: args.userId,
        updatedAt: new Date().toISOString()
      })
      .eq("itemId", args.itemId);
  }

  let companyId = args.companyId;
  if (!companyId) {
    const itemRow = await client
      .from("item")
      .select("companyId")
      .eq("id", args.itemId)
      .single();
    if (itemRow.error || !itemRow.data) return itemRow;
    companyId = itemRow.data.companyId ?? undefined;
  }

  return client.from("itemShelfLife").insert({
    itemId: args.itemId,
    mode: args.mode!,
    days,
    triggerProcessId,
    triggerTiming,
    calculateFromBom,
    companyId: companyId!,
    createdBy: args.userId
  });
}

/**
 * Atomic counterpart to {@link upsertPickMethod} + {@link upsertItemShelfLife}.
 *
 * The inventory form card submits pickMethod fields and shelf-life fields in
 * the same POST (see pickMethodWithShelfLifeValidator). Writing them through
 * two independent Supabase calls means a failure between the two leaves a
 * partial update committed. This helper runs both writes inside a single
 * Postgres transaction via Kysely.
 */
export async function upsertPickMethodWithShelfLife(
  db: Kysely<KyselyDatabase>,
  args: {
    itemId: string;
    locationId: string;
    defaultStorageUnitId?: string | null;
    sortMethod?: (typeof pickMethodSortMethods)[number];
    customFields?: Json;
    userId: string;
    shelfLife: {
      mode?: (typeof shelfLifeModes)[number];
      days?: number;
      triggerProcessId?: string;
      triggerTiming?: (typeof shelfLifeTriggerTimings)[number];
      calculateFromBom?: boolean;
    };
  }
) {
  const updatedAt = now(getLocalTimeZone()).toAbsoluteString();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("pickMethod")
      .set({
        defaultStorageUnitId: args.defaultStorageUnitId ?? null,
        // Only overwrite when the caller surfaced the field; the column is
        // NOT NULL DEFAULT 'Default' so we never set it null.
        ...(args.sortMethod ? { sortMethod: args.sortMethod } : {}),
        customFields: args.customFields ?? null,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "=", args.itemId)
      .where("locationId", "=", args.locationId)
      .execute();

    const { mode, days, triggerProcessId, triggerTiming, calculateFromBom } =
      args.shelfLife;

    // mode undefined = caller didn't surface the field; leave any existing
    // row alone (matches upsertItemShelfLife semantics).
    if (mode === undefined) return;

    if (mode === "NotManaged") {
      await trx
        .deleteFrom("itemShelfLife")
        .where("itemId", "=", args.itemId)
        .execute();
      return;
    }

    const normalizedDays = mode === "Fixed Duration" ? (days ?? null) : null;
    const normalizedTriggerProcess =
      mode === "Fixed Duration" ? (triggerProcessId ?? null) : null;
    const normalizedTriggerTiming = normalizedTriggerProcess
      ? (triggerTiming ?? "After")
      : "After";
    const normalizedCalcFromBom =
      mode === "Fixed Duration" ? (calculateFromBom ?? false) : false;

    // Reject trigger processes that aren't on the item's active recipe.
    // The set-shelf-life helper gates on processId equality, so picking a
    // process the recipe never runs would silently never set the expiry.
    if (normalizedTriggerProcess) {
      const recipeProcessIds = await trx
        .selectFrom("methodOperation as mo")
        .innerJoin("activeMakeMethods as amm", "amm.id", "mo.makeMethodId")
        .select("mo.processId")
        .where("amm.itemId", "=", args.itemId)
        .where("mo.processId", "is not", null)
        .execute();
      const allowed = new Set(
        recipeProcessIds
          .map((r) => r.processId)
          .filter((id): id is string => !!id)
      );
      if (!allowed.has(normalizedTriggerProcess)) {
        throw new Error(
          "Shelf-life trigger process must be one of the operations on this item's recipe"
        );
      }
    }

    const existing = await trx
      .selectFrom("itemShelfLife")
      .select("itemId")
      .where("itemId", "=", args.itemId)
      .executeTakeFirst();

    if (existing) {
      await trx
        .updateTable("itemShelfLife")
        .set({
          mode,
          days: normalizedDays,
          triggerProcessId: normalizedTriggerProcess,
          triggerTiming: normalizedTriggerTiming,
          calculateFromBom: normalizedCalcFromBom,
          updatedBy: args.userId,
          updatedAt
        })
        .where("itemId", "=", args.itemId)
        .execute();
      return;
    }

    const itemRow = await trx
      .selectFrom("item")
      .select("companyId")
      .where("id", "=", args.itemId)
      .executeTakeFirstOrThrow();

    if (!itemRow.companyId) {
      throw new Error(`Item ${args.itemId} has no companyId`);
    }

    await trx
      .insertInto("itemShelfLife")
      .values({
        itemId: args.itemId,
        mode,
        days: normalizedDays,
        triggerProcessId: normalizedTriggerProcess,
        triggerTiming: normalizedTriggerTiming,
        calculateFromBom: normalizedCalcFromBom,
        companyId: itemRow.companyId,
        createdBy: args.userId
      })
      .execute();
  });
}

/**
 * Cascades a change to item.itemTrackingType onto the snapshot columns
 * `requiresSerialTracking` and `requiresBatchTracking` on child rows that
 * belong to OPEN parents (jobs, receipts, shipments, stock transfers).
 *
 * Without this, snapshot flags drift from the live item value and leave the
 * UI reading stale (often sticky-true) tracking flags after an item is
 * flipped back to Inventory / Non-Inventory.
 */
export async function cascadeItemTrackingType(
  db: Kysely<KyselyDatabase>,
  args: {
    itemIds: string[];
    companyId: string;
    newType: InventoryItemType;
    userId: string;
  }
) {
  if (args.itemIds.length === 0) return;

  const requiresSerialTracking = args.newType === ItemTrackingType.Serial;
  const requiresBatchTracking = args.newType === ItemTrackingType.Batch;
  const updatedAt = now(getLocalTimeZone()).toAbsoluteString();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("jobMakeMethod")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "jobId",
          "in",
          eb
            .selectFrom("job")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "in", ["Draft", "Planned"])
        )
      )
      .execute();

    await trx
      .updateTable("jobMaterial")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "jobId",
          "in",
          eb
            .selectFrom("job")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "in", ["Draft", "Planned"])
        )
      )
      .execute();

    await trx
      .updateTable("receiptLine")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "receiptId",
          "in",
          eb
            .selectFrom("receipt")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "=", "Draft")
        )
      )
      .execute();

    await trx
      .updateTable("shipmentLine")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "shipmentId",
          "in",
          eb
            .selectFrom("shipment")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "=", "Draft")
        )
      )
      .execute();

    await trx
      .updateTable("stockTransferLine")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "stockTransferId",
          "in",
          eb
            .selectFrom("stockTransfer")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "=", "Draft")
        )
      )
      .execute();
  });
}

/**
 * Updates item-level method/sourcing columns and mirrors the change down to
 * every methodMaterial that references the item — in a single transaction, so
 * the item and its mirrors can never be left half-applied.
 *
 * sourcingType and defaultMethodType are item-level properties; method
 * materials are read-only mirrors. Only mirrors on Draft make methods are
 * touched — Active and Archived methods are frozen.
 */
export async function updateItemMethodAndSourcing(
  db: Kysely<KyselyDatabase>,
  args: {
    itemIds: string[];
    companyId: string;
    userId: string;
    itemUpdate: {
      replenishmentSystem?: Database["public"]["Enums"]["itemReplenishmentSystem"];
      defaultMethodType?: MethodType;
      sourcingType?: SourcingType;
    };
    cascade: {
      sourcingType?: SourcingType;
      methodType?: MethodType;
    };
  }
) {
  if (args.itemIds.length === 0) return;

  const updatedAt = now(getLocalTimeZone()).toAbsoluteString();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("item")
      .set({ ...args.itemUpdate, updatedBy: args.userId, updatedAt })
      .where("id", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .execute();

    await cascadeSourcingAndMethodTypeToMethodMaterials(trx, {
      itemIds: args.itemIds,
      companyId: args.companyId,
      userId: args.userId,
      newSourcingType: args.cascade.sourcingType,
      newMethodType: args.cascade.methodType
    });
  });
}

/**
 * Mirrors an item's sourcingType/methodType onto every methodMaterial that
 * references it. Operates on a caller-supplied transaction so it composes with
 * the item update above. Only method materials on Draft make methods are
 * touched.
 */
async function cascadeSourcingAndMethodTypeToMethodMaterials(
  trx: KyselyTx,
  args: {
    itemIds: string[];
    companyId: string;
    userId: string;
    newSourcingType?: SourcingType;
    newMethodType?: MethodType;
  }
) {
  if (args.itemIds.length === 0) return;
  if (!args.newSourcingType && !args.newMethodType) return;

  const updatedAt = now(getLocalTimeZone()).toAbsoluteString();

  // Restrict to method materials whose make method is still Draft.
  const onDraftMakeMethod = (
    eb: ExpressionBuilder<KyselyDatabase, "methodMaterial">
  ) =>
    eb(
      "makeMethodId",
      "in",
      eb
        .selectFrom("makeMethod")
        .select("id")
        .where("companyId", "=", args.companyId)
        .where("status", "=", "Draft")
    );

  const baseSet: {
    updatedBy: string;
    updatedAt: string;
    sourcingType?: SourcingType;
  } = {
    updatedBy: args.userId,
    updatedAt
  };
  if (args.newSourcingType) baseSet.sourcingType = args.newSourcingType;

  await trx
    .updateTable("methodMaterial")
    .set((eb) => ({
      ...baseSet,
      ...(args.newMethodType === "Make to Order"
        ? {
            methodType: "Make to Order" as const,
            // materialMakeMethodId points at the component item's active make
            // method (mirrors upsertMethodMaterial). Resolved with a correlated
            // subquery so a single statement covers every item; null when the
            // component has no active make method.
            materialMakeMethodId: eb
              .selectFrom("activeMakeMethods")
              .select("id")
              .whereRef(
                "activeMakeMethods.itemId",
                "=",
                "methodMaterial.itemId"
              )
              .where("activeMakeMethods.companyId", "=", args.companyId)
              .limit(1)
          }
        : args.newMethodType
          ? { methodType: args.newMethodType, materialMakeMethodId: null }
          : {})
    }))
    .where("itemId", "in", args.itemIds)
    .where("companyId", "=", args.companyId)
    .where(onDraftMakeMethod)
    .execute();
}

export async function upsertConsumable(
  client: SupabaseClient<Database>,
  consumable:
    | (z.infer<typeof consumableValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof consumableValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in consumable) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: consumable.id,
        name: consumable.name,
        description: consumable.description,
        type: "Consumable",
        replenishmentSystem: consumable.replenishmentSystem,
        defaultMethodType: consumable.defaultMethodType,
        itemTrackingType: consumable.itemTrackingType,
        unitOfMeasureCode: consumable.unitOfMeasureCode,
        active: true,
        companyId: consumable.companyId,
        createdBy: consumable.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const [consumableInsert, itemCostUpdate] = await Promise.all([
      client.from("consumable").upsert({
        id: consumable.id,
        companyId: consumable.companyId,
        createdBy: consumable.createdBy,
        customFields: consumable.customFields
      }),
      client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: consumable.postingGroupId,
            unitCost: consumable.unitCost
          })
        )
        .eq("itemId", itemId)
    ]);

    if (consumableInsert.error) return consumableInsert;
    if (itemCostUpdate.error) return itemCostUpdate;

    if (itemId) {
      const pickMethod = await upsertItemDefaultPickMethod(client, {
        itemId,
        userId: consumable.createdBy,
        storageUnitId: consumable.defaultStorageUnitId
      });
      if (pickMethod.error) return pickMethod;

      const shelfLife = await upsertItemShelfLife(client, {
        itemId,
        userId: consumable.createdBy,
        companyId: consumable.companyId,
        mode: consumable.shelfLifeMode,
        days: consumable.shelfLifeDays,
        triggerProcessId: consumable.shelfLifeTriggerProcessId,
        triggerTiming: consumable.shelfLifeTriggerTiming,
        calculateFromBom: consumable.shelfLifeCalculateFromBom
      });
      if (shelfLife.error) return shelfLife;
    }

    const newConsumable = await client
      .from("consumables")
      .select("id")
      .eq("readableId", consumable.id)
      .eq("companyId", consumable.companyId)
      .single();

    return newConsumable;
  }

  const itemUpdate = {
    id: consumable.id,
    name: consumable.name,
    description: consumable.description,
    replenishmentSystem: consumable.replenishmentSystem,
    defaultMethodType: consumable.defaultMethodType,
    itemTrackingType: consumable.itemTrackingType,
    unitOfMeasureCode: consumable.unitOfMeasureCode,
    active: true
  };

  const consumableUpdate = {
    customFields: consumable.customFields
  };

  const [updateItem, updateConsumable] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", consumable.id),
    client
      .from("consumable")
      .update({
        ...sanitize(consumableUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", consumable.id)
  ]);

  if (updateItem.error) return updateItem;

  const pickMethod = await upsertItemDefaultPickMethod(client, {
    itemId: consumable.id,
    userId: consumable.updatedBy,
    storageUnitId: consumable.defaultStorageUnitId
  });
  if (pickMethod.error) return pickMethod;

  const shelfLife = await upsertItemShelfLife(client, {
    itemId: consumable.id,
    userId: consumable.updatedBy,
    mode: consumable.shelfLifeMode,
    days: consumable.shelfLifeDays,
    triggerProcessId: consumable.shelfLifeTriggerProcessId,
    triggerTiming: consumable.shelfLifeTriggerTiming,
    calculateFromBom: consumable.shelfLifeCalculateFromBom
  });
  if (shelfLife.error) return shelfLife;

  return updateConsumable;
}

export async function upsertPart(
  client: SupabaseClient<Database>,
  part:
    | (z.infer<typeof partValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof partValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in part) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: part.id,
        revision: part.revision ?? "0",
        name: part.name,
        description: part.description,
        type: "Part",
        replenishmentSystem: part.replenishmentSystem,
        defaultMethodType: part.defaultMethodType,
        itemTrackingType: part.itemTrackingType,
        unitOfMeasureCode: part.unitOfMeasureCode,
        active: true,
        modelUploadId: part.modelUploadId,
        companyId: part.companyId,
        createdBy: part.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const [partInsert, itemCostUpdate] = await Promise.all([
      client.from("part").upsert({
        id: part.id,
        companyId: part.companyId,
        createdBy: part.createdBy,
        customFields: part.customFields
      }),
      client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: part.postingGroupId,
            unitCost:
              part.replenishmentSystem !== "Make" ? part.unitCost : undefined
          })
        )
        .eq("itemId", itemId)
    ]);

    if (partInsert.error) return partInsert;
    if (itemCostUpdate.error) {
      console.error(itemCostUpdate.error);
    }

    if (part.replenishmentSystem !== "Buy") {
      const itemReplenishmentInsert = await client
        .from("itemReplenishment")
        .update({ lotSize: part.lotSize })
        .eq("itemId", itemId);

      if (itemReplenishmentInsert.error) return itemReplenishmentInsert;
    }

    if (itemId) {
      const pickMethod = await upsertItemDefaultPickMethod(client, {
        itemId,
        userId: part.createdBy,
        storageUnitId: part.defaultStorageUnitId
      });
      if (pickMethod.error) return pickMethod;

      const shelfLife = await upsertItemShelfLife(client, {
        itemId,
        userId: part.createdBy,
        companyId: part.companyId,
        mode: part.shelfLifeMode,
        days: part.shelfLifeDays,
        triggerProcessId: part.shelfLifeTriggerProcessId,
        triggerTiming: part.shelfLifeTriggerTiming,
        calculateFromBom: part.shelfLifeCalculateFromBom
      });
      if (shelfLife.error) return shelfLife;
    }

    const newPart = await client
      .from("parts")
      .select("id")
      .eq("readableId", part.id)
      .eq("companyId", part.companyId)
      .single();

    return newPart;
  }

  const itemUpdate = {
    id: part.id,
    name: part.name,
    description: part.description,
    replenishmentSystem: part.replenishmentSystem,
    defaultMethodType: part.defaultMethodType,
    itemTrackingType: part.itemTrackingType,
    unitOfMeasureCode: part.unitOfMeasureCode,
    active: true
  };

  const partUpdate = {
    customFields: part.customFields
  };

  const [updateItem, updatePart] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", part.id),
    client
      .from("part")
      .update({
        ...sanitize(partUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", part.id)
  ]);

  if (updateItem.error) return updateItem;

  const pickMethod = await upsertItemDefaultPickMethod(client, {
    itemId: part.id,
    userId: part.updatedBy,
    storageUnitId: part.defaultStorageUnitId
  });
  if (pickMethod.error) return pickMethod;

  const shelfLife = await upsertItemShelfLife(client, {
    itemId: part.id,
    userId: part.updatedBy,
    mode: part.shelfLifeMode,
    days: part.shelfLifeDays,
    triggerProcessId: part.shelfLifeTriggerProcessId,
    triggerTiming: part.shelfLifeTriggerTiming,
    calculateFromBom: part.shelfLifeCalculateFromBom
  });
  if (shelfLife.error) return shelfLife;

  return updatePart;
}

export async function updateItem(
  client: SupabaseClient<Database>,
  item: z.infer<typeof itemValidator> & {
    companyId: string;
    type: Database["public"]["Enums"]["itemType"];
  }
) {
  return client
    .from("item")
    .update(sanitize(item))
    .eq("id", item.id)
    .eq("companyId", item.companyId);
}

export async function upsertItemCost(
  client: SupabaseClient<Database>,
  itemCost: z.infer<typeof itemCostValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("itemCost")
    .update(sanitize(itemCost))
    .eq("itemId", itemCost.itemId);
}

export async function upsertPickMethod(
  client: SupabaseClient<Database>,
  pickMethod:
    | (z.infer<typeof pickMethodValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof pickMethodValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in pickMethod) {
    return client.from("pickMethod").upsert(pickMethod, {
      onConflict: "itemId,locationId"
    });
  }

  return client
    .from("pickMethod")
    .update(sanitize(pickMethod))
    .eq("itemId", pickMethod.itemId)
    .eq("locationId", pickMethod.locationId);
}

export async function upsertItemManufacturing(
  client: SupabaseClient<Database>,
  partManufacturing: z.infer<typeof itemManufacturingValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("itemReplenishment")
    .update(sanitize(partManufacturing))
    .eq("itemId", partManufacturing.itemId);
}

export async function upsertItemPlanning(
  client: SupabaseClient<Database>,
  partPlanning:
    | {
        companyId: string;
        itemId: string;
        locationId: string;
        createdBy: string;
      }
    | (z.infer<typeof itemPlanningValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in partPlanning) {
    return client.from("itemPlanning").insert(partPlanning);
  }
  return client
    .from("itemPlanning")
    .update(sanitize(partPlanning))
    .eq("itemId", partPlanning.itemId)
    .eq("locationId", partPlanning.locationId);
}

export async function upsertItemPurchasing(
  client: SupabaseClient<Database>,
  itemPurchasing: z.infer<typeof itemPurchasingValidator> & {
    updatedBy: string;
  }
) {
  return client
    .from("itemReplenishment")
    .update(sanitize(itemPurchasing))
    .eq("itemId", itemPurchasing.itemId);
}

export async function upsertItemSupersession(
  client: SupabaseClient<Database>,
  itemSupersession: z.infer<typeof itemSupersessionValidator> & {
    companyId: string;
    createdBy: string;
    updatedBy: string;
  }
) {
  const {
    itemId,
    companyId,
    createdBy,
    updatedBy,
    supersessionMode,
    successorItemId,
    discontinuationDate,
    successorEffectivityDate,
    conversionFactor,
    locationId,
    minimumReserveQuantity
  } = itemSupersession;

  // The minimum service-stock floor is per-location, so it lives on
  // itemPlanning rather than the global supersession record.
  if (locationId && minimumReserveQuantity !== undefined) {
    const reserveUpdate = await client
      .from("itemPlanning")
      .update({ minimumReserveQuantity, updatedBy })
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId);
    if (reserveUpdate.error) return reserveUpdate;
  }

  // No mode selected = no supersession; clear any existing config.
  if (!supersessionMode) {
    return client
      .from("itemSupersession")
      .delete()
      .eq("itemId", itemId)
      .eq("companyId", companyId);
  }

  const isNoStock = supersessionMode === "No Stock";
  const row = {
    supersessionMode,
    // No Stock has no successor (nothing takes over the demand).
    successorItemId: isNoStock ? null : (successorItemId ?? null),
    discontinuationDate: discontinuationDate ?? null,
    successorEffectivityDate: isNoStock
      ? null
      : (successorEffectivityDate ?? null),
    conversionFactor: isNoStock ? 1 : (conversionFactor ?? 1)
  };

  const existing = await client
    .from("itemSupersession")
    .select("itemId")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (existing.data) {
    return client
      .from("itemSupersession")
      .update({ ...row, updatedBy, updatedAt: new Date().toISOString() })
      .eq("itemId", itemId)
      .eq("companyId", companyId);
  }

  return client
    .from("itemSupersession")
    .insert({ ...row, itemId, companyId, createdBy });
}

export async function upsertItemPostingGroup(
  client: SupabaseClient<Database>,
  itemPostingGroup:
    | (Omit<z.infer<typeof itemPostingGroupValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof itemPostingGroupValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in itemPostingGroup) {
    return client
      .from("itemPostingGroup")
      .insert([itemPostingGroup])
      .select("*")
      .single();
  }
  return (
    client
      .from("itemPostingGroup")
      .update(sanitize(itemPostingGroup))
      // @ts-ignore
      .eq("id", itemPostingGroup.id)
      .select("id")
      .single()
  );
}

export async function upsertSupplierPart(
  client: SupabaseClient<Database>,
  supplierPart:
    | (Omit<z.infer<typeof supplierPartValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierPartValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplierPart) {
    return client
      .from("supplierPart")
      .insert([supplierPart])
      .select("id")
      .single();
  }
  return client
    .from("supplierPart")
    .update(sanitize(supplierPart))
    .eq("id", supplierPart.id)
    .select("id")
    .single();
}

export async function upsertItemCustomerPart(
  client: SupabaseClient<Database>,
  customerPart:
    | (Omit<z.infer<typeof customerPartValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof customerPartValidator>, "id"> & {
        id: string;
      })
) {
  if ("id" in customerPart) {
    return client
      .from("customerPartToItem")
      .update(sanitize(customerPart))
      .eq("id", customerPart.id)
      .select("id")
      .single();
  }
  return client
    .from("customerPartToItem")
    .insert([customerPart])
    .select("id")
    .single();
}

export async function upsertItemUnitSalePrice(
  client: SupabaseClient<Database>,
  itemUnitSalePrice: z.infer<typeof itemUnitSalePriceValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("itemUnitSalePrice")
    .update(sanitize(itemUnitSalePrice))
    .eq("itemId", itemUnitSalePrice.itemId);
}

export async function upsertMakeMethodVersion(
  client: SupabaseClient<Database>,
  makeMethodVersion: z.infer<typeof makeMethodVersionValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  const currentMakeMethod = await client
    .from("makeMethod")
    .select("*")
    .eq("id", makeMethodVersion.copyFromId)
    .eq("companyId", makeMethodVersion.companyId)
    .single();

  if (currentMakeMethod.error) return currentMakeMethod;

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, version, ...data } = currentMakeMethod.data;

  const insert = await client
    .from("makeMethod")
    .insert({
      ...data,
      status: "Draft",
      version: makeMethodVersion.version,
      createdBy: makeMethodVersion.createdBy
    })
    .select("id, ...item(itemId:id, type)")
    .single();

  if (insert.error) return insert;

  if (makeMethodVersion.activeVersionId) {
    await client
      .from("makeMethod")
      .update({ status: "Active" })
      .eq("id", makeMethodVersion.activeVersionId);
  }

  return insert;
}

/**
 * On BoM material add, seed `methodMaterial.storageUnitIds` with every
 * (locationId -> defaultStorageUnitId) pair configured for the child item
 * in "pickMethod". Values set by the caller win so downstream BoMs
 * constructed with explicit picks are untouched.
 *
 * The JSONB is modelled as Record<locationId, storageUnitId>. Reading all
 * pickMethods (rather than a single "default") matches Carbon's model
 * where an item can be stocked across multiple locations, each with its
 * own preferred bin.
 */
async function resolveMethodMaterialStorageUnitIds(
  client: SupabaseClient<Database>,
  args: {
    itemId?: string | null;
    current?: Record<string, string>;
  }
): Promise<Record<string, string>> {
  const current = { ...(args.current ?? {}) };
  if (!args.itemId) return current;

  const pickMethods = await client
    .from("pickMethod")
    .select("locationId, defaultStorageUnitId")
    .eq("itemId", args.itemId);

  for (const row of pickMethods.data ?? []) {
    if (
      row.locationId &&
      row.defaultStorageUnitId &&
      !current[row.locationId]
    ) {
      current[row.locationId] = row.defaultStorageUnitId;
    }
  }

  return current;
}

export async function upsertMethodMaterial(
  client: SupabaseClient<Database>,

  methodMaterial:
    | (z.infer<typeof methodMaterialValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof methodMaterialValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  // sourcingType and methodType are item-level properties (edited in the
  // item's Properties sidebar). A methodMaterial is a read-only mirror of its
  // component item, so derive both from the item rather than trusting the
  // submitted form values.
  if (methodMaterial.itemId) {
    const item = await client
      .from("item")
      .select("defaultMethodType, sourcingType")
      .eq("id", methodMaterial.itemId)
      .single();

    if (item.error) return item;
    methodMaterial.methodType =
      item.data.defaultMethodType ?? methodMaterial.methodType;
    methodMaterial.sourcingType = item.data.sourcingType;
  }

  let materialMakeMethodId: string | null = null;
  if (methodMaterial.methodType === "Make to Order") {
    const makeMethod = await client
      .from("activeMakeMethods")
      .select("id, version")
      .eq("itemId", methodMaterial.itemId!)
      .single();

    if (makeMethod.error) return makeMethod;
    materialMakeMethodId = makeMethod.data?.id;
  }

  if ("createdBy" in methodMaterial) {
    // Seed storageUnitIds from the child item's default location/storage-unit
    // if the caller didn't already provide one for that location. Respects
    // the form value when supplied, adds a sensible default otherwise.
    const seededStorageUnitIds = await resolveMethodMaterialStorageUnitIds(
      client,
      {
        itemId: methodMaterial.itemId,
        current: methodMaterial.storageUnitIds as
          | Record<string, string>
          | undefined
      }
    );
    return client
      .from("methodMaterial")
      .insert([
        {
          ...methodMaterial,
          itemId: methodMaterial.itemId!,
          storageUnitIds: seededStorageUnitIds,
          materialMakeMethodId
        }
      ])
      .select("id")
      .single();
  }
  return client
    .from("methodMaterial")
    .update(sanitize({ ...methodMaterial, materialMakeMethodId }))
    .eq("id", methodMaterial.id)
    .select("id")
    .single();
}

export async function upsertMethodOperation(
  client: SupabaseClient<Database>,

  methodOperation:
    | (Omit<z.infer<typeof methodOperationValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof methodOperationValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof methodOperationValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in methodOperation) {
    return client
      .from("methodOperation")
      .insert([methodOperation])
      .select("id")
      .single();
  }
  return client
    .from("methodOperation")
    .update(sanitize(methodOperation))
    .eq("id", methodOperation.id)
    .select("id")
    .single();
}

export async function upsertMethodOperationStep(
  client: SupabaseClient<Database>,
  methodOperationStep:
    | (Omit<z.infer<typeof operationStepValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<
        z.infer<typeof operationStepValidator>,
        "id" | "minValue" | "maxValue"
      > & {
        id: string;
        minValue: number | null;
        maxValue: number | null;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in methodOperationStep) {
    return client
      .from("methodOperationStep")
      .insert(methodOperationStep)
      .select("id")
      .single();
  }

  return client
    .from("methodOperationStep")
    .update(sanitize(methodOperationStep))
    .eq("id", methodOperationStep.id)
    .select("id")
    .single();
}

export async function upsertMethodOperationParameter(
  client: SupabaseClient<Database>,
  methodOperationParameter:
    | (Omit<z.infer<typeof operationParameterValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof operationParameterValidator>, "id"> & {
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in methodOperationParameter) {
    return client
      .from("methodOperationParameter")
      .insert(methodOperationParameter)
      .select("id")
      .single();
  }

  return client
    .from("methodOperationParameter")
    .update(sanitize(methodOperationParameter))
    .eq("id", methodOperationParameter.id)
    .select("id")
    .single();
}

export async function upsertMethodOperationTool(
  client: SupabaseClient<Database>,
  methodOperationTool:
    | (Omit<z.infer<typeof operationToolValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof operationToolValidator>, "id"> & {
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in methodOperationTool) {
    return client
      .from("methodOperationTool")
      .insert(methodOperationTool)
      .select("id")
      .single();
  }

  return client
    .from("methodOperationTool")
    .update(sanitize(methodOperationTool))
    .eq("id", methodOperationTool.id)
    .select("id")
    .single();
}

export async function upsertMaterial(
  client: SupabaseClient<Database>,
  material:
    | (z.infer<typeof materialValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
        sizes?: string[];
      })
    | (z.infer<typeof materialValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in material) {
    // Collect every newly-created item id across the sizes / no-sizes
    // branches so the shelf-life policy can be applied uniformly.
    const newItemIds: string[] = [];

    if (material.sizes) {
      const itemInserts = await Promise.all(
        material.sizes.map((size) =>
          client
            .from("item")
            .insert({
              readableId: material.id,
              name: material.name,
              description: material.description,
              type: "Material",
              replenishmentSystem: material.replenishmentSystem,
              defaultMethodType: material.defaultMethodType,
              itemTrackingType: material.itemTrackingType,
              unitOfMeasureCode: material.unitOfMeasureCode,
              active: true,
              revision: size,
              companyId: material.companyId,
              createdBy: material.createdBy
            })
            .select("id")
            .single()
        )
      );

      const hasErrors = itemInserts.some((insert) => insert.error);
      if (hasErrors) {
        const firstError = itemInserts.find((insert) => insert.error);
        return firstError!;
      }
      for (const insert of itemInserts) {
        if (insert.data?.id) newItemIds.push(insert.data.id);
      }
      const itemCostUpdate = await Promise.all(
        itemInserts.map((insert) =>
          client
            .from("itemCost")
            .update(
              sanitize({
                itemPostingGroupId: material.postingGroupId,
                unitCost: material.unitCost
              })
            )
            .eq("itemId", insert.data?.id ?? "")
        )
      );
      if (itemCostUpdate.some((update) => update.error)) {
        console.error(itemCostUpdate.find((update) => update.error));
      }
    } else {
      const itemInsert = await client
        .from("item")
        .insert({
          readableId: material.id,
          name: material.name,
          description: material.description,
          type: "Material",
          replenishmentSystem: material.replenishmentSystem,
          defaultMethodType: material.defaultMethodType,
          itemTrackingType: material.itemTrackingType,
          unitOfMeasureCode: material.unitOfMeasureCode,
          active: true,
          companyId: material.companyId,
          createdBy: material.createdBy
        })
        .select("id")
        .single();
      if (itemInsert.error) return itemInsert;
      const itemId = itemInsert.data?.id;
      if (itemId) newItemIds.push(itemId);
      const itemCostUpdate = await client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: material.postingGroupId,
            unitCost: material.unitCost
          })
        )
        .eq("itemId", itemId);
      if (itemCostUpdate.error) {
        console.error(itemCostUpdate.error);
      }
    }

    for (const itemId of newItemIds) {
      const pickMethod = await upsertItemDefaultPickMethod(client, {
        itemId,
        userId: material.createdBy,
        storageUnitId: material.defaultStorageUnitId
      });
      if (pickMethod.error) return pickMethod;

      const shelfLife = await upsertItemShelfLife(client, {
        itemId,
        userId: material.createdBy,
        companyId: material.companyId,
        mode: material.shelfLifeMode,
        days: material.shelfLifeDays,
        triggerProcessId: material.shelfLifeTriggerProcessId,
        triggerTiming: material.shelfLifeTriggerTiming,
        calculateFromBom: material.shelfLifeCalculateFromBom
      });
      if (shelfLife.error) return shelfLife;
    }

    const materialInsert = await client.from("material").upsert({
      id: material.id,
      materialFormId: material.materialFormId,
      materialSubstanceId: material.materialSubstanceId,
      finishId: material.finishId,
      gradeId: material.gradeId,
      dimensionId: material.dimensionId,
      materialTypeId: material.materialTypeId,
      companyId: material.companyId,
      createdBy: material.createdBy,
      customFields: material.customFields
    });

    if (materialInsert.error) return materialInsert;

    const newMaterial = await client
      .from("materials")
      .select("*")
      .eq("readableId", material.id)
      .eq("companyId", material.companyId);

    return {
      data: newMaterial.data?.[0] ?? null,
      error: newMaterial.error
    };
  }

  const itemUpdate = {
    id: material.id,
    name: material.name,
    description: material.description,
    replenishmentSystem: material.replenishmentSystem,
    defaultMethodType: material.defaultMethodType,
    itemTrackingType: material.itemTrackingType,
    unitOfMeasureCode: material.unitOfMeasureCode,
    active: true
  };

  const materialUpdate = {
    materialFormId: material.materialFormId,
    materialSubstanceId: material.materialSubstanceId,
    finishId: material.finishId,
    gradeId: material.gradeId,
    dimensionId: material.dimensionId,
    materialTypeId: material.materialTypeId,
    customFields: material.customFields
  };

  const [updateItem, updateMaterial] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", material.id),
    client
      .from("material")
      .update({
        ...sanitize(materialUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", material.id)
  ]);

  if (updateItem.error) return updateItem;

  const pickMethod = await upsertItemDefaultPickMethod(client, {
    itemId: material.id,
    userId: material.updatedBy,
    storageUnitId: material.defaultStorageUnitId
  });
  if (pickMethod.error) return pickMethod;

  const shelfLife = await upsertItemShelfLife(client, {
    itemId: material.id,
    userId: material.updatedBy,
    mode: material.shelfLifeMode,
    days: material.shelfLifeDays,
    triggerProcessId: material.shelfLifeTriggerProcessId,
    triggerTiming: material.shelfLifeTriggerTiming,
    calculateFromBom: material.shelfLifeCalculateFromBom
  });
  if (shelfLife.error) return shelfLife;

  return updateMaterial;
}

export async function upsertMaterialDimension(
  client: SupabaseClient<Database>,
  materialDimension:
    | (Omit<z.infer<typeof materialDimensionValidator>, "id"> & {
        companyId: string;
        isMetric: boolean;
      })
    | (Omit<z.infer<typeof materialDimensionValidator>, "id"> & {
        id: string;
      })
) {
  if ("id" in materialDimension) {
    return (
      client
        .from("materialDimension")
        .update(sanitize(materialDimension))
        // @ts-ignore
        .eq("id", materialDimension.id)
        .select("id")
        .single()
    );
  }

  return client
    .from("materialDimension")
    .insert([materialDimension])
    .select("*")
    .single();
}

export async function upsertMaterialFinish(
  client: SupabaseClient<Database>,
  materialFinish:
    | (Omit<z.infer<typeof materialFinishValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof materialFinishValidator>, "id"> & {
        id: string;
      })
) {
  if ("id" in materialFinish) {
    return (
      client
        .from("materialFinish")
        .update(sanitize(materialFinish))
        // @ts-ignore
        .eq("id", materialFinish.id)
        .select("id")
        .single()
    );
  }
  return client
    .from("materialFinish")
    .insert([materialFinish])
    .select("*")
    .single();
}

export async function upsertMaterialForm(
  client: SupabaseClient<Database>,
  materialForm:
    | (Omit<z.infer<typeof materialFormValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof materialFormValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in materialForm) {
    return client
      .from("materialForm")
      .insert([materialForm])
      .select("*")
      .single();
  }
  return (
    client
      .from("materialForm")
      .update(sanitize(materialForm))
      // @ts-ignore
      .eq("id", materialForm.id)
      .select("id")
      .single()
  );
}

export async function upsertMaterialGrade(
  client: SupabaseClient<Database>,
  materialGrade:
    | (Omit<z.infer<typeof materialGradeValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof materialGradeValidator>, "id"> & {
        id: string;
      })
) {
  if ("id" in materialGrade) {
    return (
      client
        .from("materialGrade")
        .update(sanitize(materialGrade))
        // @ts-ignore
        .eq("id", materialGrade.id)
        .select("id")
        .single()
    );
  }
  return client
    .from("materialGrade")
    .insert([materialGrade])
    .select("*")
    .single();
}

export async function deleteMaterialType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialType").delete().eq("id", id);
}

export async function getMaterialTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialTypes")
    .select("*", { count: "exact" })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args ?? {});
  return query;
}

export async function getMaterialType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialType").select("*").eq("id", id).single();
}

export async function getMaterialTypeList(
  client: SupabaseClient<Database>,
  materialSubstanceId: string,
  materialFormId: string,
  companyId: string
) {
  return client
    .from("materialType")
    .select("*")
    .eq("materialSubstanceId", materialSubstanceId)
    .eq("materialFormId", materialFormId)
    .or(`companyId.eq.${companyId},companyId.is.null`);
}

export async function upsertMaterialType(
  client: SupabaseClient<Database>,
  materialType:
    | (Omit<z.infer<typeof materialTypeValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof materialTypeValidator>, "id"> & {
        id: string;
      })
) {
  if ("id" in materialType) {
    return (
      client
        .from("materialType")
        .update(sanitize(materialType))
        // @ts-ignore
        .eq("id", materialType.id)
        .select("id")
        .single()
    );
  }
  return client
    .from("materialType")
    .insert([materialType])
    .select("*")
    .single();
}

export async function upsertMaterialSubstance(
  client: SupabaseClient<Database>,
  materialSubstance:
    | (Omit<z.infer<typeof materialSubstanceValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof materialSubstanceValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in materialSubstance) {
    return client
      .from("materialSubstance")
      .insert([materialSubstance])
      .select("*")
      .single();
  }
  return (
    client
      .from("materialSubstance")
      .update(sanitize(materialSubstance))
      // @ts-ignore
      .eq("id", materialSubstance.id)
      .select("id")
      .single()
  );
}

export async function upsertService(
  client: SupabaseClient<Database>,
  service:
    | (z.infer<typeof serviceValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof serviceValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in service) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: service.id,
        name: service.name,
        type: "Service",
        replenishmentSystem:
          service.serviceType === "External" ? "Buy" : "Make",
        defaultMethodType:
          service.serviceType === "External"
            ? "Purchase to Order"
            : "Make to Order",
        itemTrackingType: service.itemTrackingType,
        unitOfMeasureCode: "EA",
        active: true,
        companyId: service.companyId,
        createdBy: service.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const serviceInsert = await client
      .from("service")
      .insert({
        id: service.id,
        serviceType: service.serviceType,
        companyId: service.companyId,
        createdBy: service.createdBy,
        customFields: service.customFields
      })
      .select("*")
      .single();

    if (serviceInsert.error) return serviceInsert;

    const costUpdate = await client
      .from("itemCost")
      .update({ unitCost: service.unitCost })
      .eq("itemId", itemId)
      .select("*")
      .single();

    if (costUpdate.error) return costUpdate;

    const newService = await client
      .from("service")
      .select("*")
      .eq("readableId", service.id)
      .single();

    return newService;
  }
  const itemUpdate = {
    id: service.id,
    name: service.name,
    description: service.description,
    replenishmentSystem:
      service.serviceType === "External" ? "Buy" : ("Make" as "Buy"),
    defaultMethodType:
      service.serviceType === "External"
        ? "Purchase to Order"
        : ("Make to Order" as "Purchase to Order"),
    itemTrackingType: service.itemTrackingType,
    unitOfMeasureCode: null,
    active: true
  };

  const serviceUpdate = {
    serviceType: service.serviceType
  };

  const [updateItem, updateService] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", service.id),
    client
      .from("service")
      .update({
        ...sanitize(serviceUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("itemId", service.id)
  ]);

  if (updateItem.error) return updateItem;
  return updateService;
}

export async function upsertUnitOfMeasure(
  client: SupabaseClient<Database>,
  unitOfMeasure:
    | (Omit<z.infer<typeof unitOfMeasureValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof unitOfMeasureValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in unitOfMeasure) {
    return client
      .from("unitOfMeasure")
      .update(sanitize(unitOfMeasure))
      .eq("id", unitOfMeasure.id)
      .select("id")
      .single();
  }

  return client
    .from("unitOfMeasure")
    .insert([unitOfMeasure])
    .select("id")
    .single();
}

export async function upsertTool(
  client: SupabaseClient<Database>,
  tool:
    | (z.infer<typeof toolValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof toolValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in tool) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: tool.id,
        revision: tool.revision ?? "0",
        name: tool.name,
        description: tool.description,
        type: "Tool",
        replenishmentSystem: tool.replenishmentSystem,
        defaultMethodType: tool.defaultMethodType,
        itemTrackingType: tool.itemTrackingType,
        unitOfMeasureCode: tool.unitOfMeasureCode,
        active: true,
        modelUploadId: tool.modelUploadId,
        companyId: tool.companyId,
        createdBy: tool.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const [toolInsert, itemCostUpdate] = await Promise.all([
      client.from("tool").upsert({
        id: tool.id,
        companyId: tool.companyId,
        createdBy: tool.createdBy,
        customFields: tool.customFields
      }),
      client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: tool.postingGroupId,
            unitCost: tool.unitCost
          })
        )
        .eq("itemId", itemId)
    ]);

    if (toolInsert.error) return toolInsert;
    if (itemCostUpdate.error) return itemCostUpdate;

    if (itemId) {
      const pickMethod = await upsertItemDefaultPickMethod(client, {
        itemId,
        userId: tool.createdBy,
        storageUnitId: tool.defaultStorageUnitId
      });
      if (pickMethod.error) return pickMethod;

      const shelfLife = await upsertItemShelfLife(client, {
        itemId,
        userId: tool.createdBy,
        companyId: tool.companyId,
        mode: tool.shelfLifeMode,
        days: tool.shelfLifeDays,
        triggerProcessId: tool.shelfLifeTriggerProcessId,
        triggerTiming: tool.shelfLifeTriggerTiming,
        calculateFromBom: tool.shelfLifeCalculateFromBom
      });
      if (shelfLife.error) return shelfLife;
    }

    const newTool = await client
      .from("tools")
      .select("*")
      .eq("readableId", tool.id)
      .eq("companyId", tool.companyId)
      .single();

    return newTool;
  }

  const itemUpdate = {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    replenishmentSystem: tool.replenishmentSystem,
    defaultMethodType: tool.defaultMethodType,
    itemTrackingType: tool.itemTrackingType,
    unitOfMeasureCode: tool.unitOfMeasureCode,
    active: true
  };

  const toolUpdate = {
    customFields: tool.customFields
  };

  const [updateItem, updateTool] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", tool.id),
    client
      .from("tool")
      .update({
        ...sanitize(toolUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", tool.id)
  ]);

  if (updateItem.error) return updateItem;

  const pickMethod = await upsertItemDefaultPickMethod(client, {
    itemId: tool.id,
    userId: tool.updatedBy,
    storageUnitId: tool.defaultStorageUnitId
  });
  if (pickMethod.error) return pickMethod;

  const shelfLife = await upsertItemShelfLife(client, {
    itemId: tool.id,
    userId: tool.updatedBy,
    mode: tool.shelfLifeMode,
    days: tool.shelfLifeDays,
    triggerProcessId: tool.shelfLifeTriggerProcessId,
    triggerTiming: tool.shelfLifeTriggerTiming,
    calculateFromBom: tool.shelfLifeCalculateFromBom
  });
  if (shelfLife.error) return shelfLife;

  return updateTool;
}

/**
 * Batch pre-fetch supplier price breaks for multiple items.
 * Builds a SupplierPriceMap keyed by itemId, pooling price break
 * tiers from ALL suppliers for each item.
 *
 * Used by the quote loader to pre-load pricing data for BOM costing.
 */
export async function getSupplierPriceBreaksForItems(
  client: SupabaseClient<Database>,
  itemIds: string[]
): Promise<SupplierPriceMap> {
  if (!itemIds.length) return {};

  const supplierParts = await client
    .from("supplierPart")
    .select("id, itemId, unitPrice")
    .in("itemId", itemIds);

  if (!supplierParts.data?.length) return {};

  const supplierPartIds = supplierParts.data.map((sp) => sp.id);

  const prices = await client
    .from("supplierPartPrice")
    .select("supplierPartId, quantity, unitPrice")
    .in("supplierPartId", supplierPartIds)
    .order("quantity", { ascending: true });

  // Build a lookup from supplierPartId → itemId
  const spToItem = new Map<string, string>();
  for (const sp of supplierParts.data) {
    spToItem.set(sp.id, sp.itemId);
  }

  const result: SupplierPriceMap = {};

  // Initialize entries with fallback prices
  for (const sp of supplierParts.data) {
    if (!result[sp.itemId]) {
      result[sp.itemId] = { priceBreaks: [], fallbackUnitPrice: null };
    }
    const current = result[sp.itemId].fallbackUnitPrice;
    if (sp.unitPrice != null && (current === null || sp.unitPrice < current)) {
      result[sp.itemId].fallbackUnitPrice = sp.unitPrice;
    }
  }

  // Add price breaks
  for (const price of prices.data ?? []) {
    const itemId = spToItem.get(price.supplierPartId);
    if (itemId && result[itemId]) {
      result[itemId].priceBreaks.push({
        quantity: price.quantity,
        unitPrice: price.unitPrice
      });
    }
  }

  return result;
}

/**
 * Async price lookup across ALL suppliers for an item.
 * Delegates to getSupplierPriceBreaksForItems + lookupBuyPriceFromMap.
 *
 * Used in quote creation where the specific supplier isn't known.
 */
export async function lookupBuyPrice(
  client: SupabaseClient<Database>,
  itemId: string,
  qty: number,
  fallbackCost: number
): Promise<number> {
  const map = await getSupplierPriceBreaksForItems(client, [itemId]);
  return lookupBuyPriceFromMap(itemId, qty, map, fallbackCost);
}

/**
 * Fetch price breaks array for a specific supplier part.
 * Used by PO and Invoice forms to cache breaks in state.
 */
export async function getSupplierPartPriceBreaks(
  client: SupabaseClient<Database>,
  supplierPartId: string
): Promise<PriceBreak[]> {
  const result = await client
    .from("supplierPartPrice")
    .select("quantity, unitPrice")
    .eq("supplierPartId", supplierPartId)
    .order("quantity", { ascending: true });

  return (result.data ?? []).map((pb) => ({
    quantity: pb.quantity,
    unitPrice: pb.unitPrice
  }));
}
