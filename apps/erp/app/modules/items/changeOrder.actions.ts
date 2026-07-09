import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { changeOrderTaskStatus } from "./changeOrder.models";

// =============================================================================
// Change Orders — Actions (freeform tasks; reuse changeOrderActionTask). Any
// user, any stage; non-gating. Split out of changeOrder.service.ts to keep
// each file focused and under the module's 1000-line budget (G4).
// =============================================================================
export async function getChangeOrderActions(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
) {
  return client
    .from("changeOrderActionTask")
    .select("*")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function upsertChangeOrderAction(
  client: SupabaseClient<Database>,
  input: {
    id?: string;
    changeOrderId: string;
    name: string;
    assignee?: string | null;
    dueDate?: string | null;
    companyId: string;
    userId: string;
  }
) {
  if (input.id) {
    return client
      .from("changeOrderActionTask")
      .update({
        name: input.name,
        assignee: input.assignee ?? null,
        dueDate: input.dueDate ?? null,
        updatedBy: input.userId
      })
      .eq("id", input.id)
      .select("id")
      .single();
  }

  return client
    .from("changeOrderActionTask")
    .insert({
      changeOrderId: input.changeOrderId,
      name: input.name,
      assignee: input.assignee ?? null,
      dueDate: input.dueDate ?? null,
      status: "Pending",
      companyId: input.companyId,
      createdBy: input.userId
    })
    .select("id")
    .single();
}

export async function updateChangeOrderActionStatus(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    status: (typeof changeOrderTaskStatus)[number];
    userId: string;
  }
) {
  const today = new Date().toISOString().split("T")[0];
  return client
    .from("changeOrderActionTask")
    .update({
      status: input.status,
      completedDate: input.status === "Completed" ? today : null,
      updatedBy: input.userId
    })
    .eq("id", input.id)
    .select("id")
    .single();
}

export async function deleteChangeOrderAction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderActionTask").delete().eq("id", id);
}

// Bulk reorder (drag-sort) — a multi-row write, so Kysely (route passes
// getDatabaseClient()).
export async function updateChangeOrderActionOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("changeOrderActionTask")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}
