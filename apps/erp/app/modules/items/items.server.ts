import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanySettings } from "~/modules/settings";
import type { plmReleaseControl } from "./changeOrder.models";

// =============================================================================
// Release-lock helpers — gate BOM/BOP mutations on a released (Production)
// revision. A Production revision is the controlled, released make method;
// changes must flow through a change order. The pending revision an ECO creates
// is Design/Prototype (NOT Production), so it stays editable.
// =============================================================================

export type ReleaseControl = (typeof plmReleaseControl)[number];

export const LOCKED_REVISION_MESSAGE =
  "This revision is released (Production). Open a change order to modify it.";

export type RevisionLock = {
  isLocked: boolean;
  releaseControl: ReleaseControl;
  revisionStatus: string | null;
};

// Resolve the parent item of a make method: makeMethod.itemId -> item.
export async function getItemIdForMakeMethod(
  client: SupabaseClient<Database>,
  makeMethodId: string
): Promise<string | null> {
  const makeMethod = await client
    .from("makeMethod")
    .select("itemId")
    .eq("id", makeMethodId)
    .single();

  return makeMethod.data?.itemId ?? null;
}

// Resolve the parent item of a method operation:
// methodOperation.makeMethodId -> makeMethod.itemId -> item.
export async function getItemIdForOperation(
  client: SupabaseClient<Database>,
  operationId: string
): Promise<string | null> {
  const operation = await client
    .from("methodOperation")
    .select("makeMethodId")
    .eq("id", operationId)
    .single();

  if (!operation.data?.makeMethodId) return null;
  return getItemIdForMakeMethod(client, operation.data.makeMethodId);
}

// Resolve the parent item of a method material:
// methodMaterial.makeMethodId -> makeMethod.itemId -> item.
export async function getItemIdForMaterial(
  client: SupabaseClient<Database>,
  materialId: string
): Promise<string | null> {
  const material = await client
    .from("methodMaterial")
    .select("makeMethodId")
    .eq("id", materialId)
    .single();

  if (!material.data?.makeMethodId) return null;
  return getItemIdForMakeMethod(client, material.data.makeMethodId);
}

// Resolve the parent item of a method operation step:
// methodOperationStep.operationId -> methodOperation -> makeMethod -> item.
export async function getItemIdForStep(
  client: SupabaseClient<Database>,
  stepId: string
): Promise<string | null> {
  const step = await client
    .from("methodOperationStep")
    .select("operationId")
    .eq("id", stepId)
    .single();

  if (!step.data?.operationId) return null;
  return getItemIdForOperation(client, step.data.operationId);
}

// Resolve the parent item of a method operation tool:
// methodOperationTool.operationId -> methodOperation -> makeMethod -> item.
export async function getItemIdForTool(
  client: SupabaseClient<Database>,
  toolId: string
): Promise<string | null> {
  const tool = await client
    .from("methodOperationTool")
    .select("operationId")
    .eq("id", toolId)
    .single();

  if (!tool.data?.operationId) return null;
  return getItemIdForOperation(client, tool.data.operationId);
}

// Resolve the parent item of a method operation parameter:
// methodOperationParameter.operationId -> methodOperation -> makeMethod -> item.
export async function getItemIdForParameter(
  client: SupabaseClient<Database>,
  parameterId: string
): Promise<string | null> {
  const parameter = await client
    .from("methodOperationParameter")
    .select("operationId")
    .eq("id", parameterId)
    .single();

  if (!parameter.data?.operationId) return null;
  return getItemIdForOperation(client, parameter.data.operationId);
}

// Resolve the release control setting + whether the given item's revision is
// locked. A revision is locked ONLY when it is "Production". Callers decide how
// to act based on `releaseControl` (enforce blocks, warn flashes, off no-ops).
export async function getRevisionLock(
  client: SupabaseClient<Database>,
  args: { itemId: string | null; companyId: string }
): Promise<RevisionLock> {
  const settings = await getCompanySettings(client, args.companyId);
  const releaseControl = (settings.data?.plmReleaseControl ??
    "enforce") as ReleaseControl;

  if (!args.itemId) {
    return { isLocked: false, releaseControl, revisionStatus: null };
  }

  const item = await client
    .from("item")
    .select("revisionStatus")
    .eq("id", args.itemId)
    .single();

  const revisionStatus = item.data?.revisionStatus ?? null;
  const isLocked = revisionStatus === "Production";

  return { isLocked, releaseControl, revisionStatus };
}
