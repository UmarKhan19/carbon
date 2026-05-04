// Server-only helpers for the Item Rules feature.
// Loader for per-item Rules tabs + evaluator entry points used by transaction
// triggers (receipt, shipment, stock transfer, job operations).

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  type CompiledRule,
  type ConditionAst,
  compileWithCache,
  evaluateRules,
  type RuleContext,
  type Severity,
  type Violation
} from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import {
  getActiveRulesForItem,
  getItemRulesList,
  getRuleAssignmentsForItem
} from "./items.service";

export async function loadRulesTabData({
  request,
  itemId
}: {
  request: LoaderFunctionArgs["request"];
  itemId: string;
}) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const [assignmentsRes, libraryRes] = await Promise.all([
    getRuleAssignmentsForItem(client, itemId, companyId),
    getItemRulesList(client, companyId)
  ]);

  const assignmentsRaw = assignmentsRes.data ?? [];
  const assignments = assignmentsRaw.flatMap((row) => {
    const rule = (row as { itemRule: unknown }).itemRule;
    const node = Array.isArray(rule) ? rule[0] : rule;
    if (!node) return [];
    return [
      {
        ruleId: row.ruleId as string,
        rule: node as {
          id: string;
          name: string;
          severity: Severity;
          message: string;
          active: boolean;
        }
      }
    ];
  });

  return {
    assignments,
    library: libraryRes.data ?? []
  };
}

/**
 * Loads + compiles all active rules bound to an item.
 * Single JOIN — no N+1.
 */
export async function loadCompiledRulesForItem(
  client: Parameters<typeof getActiveRulesForItem>[0],
  itemId: string,
  companyId: string
): Promise<CompiledRule[]> {
  const { data } = await getActiveRulesForItem(client, itemId, companyId);
  const compiled: CompiledRule[] = [];
  for (const row of data) {
    compiled.push(
      compileWithCache({
        ...row,
        conditionAst: row.conditionAst as ConditionAst
      })
    );
  }
  return compiled;
}

/**
 * Evaluate all compiled rules in `ctx`. Caller decides what to do with violations.
 */
export function evaluateForItem(
  rules: CompiledRule[],
  ctx: RuleContext
): Violation[] {
  return evaluateRules(rules, ctx);
}

/**
 * Decide whether to short-circuit a transaction based on violations + ack flag.
 * - Any error: blocked (must surface modal, no save)
 * - Warns only + not acknowledged: blocked (modal opens, user can ack & retry)
 * - Warns only + acknowledged: not blocked
 * - No violations: not blocked
 */
export function isBlocked(violations: Violation[], acknowledged: boolean) {
  if (violations.some((v) => v.severity === "error")) return true;
  if (violations.length === 0) return false;
  return !acknowledged;
}
