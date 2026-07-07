import { type AssemblyGraphIndex, groupPartNodeIds } from "./graph";
import type { AssemblyStep, Fastener } from "./types";

/**
 * A named subassembly unit for title derivation: a set of leaf parts that
 * assemble as one body and share a single step titled by `name` (e.g. an
 * authored "Board" or a purchased PCB), rather than enumerating every part.
 */
export type NamedUnit = { name: string; partNodeIds: string[] };

/**
 * Display title for a step. An explicit title always wins. When the step's
 * parts are exactly a named subassembly unit, the unit's name is used
 * ("Add Board") instead of listing every part inside it. Otherwise the title
 * is derived from the step's parts and fastener, e.g.
 * "Add Seat Rail Clamp, M5 SHCS (×4)". Returns null when there is nothing to
 * derive from (no title, no known parts, no fastener).
 */
export function describeStep(
  step: Pick<AssemblyStep, "title" | "partNodeIds" | "fastener">,
  index: AssemblyGraphIndex | null,
  units?: NamedUnit[]
): string | null {
  if (step.title && step.title.trim().length > 0) return step.title;

  const fastenerSegment = describeFastener(step.fastener);

  // A step whose parts are exactly a named subassembly is titled by that
  // subassembly's name, never by listing each of its (often hundreds of) parts.
  const unit = units ? matchNamedUnit(step.partNodeIds, units) : null;
  if (unit) {
    const segments = [unit.name];
    if (fastenerSegment) segments.push(fastenerSegment);
    return `Add ${segments.join(", ")}`;
  }

  const groups = index ? groupPartNodeIds(step.partNodeIds, index) : [];

  if (groups.length === 0 && !fastenerSegment) return null;

  const verb =
    groups.length === 0 ? "Install" : groups.length === 1 ? "Add" : "Assemble";

  const segments = groups.map((group) =>
    group.count > 1 ? `${group.name} (×${group.count})` : group.name
  );
  if (fastenerSegment) segments.push(fastenerSegment);

  return `${verb} ${segments.join(", ")}`;
}

/** "M5 SHCS (×4)" / "M5 SHCS", or null when the step has no fastener spec. */
function describeFastener(fastener: Fastener | null): string | null {
  const spec = fastener?.spec?.trim();
  if (!spec) return null;
  const count = fastener?.count;
  return count && count > 1 ? `${spec} (×${count})` : spec;
}

/** The named unit whose parts set-equal the step's parts, if any. */
function matchNamedUnit(
  partNodeIds: string[],
  units: NamedUnit[]
): NamedUnit | null {
  if (partNodeIds.length === 0) return null;
  const stepSet = new Set(partNodeIds);
  for (const unit of units) {
    const unitSet = new Set(unit.partNodeIds);
    if (unitSet.size === 0 || unitSet.size !== stepSet.size) continue;
    let equal = true;
    for (const nodeId of unitSet) {
      if (!stepSet.has(nodeId)) {
        equal = false;
        break;
      }
    }
    if (equal) return unit;
  }
  return null;
}
