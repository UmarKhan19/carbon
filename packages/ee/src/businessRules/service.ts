// Cross-app DB queries for Business Rules. Both ERP (admin UI, item/storage
// surfaces) and MES (workCenter surfaces) import from here.
//
// ERP-only admin CRUD (list/upsert/delete) stays in the ERP module — it
// depends on ERP request-utils (GenericQueryFilters, sanitize) that don't
// belong in the EE package.

import type { Database } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type {
  BusinessRuleRow,
  Severity,
  TargetType,
  TransactionSurface
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

const assignmentTableFor = (
  targetType: TargetType
):
  | "businessRuleItemAssignment"
  | "businessRuleStorageUnitAssignment"
  | "businessRuleWorkCenterAssignment" => {
  switch (targetType) {
    case "item":
      return "businessRuleItemAssignment";
    case "storageUnit":
      return "businessRuleStorageUnitAssignment";
    case "workCenter":
      return "businessRuleWorkCenterAssignment";
  }
};

const targetIdColumnFor = (
  targetType: TargetType
): "itemId" | "storageUnitId" | "workCenterId" => {
  switch (targetType) {
    case "item":
      return "itemId";
    case "storageUnit":
      return "storageUnitId";
    case "workCenter":
      return "workCenterId";
  }
};

type RuleRowSelect = Pick<
  BusinessRuleRow,
  | "id"
  | "targetType"
  | "severity"
  | "message"
  | "conditionAst"
  | "surfaces"
  | "updatedAt"
  | "active"
>;

/**
 * Loads active rules applicable to a set of targets of one targetType.
 *
 * Map keys are targetIds. Rules with `appliesToAll = TRUE` are unioned across
 * every passed-in targetId so the call site sees one flat list per target.
 *
 * Two round-trips: explicit-assignments + appliesToAll-broadcast.
 */
export async function getActiveRulesForTargets(
  client: SupabaseClient<Database>,
  args: {
    targetType: TargetType;
    targetIds: string[];
    companyId: string;
  }
): Promise<{ data: Map<string, BusinessRuleRow[]>; error: unknown }> {
  const out = new Map<string, BusinessRuleRow[]>();
  if (args.targetIds.length === 0) return { data: out, error: null };

  const ruleCols =
    "id, targetType, severity, message, conditionAst, surfaces, updatedAt, active";

  const table = assignmentTableFor(args.targetType);
  const idCol = targetIdColumnFor(args.targetType);

  const explicit = await (client as SupabaseClient<Database>)
    .from(table)
    .select(`${idCol}, businessRule:ruleId(${ruleCols})`)
    .in(idCol, args.targetIds)
    .eq("companyId", args.companyId);

  if (explicit.error) return { data: out, error: explicit.error };

  for (const r of explicit.data ?? []) {
    const row = r as unknown as {
      [k: string]: unknown;
      businessRule: RuleRowSelect | RuleRowSelect[] | null;
    };
    const targetId = row[idCol] as string;
    const node = Array.isArray(row.businessRule)
      ? row.businessRule[0]
      : row.businessRule;
    if (!node || node.active === false) continue;
    if (node.targetType !== args.targetType) continue;
    const bucket = out.get(targetId);
    if (bucket) bucket.push(node as BusinessRuleRow);
    else out.set(targetId, [node as BusinessRuleRow]);
  }

  const broadcast = await client
    .from("businessRule")
    .select(ruleCols)
    .eq("companyId", args.companyId)
    .eq("targetType", args.targetType)
    .eq("appliesToAll", true)
    .eq("active", true);

  if (broadcast.error) return { data: out, error: broadcast.error };

  const broadcastRules = (broadcast.data ?? []) as unknown as BusinessRuleRow[];
  if (broadcastRules.length > 0) {
    for (const targetId of args.targetIds) {
      const bucket = out.get(targetId);
      if (bucket) bucket.push(...broadcastRules);
      else out.set(targetId, [...broadcastRules]);
    }
  }

  return { data: out, error: null };
}

export async function getRuleAssignmentsForTarget(
  client: SupabaseClient<Database>,
  args: { targetType: TargetType; targetId: string; companyId: string }
) {
  const table = assignmentTableFor(args.targetType);
  const idCol = targetIdColumnFor(args.targetType);

  return (client as SupabaseClient<Database>)
    .from(table)
    .select(
      `${idCol}, ruleId, createdAt, businessRule:ruleId(id, name, targetType, severity, message, active, surfaces, appliesToAll)`
    )
    .eq(idCol, args.targetId)
    .eq("companyId", args.companyId);
}

export async function getBusinessRulesList(
  client: SupabaseClient<Database>,
  companyId: string,
  targetType?: TargetType
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    targetType: TargetType;
    severity: Severity;
    active: boolean;
    appliesToAll: boolean;
    surfaces: TransactionSurface[];
  }>(
    client,
    "businessRule",
    "id, name, targetType, severity, active, appliesToAll, surfaces",
    (query) => {
      let q = query.eq("companyId", companyId).order("name");
      if (targetType) q = q.eq("targetType", targetType);
      return q;
    }
  );
}

export async function assignBusinessRule(
  client: SupabaseClient<Database>,
  args: {
    targetType: TargetType;
    targetId: string;
    ruleId: string;
    companyId: string;
    userId: string;
  }
) {
  const table = assignmentTableFor(args.targetType);
  const idCol = targetIdColumnFor(args.targetType);

  return (client as SupabaseClient<Database>)
    .from(table)
    .insert({
      [idCol]: args.targetId,
      ruleId: args.ruleId,
      companyId: args.companyId,
      createdBy: args.userId
    } as never)
    .select(`${idCol}, ruleId`)
    .single();
}

export async function unassignBusinessRule(
  client: SupabaseClient<Database>,
  args: { targetType: TargetType; targetId: string; ruleId: string }
) {
  const table = assignmentTableFor(args.targetType);
  const idCol = targetIdColumnFor(args.targetType);

  return (client as SupabaseClient<Database>)
    .from(table)
    .delete()
    .eq(idCol, args.targetId)
    .eq("ruleId", args.ruleId);
}
