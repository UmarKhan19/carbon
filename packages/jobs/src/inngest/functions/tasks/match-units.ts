import { openai } from "@ai-sdk/openai";
import type { AssemblyUnitCandidate } from "@carbon/utils";
import { generateObject } from "ai";
import { z } from "zod";

/**
 * Matches CAD subassembly nodes to BOM lines with an LLM so the motion planner
 * collapses a purchased subassembly (e.g. a PCB whose 3D model carries hundreds
 * of tiny child solids) into a single rigid unit instead of planning every
 * internal component.
 *
 * Returns nodeId → itemId matches for `deriveAssemblyUnits`. Degrades to `[]`
 * (deterministic hierarchy-only derivation) when there's nothing to match or the
 * OpenAI key is absent — the planner still works, it just won't attach BOM ids.
 */

const MODEL = "gpt-4o-mini";
const MIN_CONFIDENCE = 0.5;

const matchSchema = z.object({
  matches: z.array(
    z.object({
      nodeId: z.string().describe("The candidate subassembly's nodeId"),
      itemId: z
        .string()
        .nullable()
        .describe(
          "The BOM item id this whole subassembly IS, or null when the subassembly is a grouping of several distinct BOM parts"
        ),
      confidence: z.number().min(0).max(1)
    })
  )
});

type BomLine = { itemId: string; name: string | null };
export type NodeMatch = { nodeId: string; itemId: string };

export async function matchUnitsToBom(
  candidates: AssemblyUnitCandidate[],
  bom: BomLine[]
): Promise<NodeMatch[]> {
  if (candidates.length === 0 || bom.length === 0) return [];
  if (!process.env.OPENAI_API_KEY) return [];

  const bomText = bom
    .map((line) => `- ${line.itemId}: ${line.name ?? "(unnamed)"}`)
    .join("\n");
  const candidatesText = candidates
    .map(
      (c) =>
        `- nodeId ${c.nodeId} — "${c.name}" (${c.leafCount} solids; e.g. ${c.sampleParts
          .slice(0, 8)
          .join(", ")})`
    )
    .join("\n");

  try {
    const { object } = await generateObject({
      model: openai(MODEL),
      schema: matchSchema,
      temperature: 0,
      prompt: `You are matching CAD subassemblies to the manufacturing bill of materials (BOM) for an assembly.

Each candidate is a subassembly node in the CAD model. Decide, for each, whether the ENTIRE subassembly corresponds to exactly ONE BOM line — for example a purchased sub-unit like a PCB assembly, a motor, or a bought module, whose internal solids (chips, screws, windings) are NOT separate BOM lines. In that case return that BOM item's id.

If instead the subassembly is just a grouping of several distinct BOM parts (its children are themselves separate BOM lines), return null so the planner expands it into individual parts.

BOM lines (id: name):
${bomText}

Candidate subassemblies:
${candidatesText}

Return one match per candidate. Only reference BOM item ids from the list above.`
    });

    const bomIds = new Set(bom.map((line) => line.itemId));
    return object.matches.flatMap((match) =>
      match.itemId &&
      match.confidence >= MIN_CONFIDENCE &&
      bomIds.has(match.itemId)
        ? [{ nodeId: match.nodeId, itemId: match.itemId }]
        : []
    );
  } catch (error) {
    console.error(
      "matchUnitsToBom failed; proceeding without LLM matches:",
      error
    );
    return [];
  }
}
