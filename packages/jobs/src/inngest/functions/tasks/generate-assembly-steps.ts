import type { Database, Json } from "@carbon/database";
import {
  type AssemblyGraph,
  type AssemblyGraphIndex,
  type AssemblyPlan,
  buildAssemblyStepGroups,
  CURRENT_PLAN_VERSION,
  indexAssemblyGraph
} from "@carbon/viewer/steps";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Generates draft assembly-instruction steps from a freshly computed plan — the
 * server-side twin of the ERP `generateAssemblyStepsFromPlan`, so clicking
 * "Generate Steps" completes whether or not the user stays on the page. No-op
 * when the instruction already has steps (the user may have authored them) or
 * the plan is stale. Uses only the three-free `@carbon/viewer/steps` entry.
 */
export async function generateAssemblyStepsFromPlan(
  client: SupabaseClient<Database>,
  args: {
    assemblyInstructionId: string;
    plan: AssemblyPlan;
    graphPath: string | null;
    companyId: string;
    userId: string;
  }
): Promise<{ created: number }> {
  if ((args.plan.version ?? 1) < CURRENT_PLAN_VERSION) return { created: 0 };

  const existing = await client
    .from("assemblyInstructionStep")
    .select("id")
    .eq("assemblyInstructionId", args.assemblyInstructionId)
    .limit(1);
  if ((existing.data ?? []).length > 0) return { created: 0 };

  // graph.json powers identical-part grouping + fallback motion synthesis.
  let graphIndex: AssemblyGraphIndex | null = null;
  if (args.graphPath) {
    const graphFile = await client.storage
      .from("private")
      .download(args.graphPath);
    if (graphFile.data) {
      try {
        const graph = JSON.parse(await graphFile.data.text()) as AssemblyGraph;
        graphIndex = indexAssemblyGraph(graph);
      } catch {
        // grouping degrades to per-part steps
      }
    }
  }

  const groups = buildAssemblyStepGroups(args.plan, graphIndex);
  if (groups.length === 0) return { created: 0 };

  const rows = groups.map((group, index) => ({
    assemblyInstructionId: args.assemblyInstructionId,
    sortOrder: index + 1,
    // A pre-grouped unit (e.g. a purchased PCB) titles its step with the unit
    // name; ungrouped steps derive their title from their parts.
    title: group.name ?? null,
    partNodeIds: group.partNodeIds,
    motion: group.motion as unknown as Json,
    warnings:
      group.blockedBy.length > 0
        ? ({ flagged: true, blockedBy: group.blockedBy } as Json)
        : null,
    planConfidence: group.confidence,
    status: "Review" as const,
    companyId: args.companyId,
    createdBy: args.userId
  }));

  const insert = await client.from("assemblyInstructionStep").insert(rows);
  if (insert.error) {
    throw new Error(`Failed to insert assembly steps: ${insert.error.message}`);
  }
  return { created: rows.length };
}
