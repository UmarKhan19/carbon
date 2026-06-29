import type { Database, Json } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  changeOrderApprovalType,
  changeOrderDisposition,
  changeOrderPriority,
  changeOrderStatus,
  changeOrderTaskStatus,
  changeOrderType,
  changeOrderTypeValidator
} from "./changeOrder.models";

import {
  canEditChangeOrderItems,
  evaluateApprovalThreshold
} from "./changeOrder.models";
import { createRevision, getItem } from "./items.service";

// =============================================================================
// Getters — clone the quality.service.ts issue getters.
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

// =============================================================================
// getMyChangeOrderTasks — the signed-in user's pending change-order sign-offs.
//
// Returns every changeOrderReviewer (and changeOrderApprovalTask) row assigned
// to the user that is still Pending, joined to its parent change order so each
// row links straight to the CO. Identity is scoped by the caller's userId +
// companyId (both come from requirePermissions, never client input).
// =============================================================================

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

  // Soonest due dates first (nulls last), then by readable change-order id.
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

export async function getChangeOrderTasks(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return Promise.all([
    client
      .from("changeOrderActionTask")
      .select("*")
      .eq("changeOrderId", id)
      .eq("companyId", companyId)
      .order("sortOrder", { ascending: true })
      .order("createdAt", { ascending: true }),
    client
      .from("changeOrderApprovalTask")
      .select("*")
      .eq("changeOrderId", id)
      .eq("companyId", companyId)
      .order("sortOrder", { ascending: true })
      .order("createdAt", { ascending: true })
  ]);
}

export async function getChangeOrderType(
  client: SupabaseClient<Database>,
  changeOrderTypeId: string
) {
  return client
    .from("changeOrderType")
    .select("*")
    .eq("id", changeOrderTypeId)
    .single();
}

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
    .order("name");
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

// =============================================================================
// Mutations — clone insertIssue/updateIssue/deleteIssue.
// =============================================================================

export async function insertChangeOrder(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    changeOrderId?: string;
    name: string;
    type: (typeof changeOrderType)[number];
    approvalType: (typeof changeOrderApprovalType)[number];
    priority?: (typeof changeOrderPriority)[number];
    openDate: string;
    description?: Json;
    changeOrderTypeId?: string;
    changeOrderWorkflowId?: string;
    dueDate?: string;
    effectiveDate?: string;
    requiredActionIds?: string[];
    // Picked approver GROUP ids (persisted to changeOrder.approvalRequirements).
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
        error:
          seq.error ??
          ({
            message: "Failed to generate changeOrder sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    changeOrderId = seq.data;
  }

  const { items, approvers, ...data } = input;

  // Split the approver picker output into group ids and individual user ids.
  // verbose-prefixed values arrive as "group_<id>" / "user_<id>".
  const approverPicks = approvers ?? [];
  const approverGroupIds = approverPicks
    .filter((a) => a.startsWith("group_"))
    .map((a) => a.slice(6));
  const approverUserIds = approverPicks
    .filter((a) => a.startsWith("user_"))
    .map((a) => a.slice(5));

  // insertChangeOrder runs under the service role (bypassRls) so RLS won't catch
  // a client smuggling in item / approver ids that belong to ANOTHER company.
  // Validate every supplied id resolves within this company before trusting it.
  if (items && items.length > 0) {
    const validItems = await client
      .from("item")
      .select("id")
      .in("id", items)
      .eq("companyId", input.companyId);
    if (validItems.error) return { data: null, error: validItems.error };
    const validItemIds = new Set((validItems.data ?? []).map((i) => i.id));
    if (items.some((id) => !validItemIds.has(id))) {
      return {
        data: null,
        error: {
          message: "One or more items do not belong to this company"
        } as import("@supabase/supabase-js").PostgrestError
      };
    }
  }

  if (approverGroupIds.length > 0) {
    const validGroups = await client
      .from("group")
      .select("id")
      .in("id", approverGroupIds)
      .eq("companyId", input.companyId);
    if (validGroups.error) return { data: null, error: validGroups.error };
    const validGroupIds = new Set((validGroups.data ?? []).map((g) => g.id));
    if (approverGroupIds.some((id) => !validGroupIds.has(id))) {
      return {
        data: null,
        error: {
          message: "One or more approver groups do not belong to this company"
        } as import("@supabase/supabase-js").PostgrestError
      };
    }
  }

  if (approverUserIds.length > 0) {
    const validUsers = await client
      .from("userToCompany")
      .select("userId")
      .in("userId", approverUserIds)
      .eq("companyId", input.companyId);
    if (validUsers.error) return { data: null, error: validUsers.error };
    const validUserIds = new Set((validUsers.data ?? []).map((u) => u.userId));
    if (approverUserIds.some((id) => !validUserIds.has(id))) {
      return {
        data: null,
        error: {
          message: "One or more approvers do not belong to this company"
        } as import("@supabase/supabase-js").PostgrestError
      };
    }
  }

  // Persist the picked GROUP ids in approvalRequirements (repurposed column).
  // Fall back to any explicitly-passed approvalRequirements when no picker
  // groups were supplied (keeps the field free-form per Task 13).
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
      changeOrderTypeId: data.changeOrderTypeId ?? null,
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
    return { data: null, error: result.error };
  }

  const coId = result.data.id;

  if (items && items.length > 0) {
    // Seed each affected item through the shared attach path so the create flow
    // honors the one-open-CO-per-item guard AND stages a pending revision for
    // Engineering COs (the previous bare insert did neither, leaving Engineering
    // COs unreleasable). Best-effort per item — a guard rejection skips that
    // item rather than aborting the whole create.
    for (const itemId of items) {
      const attached = await attachAffectedItem(client, {
        changeOrderId: coId,
        itemId,
        userId: input.createdBy,
        companyId: input.companyId,
        type: data.type
      });
      if (attached.error) {
        console.error(attached.error);
      }
    }
  }

  // Resolve the picked approvers to a deduped set of user ids: expand the
  // picked groups via the users_for_groups RPC, then merge with the picked
  // individual users. One changeOrderReviewer is seeded per resolved user
  // (status Pending) — this is the single source of truth for reviewers; the
  // create edge function no longer seeds placeholder reviewers.
  const fromGroups =
    approverGroupIds.length > 0
      ? await client.rpc("users_for_groups", { groups: approverGroupIds })
      : { data: [] as string[], error: null };

  if (fromGroups.error) {
    console.error(fromGroups.error);
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
      console.error(users.error);
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
      console.error(reviewerInsert);
    }
  }

  // Spawn the configured action/approval tasks + reviewers via the create edge
  // function (mirrors how insertIssue triggers "nonConformanceTasks").
  const tasks = await client.functions.invoke("create", {
    body: {
      type: "changeOrderTasks",
      id: coId,
      companyId: input.companyId,
      userId: input.createdBy
    }
  });

  if (tasks.error) {
    console.error(tasks.error);
  }

  return {
    data: { id: coId, changeOrderId: result.data.changeOrderId },
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
    approvalType?: (typeof changeOrderApprovalType)[number];
    priority?: (typeof changeOrderPriority)[number] | null;
    openDate?: string;
    description?: Json;
    changeOrderTypeId?: string | null;
    changeOrderWorkflowId?: string | null;
    dueDate?: string | null;
    effectiveDate?: string | null;
    requiredActionIds?: string[];
    // Free-form per Task 13 (stores picked approver GROUP ids).
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

export async function updateChangeOrderStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof changeOrderStatus)[number];
    assignee?: string | null;
    effectiveDate?: string | null;
    updatedBy: string;
  }
) {
  // Destructure the PK out before the update so we don't write id back onto
  // itself (it is only the row selector, never a column to set).
  const { id, ...rest } = update;
  return client.from("changeOrder").update(sanitize(rest)).eq("id", id);
}

// =============================================================================
// applyChangeOrderReviewerDecision — records the current user's reviewer
// decision (approve/reject) and applies the peer-review threshold.
//
//   - The CO must be In Review and the caller must own a reviewer row.
//   - Reject: reset every reviewer to Pending, store {reason, decision} on the
//     caller's row, and send the CO back to Draft.
//   - Approve: mark the caller's row Completed (+ reason), then re-evaluate the
//     threshold; if met the CO auto-advances to Approved, else it stays In
//     Review awaiting the remaining sign-offs.
// =============================================================================

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
    // Reset every reviewer back to Pending so a fresh review starts after the
    // author addresses the rejection. Clear notes too, so a stale
    // {reason, decision} from a prior round doesn't surface next round (the
    // rejecting reviewer's own note is re-stamped immediately below).
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

    // Record the rejecting reviewer's reason on their own row.
    const note = await client
      .from("changeOrderReviewer")
      .update({ notes: { reason, decision: "reject" }, updatedBy: userId })
      .eq("id", mine.id);
    if (note.error) return { data: null, error: note.error };

    const status = await updateChangeOrderStatus(client, {
      id: changeOrderId,
      status: "Draft",
      updatedBy: userId
    });
    if (status.error) return { data: null, error: status.error };

    return { data: { status: "Draft", autoAdvanced: false }, error: null };
  }

  // Approve — mark the caller's reviewer row Completed with their reason.
  const record = await client
    .from("changeOrderReviewer")
    .update({
      status: "Completed",
      completedDate: today,
      notes: { reason, decision: "approve" },
      updatedBy: userId
    })
    .eq("id", mine.id);
  if (record.error) return { data: null, error: record.error };

  // Re-evaluate the threshold by RE-FETCHING the reviewer set from the DB (not
  // the pre-write in-memory snapshot). A concurrent second approval that landed
  // between our read and write is then reflected, so the CO is never left stuck
  // In Review when the threshold has actually been met.
  return reevaluateChangeOrderApproval(
    client,
    changeOrderId,
    userId,
    companyId
  );
}

// =============================================================================
// reevaluateChangeOrderApproval — single source of truth for auto-advancing a
// CO from In Review → Approved. Called from BOTH the reviewer-decision path
// (applyChangeOrderReviewerDecision) AND the generic reviewer-task-completion
// path (the task.$id.status route, when a reviewer marks their row Completed),
// so any reviewer completion can auto-advance regardless of entry point.
//
// Always re-reads the live reviewer set from the DB, so it is race-safe against
// concurrent approvals.
// =============================================================================

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

  // Only an In Review CO can auto-advance. Anything else is a no-op.
  if (co.data.status !== "In Review") {
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

  if (met) {
    const status = await updateChangeOrderStatus(client, {
      id: changeOrderId,
      status: "Approved",
      updatedBy: userId
    });
    if (status.error) return { data: null, error: status.error };
    return { data: { status: "Approved", autoAdvanced: true }, error: null };
  }

  return { data: { status: "In Review", autoAdvanced: false }, error: null };
}

// =============================================================================
// getChangeOrderNotificationRecipients — resolves the set of user ids to notify
// on a change-order transition: every reviewer (changeOrderReviewer.assignee)
// plus every affected item's assignee (item.assignee), deduped,
// nulls skipped. Pure data fetch — the trigger("notify") call lives in the
// server-only notifyChangeOrderTransition helper.
// =============================================================================

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
  for (const it of items.data ?? []) {
    if (it.assignee) ids.add(it.assignee);
  }
  return [...ids];
}

export async function updateChangeOrderTaskStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    status: "Pending" | "In Progress" | "Completed" | "Skipped";
    type: "action" | "approval" | "review";
    userId?: string;
    assignee?: string | null;
  }
) {
  const { id, status, type, userId, assignee } = args;
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
    .select("changeOrderId")
    .single();
}

export async function updateChangeOrderTaskContent(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    type: "action" | "approval" | "review";
    content: JSONContent;
  }
) {
  const { id, content, type } = args;
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
    .select("changeOrderId")
    .single();
}

// =============================================================================
// Affected items (associations) — add / delete.
// =============================================================================

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
// change order. Loads the row (scoped by company) with its parent CO status +
// staged pending revision, enforces the draft-only edit window, deletes the
// orphaned pending revision (cascades its makeMethod / materials and frees the
// next-revision slot), then removes the association. Shared by the fetcher
// "delete" intent (item.update) and the ConfirmDelete route (item.delete) so
// both surfaces enforce the same guard.
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

// =============================================================================
// attachAffectedItem — the single path for associating an item with a change
// order. It (a) enforces the at-most-one-open-CO-per-item invariant via
// getOpenChangeOrderForItem, (b) inserts the changeOrderItem row, and (c) for
// Engineering COs stages a pending revision (createPendingRevision) so the
// redline / release path has somewhere to record the change.
//
// Shared by BOTH the create flow (insertChangeOrder, per seeded item) AND the
// incremental add flow (the change-order/item.update "add" route), so neither
// can bypass the concurrency guard or skip the pending revision — without this,
// the primary "Create Change Order" flow produced an Engineering CO whose
// affected item had no pending revision, which blocks release permanently.
// =============================================================================

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
      // Roll back the association row we just inserted. Otherwise it persists
      // with pendingItemId=null AND occupies the (changeOrderId, itemId) unique
      // slot, so a clean retry is impossible. Best-effort — surface the original
      // revision error regardless of whether the cleanup delete succeeds.
      await deleteChangeOrderItem(client, insert.data.id);
      return { data: null, error: revision.error };
    }
  }

  return { data: { id: insert.data.id }, error: null };
}

// A change order is "open" until it is Released or Cancelled. An item may be on
// at most one open change order at a time (mirrors Duro's core concurrency
// guarantee), so two in-flight change orders can't race the same item.
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

// =============================================================================
// Type / workflow upserts (clone upsertIssueType / upsertIssueWorkflow).
// =============================================================================

export async function upsertChangeOrderType(
  client: SupabaseClient<Database>,
  changeOrderType:
    | (Omit<z.infer<typeof changeOrderTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof changeOrderTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in changeOrderType) {
    return client
      .from("changeOrderType")
      .insert([changeOrderType])
      .select("id");
  }
  return client
    .from("changeOrderType")
    .update(sanitize(changeOrderType))
    .eq("id", changeOrderType.id);
}

export async function upsertChangeOrderWorkflow(
  client: SupabaseClient<Database>,
  // The changeOrderWorkflow table stores the template payload (priority,
  // approvalType, approvers) inside the `content` JSON column — there are no
  // dedicated priority/approvalType/approvers columns. The routes serialize the
  // validated form fields into `content` before calling this, so the upsert
  // accepts the real columns (name + content) rather than the validator shape.
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

export async function deleteChangeOrderType(
  client: SupabaseClient<Database>,
  changeOrderTypeId: string
) {
  return client.from("changeOrderType").delete().eq("id", changeOrderTypeId);
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

// =============================================================================
// createPendingRevision — change-order-specific.
//
// Loads the current item, computes the next revision, calls createRevision()
// (which clones the item row + deep-copies its full method when not Buy), then
// stamps changeOrderItem.pendingItemId with the new item id so the redline /
// release path knows where the in-progress revision lives.
// =============================================================================

/**
 * Mirrors getNextRevision() in
 * apps/erp/app/modules/items/ui/Item/UsedIn.tsx — numeric → +1, single/double
 * letter → next letter (Z → AA, …Z → next first letter + A).
 */
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

  // Compute the next revision against ALL existing revisions of this item (not
  // just the affected row's), so the pending revision never collides with one
  // that already exists — the item unique key is (readableId, revision,
  // companyId, type), so a stale base revision would otherwise fail the insert.
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
  // via the get-method edge function (its `parts` validator defaults every part
  // — BOM/BOP/parameters/tools/steps/work instructions — to true). Do NOT issue a
  // second copyItem() here: that would duplicate every material and operation row.

  const link = await client
    .from("changeOrderItem")
    .update({ pendingItemId: newItemId, updatedBy: userId })
    .eq("id", changeOrderItemId);

  if (link.error) {
    // The revision item + its make method were already created, but the link
    // update failed, so the caller never learns the new id and the row would be
    // orphaned. Roll back internally: deleting the item cascades its makeMethod /
    // materials. Best-effort — surface the original link error regardless.
    await client.from("item").delete().eq("id", newItemId);
    return { data: null, error: link.error };
  }

  return { data: { id: newItemId, revision }, error: null };
}
