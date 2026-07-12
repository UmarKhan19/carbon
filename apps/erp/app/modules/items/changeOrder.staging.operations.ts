import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { sanitize } from "~/utils/supabase";
import type {
  changeOrderStagedOperationParameterValidator,
  changeOrderStagedOperationStepValidator,
  changeOrderStagedOperationToolValidator,
  changeOrderStagedOperationValidator
} from "./changeOrder.models";

// =============================================================================
// Change Orders — staged BOP operation CRUD (headers + children). Split out of
// changeOrder.staging.ts to keep each concern file under the module's 1000-line
// budget (G4). CO-owned mirror of methodOperation + its children
// (methodOperationStep / methodOperationParameter / methodOperationTool), scoped
// to an affected item / staged operation. Snapshotted on affected-item add (that
// snapshot logic STAYS in changeOrder.staging.ts's addChangeOrderAffectedItem);
// edited here to the desired end-state.
//
// All functions take the supabase client (or a Kysely db for transactions) as
// the first arg, return raw { data, error } (no throw), and scope by companyId.
// Reads use flat selects (no embeds). Enum-typed fields arrive as text from the
// validators and are cast to the generated Insert types (the DB enum is the real
// guard).
// =============================================================================

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
// (precedent: reorderChangeOrderStagedMaterials). Kysely bypasses RLS and
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
// Staged BOP operation CHILDREN (Task 16) — CO-owned mirrors of
// methodOperationStep / methodOperationParameter / methodOperationTool, scoped to
// a staged operation. Snapshotted on affected-item add (sourceId = live child
// id; NULL ⇒ added line); edited here to the desired end-state. Flat selects, no
// embeds. Enum-typed fields arrive as text from the validators and are cast to
// the generated Insert types (the DB enum is the real guard).
// -----------------------------------------------------------------------------

// --- Steps -------------------------------------------------------------------

export async function getChangeOrderStagedOperationSteps(
  client: SupabaseClient<Database>,
  stagedOperationId: string,
  companyId: string
) {
  return client
    .from("changeOrderStagedOperationStep")
    .select("*")
    .eq("stagedOperationId", stagedOperationId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true });
}

export async function upsertChangeOrderStagedOperationStep(
  client: SupabaseClient<Database>,
  input: z.infer<typeof changeOrderStagedOperationStepValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { id, companyId, userId, changeOrderId, stagedOperationId, ...rest } =
    input;

  type StepInsert =
    Database["public"]["Tables"]["changeOrderStagedOperationStep"]["Insert"];

  const payload = {
    name: rest.name,
    description: rest.description,
    type: rest.type as StepInsert["type"],
    required: rest.required,
    sortOrder: rest.sortOrder,
    unitOfMeasureCode: rest.unitOfMeasureCode,
    minValue: rest.minValue,
    maxValue: rest.maxValue
  };

  if (id) {
    return client
      .from("changeOrderStagedOperationStep")
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
    .from("changeOrderStagedOperationStep")
    .insert({
      changeOrderId,
      stagedOperationId,
      companyId,
      createdBy: userId,
      ...sanitize(payload)
    })
    .select("id")
    .single();
}

export async function deleteChangeOrderStagedOperationStep(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderStagedOperationStep").delete().eq("id", id);
}

// --- Parameters --------------------------------------------------------------

export async function getChangeOrderStagedOperationParameters(
  client: SupabaseClient<Database>,
  stagedOperationId: string,
  companyId: string
) {
  return client
    .from("changeOrderStagedOperationParameter")
    .select("*")
    .eq("stagedOperationId", stagedOperationId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}

export async function upsertChangeOrderStagedOperationParameter(
  client: SupabaseClient<Database>,
  input: z.infer<typeof changeOrderStagedOperationParameterValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { id, companyId, userId, changeOrderId, stagedOperationId, ...rest } =
    input;

  const payload = {
    key: rest.key,
    value: rest.value
  };

  if (id) {
    return client
      .from("changeOrderStagedOperationParameter")
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
    .from("changeOrderStagedOperationParameter")
    .insert({
      changeOrderId,
      stagedOperationId,
      companyId,
      createdBy: userId,
      ...sanitize(payload)
    })
    .select("id")
    .single();
}

export async function deleteChangeOrderStagedOperationParameter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("changeOrderStagedOperationParameter")
    .delete()
    .eq("id", id);
}

// --- Tools -------------------------------------------------------------------

export async function getChangeOrderStagedOperationTools(
  client: SupabaseClient<Database>,
  stagedOperationId: string,
  companyId: string
) {
  return client
    .from("changeOrderStagedOperationTool")
    .select("*")
    .eq("stagedOperationId", stagedOperationId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}

export async function upsertChangeOrderStagedOperationTool(
  client: SupabaseClient<Database>,
  input: z.infer<typeof changeOrderStagedOperationToolValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { id, companyId, userId, changeOrderId, stagedOperationId, ...rest } =
    input;

  const payload = {
    toolId: rest.toolId,
    quantity: rest.quantity
  };

  if (id) {
    return client
      .from("changeOrderStagedOperationTool")
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
    .from("changeOrderStagedOperationTool")
    .insert({
      changeOrderId,
      stagedOperationId,
      companyId,
      createdBy: userId,
      ...sanitize(payload)
    })
    .select("id")
    .single();
}

export async function deleteChangeOrderStagedOperationTool(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderStagedOperationTool").delete().eq("id", id);
}

// Combined fetch of a staged operation's children — one round of reads returning
// { steps, parameters, tools }. Convenience for the operation detail loader; each
// underlying read is the corresponding get above.
export async function getChangeOrderStagedOperationChildren(
  client: SupabaseClient<Database>,
  stagedOperationId: string,
  companyId: string
): Promise<{
  data: {
    steps: Database["public"]["Tables"]["changeOrderStagedOperationStep"]["Row"][];
    parameters: Database["public"]["Tables"]["changeOrderStagedOperationParameter"]["Row"][];
    tools: Database["public"]["Tables"]["changeOrderStagedOperationTool"]["Row"][];
  };
  error: { message: string } | null;
}> {
  const [steps, parameters, tools] = await Promise.all([
    getChangeOrderStagedOperationSteps(client, stagedOperationId, companyId),
    getChangeOrderStagedOperationParameters(
      client,
      stagedOperationId,
      companyId
    ),
    getChangeOrderStagedOperationTools(client, stagedOperationId, companyId)
  ]);

  const error = steps.error ?? parameters.error ?? tools.error;
  if (error) {
    return { data: { steps: [], parameters: [], tools: [] }, error };
  }

  return {
    data: {
      steps: steps.data ?? [],
      parameters: parameters.data ?? [],
      tools: tools.data ?? []
    },
    error: null
  };
}
