// Server-side business-rules evaluator. Cross-app entry point — ERP
// (item/storageUnit surfaces) and MES (workCenter surfaces) both call
// `evaluateLinesForSurface`.
//
// All functions here are server-only. Never import from a client module.

import type { Database } from "@carbon/database";
import {
  type CompiledRule,
  type Condition,
  type ConditionAst,
  compileWithCache,
  evaluateRules,
  getFieldDef,
  type RuleContext,
  type Severity,
  type TargetType,
  type TransactionSurface,
  type ValueOptionsLoader,
  type Violation
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { companyHasPlan } from "../plan.server";
import {
  getActiveRulesForTargets,
  getBusinessRulesList,
  getRuleAssignmentsForTarget
} from "./service";

type Client = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Plan gate
// ---------------------------------------------------------------------------

export const isBusinessRulesEnabledForCompany = (
  client: Client,
  companyId: string
): Promise<boolean> =>
  companyHasPlan(client, companyId, { feature: "BUSINESS_RULES" });

// ---------------------------------------------------------------------------
// Block decision
// ---------------------------------------------------------------------------

/** Any error blocks unconditionally. Warns block until acknowledged. */
export const isBlocked = (
  violations: Violation[],
  acknowledged: boolean
): boolean => {
  for (let i = 0; i < violations.length; i++) {
    if (violations[i]!.severity === "error") return true;
  }
  return violations.length > 0 && !acknowledged;
};

/**
 * Collapse violations by `ruleId + message`. Call when accumulating results
 * from multiple `evaluateLinesForSurface` invocations (e.g. item pass +
 * storageUnit pass on the same receipt).
 */
export const dedupeViolations = (violations: Violation[]): Violation[] => {
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (let i = 0; i < violations.length; i++) {
    const v = violations[i]!;
    const key = `${v.ruleId}\x00${v.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Per-target Rules tab data (loader helper)
// ---------------------------------------------------------------------------

type AssignedRuleNode = {
  id: string;
  name: string;
  targetType: TargetType;
  severity: Severity;
  message: string;
  active: boolean;
  surfaces: TransactionSurface[];
  appliesToAll: boolean;
};

export async function getBusinessRulesDataForTarget(
  client: Client,
  args: { targetType: TargetType; targetId: string; companyId: string }
) {
  const [assignmentsRes, libraryRes] = await Promise.all([
    getRuleAssignmentsForTarget(client, args),
    getBusinessRulesList(client, args.companyId, args.targetType)
  ]);

  const assignments: { ruleId: string; rule: AssignedRuleNode }[] = [];
  for (const row of assignmentsRes.data ?? []) {
    const joined = (
      row as { businessRule: AssignedRuleNode | AssignedRuleNode[] | null }
    ).businessRule;
    const rule = Array.isArray(joined) ? joined[0] : joined;
    if (!rule) continue;
    assignments.push({ ruleId: row.ruleId as string, rule });
  }

  return { assignments, library: libraryRes.data ?? [] };
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

async function loadCompiledRulesForTargets(
  client: Client,
  args: { targetType: TargetType; targetIds: string[]; companyId: string }
): Promise<Map<string, CompiledRule[]>> {
  const out = new Map<string, CompiledRule[]>();
  if (args.targetIds.length === 0) return out;

  const { data: byTarget } = await getActiveRulesForTargets(client, args);
  for (const [targetId, rows] of byTarget) {
    const compiled = new Array<CompiledRule>(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      compiled[i] = compileWithCache({
        ...row,
        conditionAst: row.conditionAst as ConditionAst
      });
    }
    out.set(targetId, compiled);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loader-label resolver — UUID condition values → human labels
// ---------------------------------------------------------------------------

type LoaderFn = (
  client: Client,
  companyId: string
) => Promise<{ id: string; name: string }[]>;

// Inline-table loaders. Each pulls (id, name) for one entity type scoped by
// company. No ERP-app-utils dependency — keeps this file portable across apps.
const LOADERS: Record<ValueOptionsLoader, LoaderFn | null> = {
  locations: async (c, id) => {
    const { data } = await c
      .from("location")
      .select("id, name")
      .eq("companyId", id);
    return (data ?? []) as { id: string; name: string }[];
  },
  storageTypes: async (c, id) => {
    const { data } = await c
      .from("storageType")
      .select("id, name")
      .eq("companyId", id);
    return (data ?? []) as { id: string; name: string }[];
  },
  // Static enums — value is already the label.
  itemTypes: null,
  replenishmentSystems: null,
  itemTrackingTypes: null
};

const EMPTY_RESOLVER = (): undefined => undefined;

async function buildConditionValueResolver(
  client: Client,
  companyId: string,
  conditions: Iterable<Condition>
): Promise<(cond: Condition) => string | undefined> {
  const byLoader = new Map<ValueOptionsLoader, Set<string>>();
  for (const cond of conditions) {
    const def = getFieldDef(cond.field);
    if (!def?.valueOptionsLoader || def.type !== "id") continue;
    if (LOADERS[def.valueOptionsLoader] === null) continue;
    if (cond.value == null) continue;

    let bucket = byLoader.get(def.valueOptionsLoader);
    if (!bucket) {
      bucket = new Set<string>();
      byLoader.set(def.valueOptionsLoader, bucket);
    }
    if (Array.isArray(cond.value)) {
      for (const v of cond.value) bucket.add(String(v));
    } else {
      bucket.add(String(cond.value));
    }
  }

  if (byLoader.size === 0) return EMPTY_RESOLVER;

  const labels = new Map<ValueOptionsLoader, Map<string, string>>();
  await Promise.all(
    Array.from(byLoader.keys()).map(async (loader) => {
      const fn = LOADERS[loader]!;
      const rows = await fn(client, companyId);
      const map = new Map<string, string>();
      for (const r of rows) map.set(r.id, r.name);
      labels.set(loader, map);
    })
  );

  return (cond: Condition): string | undefined => {
    if (cond.value == null) return undefined;
    const def = getFieldDef(cond.field);
    const map = def?.valueOptionsLoader
      ? labels.get(def.valueOptionsLoader)
      : undefined;

    if (Array.isArray(cond.value)) {
      if (cond.value.length === 0) return "—";
      const out: string[] = [];
      for (const v of cond.value) {
        const s = String(v);
        out.push(map?.get(s) ?? s);
      }
      return out.join(", ");
    }
    const s = String(cond.value);
    return map?.get(s) ?? s;
  };
}

// ---------------------------------------------------------------------------
// Per-line evaluator — single entry point trigger handlers call
// ---------------------------------------------------------------------------

export type RuleLineInput = {
  /** Diagnostic identifier — not used in eval. */
  lineId: string;
  /**
   * Item the line operates on. Required when `targetType === "item"`.
   * Available for context in storageUnit/workCenter passes too.
   */
  itemId?: string | null;
  /** Storage unit being interacted with. */
  storageUnitId?: string | null;
  /** Work center being operated. Required when `targetType === "workCenter"`. */
  workCenterId?: string | null;
  /** Operation context for workCenter passes. */
  operation?: {
    id?: string | null;
    itemId?: string | null;
    quantity?: number | null;
    workInstructionId?: string | null;
  };
  /** Quantity for `transaction.quantity` predicates. */
  quantity: number;
  locationId?: string | null;
};

export type EvaluateLinesForSurfaceArgs = {
  client: Client;
  companyId: string;
  userId: string;
  /**
   * Which targetType the call is evaluating. Surfaces that apply to multiple
   * targetTypes (e.g. `stockTransfer`) require one call per targetType — the
   * caller concatenates and `dedupeViolations`-es results.
   */
  targetType: TargetType;
  surface: TransactionSurface;
  lines: RuleLineInput[];
};

export type EvaluateLinesForSurfaceResult = {
  violations: Violation[];
  ruleNames: Record<string, string>;
};

const EMPTY_RESULT: EvaluateLinesForSurfaceResult = {
  violations: [],
  ruleNames: {}
};

type ItemCtxRow = Record<string, unknown> & {
  customFields?: Record<string, unknown>;
};
type StorageUnitCtxRow = Record<string, unknown> & {
  locationId?: string | null;
};
type WorkCenterCtxRow = Record<string, unknown>;

const lineTargetIdFor = (
  line: RuleLineInput,
  targetType: TargetType
): string | null => {
  switch (targetType) {
    case "item":
      return line.itemId ?? null;
    case "storageUnit":
      return line.storageUnitId ?? null;
    case "workCenter":
      return line.workCenterId ?? null;
  }
};

export async function evaluateLinesForSurface({
  client,
  companyId,
  userId,
  targetType,
  surface,
  lines
}: EvaluateLinesForSurfaceArgs): Promise<EvaluateLinesForSurfaceResult> {
  if (lines.length === 0) return EMPTY_RESULT;
  if (!(await isBusinessRulesEnabledForCompany(client, companyId)))
    return EMPTY_RESULT;

  const targetIds = new Set<string>();
  const itemIds = new Set<string>();
  const storageUnitIds = new Set<string>();
  const workCenterIds = new Set<string>();
  for (const line of lines) {
    const tid = lineTargetIdFor(line, targetType);
    if (tid) targetIds.add(tid);
    if (line.itemId) itemIds.add(line.itemId);
    if (line.storageUnitId) storageUnitIds.add(line.storageUnitId);
    if (line.workCenterId) workCenterIds.add(line.workCenterId);
    if (line.operation?.itemId) itemIds.add(line.operation.itemId);
  }
  if (targetIds.size === 0) return EMPTY_RESULT;

  const [itemsRes, storageUnitsRes, workCentersRes, compiledByTarget] =
    await Promise.all([
      itemIds.size > 0
        ? client
            .from("item")
            .select(
              "id, type, replenishmentSystem, itemTrackingType, name, readableId, customFields"
            )
            .in("id", Array.from(itemIds))
        : Promise.resolve({ data: [], error: null }),
      storageUnitIds.size > 0
        ? client
            .from("storageUnit")
            .select("id, storageTypeIds, warehouseId, name, locationId")
            .in("id", Array.from(storageUnitIds))
        : Promise.resolve({ data: [], error: null }),
      workCenterIds.size > 0
        ? client
            .from("workCenter")
            .select("id, locationId, active, name")
            .in("id", Array.from(workCenterIds))
        : Promise.resolve({ data: [], error: null }),
      loadCompiledRulesForTargets(client, {
        targetType,
        targetIds: Array.from(targetIds),
        companyId
      })
    ]);

  const itemsById = new Map<string, ItemCtxRow>();
  for (const it of itemsRes.data ?? []) {
    const row = it as Record<string, unknown>;
    const readable = row.readableId as string | undefined;
    itemsById.set(row.id as string, {
      ...row,
      id: readable ?? (row.id as string)
    });
  }

  const unitsById = new Map<string, StorageUnitCtxRow>();
  for (const u of storageUnitsRes.data ?? []) {
    const row = u as Record<string, unknown>;
    const ids = row.storageTypeIds as string[] | null | undefined;
    unitsById.set(row.id as string, {
      ...row,
      storageTypeId: ids && ids.length > 0 ? ids : undefined
    });
  }

  const wcById = new Map<string, WorkCenterCtxRow>();
  for (const w of workCentersRes.data ?? []) {
    const row = w as Record<string, unknown>;
    wcById.set(row.id as string, { ...row });
  }

  const resolveConditionValue = await buildConditionValueResolver(
    client,
    companyId,
    iterateConditions(compiledByTarget)
  );

  const violations: Violation[] = [];
  for (const line of lines) {
    const targetId = lineTargetIdFor(line, targetType);
    if (!targetId) continue;
    const compiled = compiledByTarget.get(targetId);
    if (!compiled || compiled.length === 0) continue;

    const storageUnit = line.storageUnitId
      ? unitsById.get(line.storageUnitId)
      : undefined;

    const ctx: RuleContext = {
      item: line.itemId ? itemsById.get(line.itemId) : undefined,
      storageUnit,
      workCenter: line.workCenterId ? wcById.get(line.workCenterId) : undefined,
      operation: line.operation
        ? {
            id: line.operation.id ?? undefined,
            itemId: line.operation.itemId ?? undefined,
            quantity: line.operation.quantity ?? undefined,
            workInstructionId: line.operation.workInstructionId ?? undefined
          }
        : undefined,
      transaction: {
        kind: surface,
        locationId: line.locationId ?? storageUnit?.locationId ?? null,
        quantity: line.quantity,
        userId
      }
    };

    const ruleViolations = evaluateRules(compiled, ctx, surface, {
      resolveConditionValue
    });
    for (let i = 0; i < ruleViolations.length; i++) {
      violations.push(ruleViolations[i]!);
    }
  }

  const deduped = dedupeViolations(violations);
  if (deduped.length === 0) {
    return { violations: deduped, ruleNames: {} };
  }

  const violatedIds = new Set<string>();
  for (let i = 0; i < deduped.length; i++) violatedIds.add(deduped[i]!.ruleId);

  const { data: namedRules } = await client
    .from("businessRule")
    .select("id, name")
    .in("id", Array.from(violatedIds));

  const ruleNames: Record<string, string> = {};
  for (const r of namedRules ?? []) {
    ruleNames[r.id as string] = r.name as string;
  }

  return { violations: deduped, ruleNames };
}

function* iterateConditions(
  compiledByTarget: Map<string, CompiledRule[]>
): Generator<Condition> {
  for (const rules of compiledByTarget.values()) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!;
      const conds = rule.conditions;
      for (let j = 0; j < conds.length; j++) yield conds[j]!;
    }
  }
}
