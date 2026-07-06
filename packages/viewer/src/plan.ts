import { synthesizeFallbackMotion } from "./fallback";
import type { AssemblyGraphIndex } from "./graph";
import type { Motion } from "./types";

/**
 * plan.json as written by the geometry service /plan endpoint (see
 * docs/specs/animated-work-instructions-contracts.md). Keys join against
 * graph.json nodeIds and GLB extras. Version 2 adds tiers, forward
 * verification, subassembly groups, and rigid merges; all new fields are
 * optional so version-1 files keep parsing.
 */
export type AssemblyPlanPart = {
  /** INSERTION motion (removal reversed) */
  motion: Motion;
  confidence?: "high" | "low";
  removalDirection?: [number, number, number];
  /** Obstructions for flagged parts (no collision-free path exists) */
  blockedBy?: string[];
  /** v2: how the motion was found */
  tier?: "linear" | "L" | "escape" | "group" | "flagged" | "base";
  /** v2: insertion re-checked collision-free against its predecessors */
  verified?: boolean;
  /** v2: subassembly unit — members share one step and one motion */
  groupId?: string;
  /** v2: rigidly merged into this part (rides its step) */
  mergedInto?: string;
};

/**
 * The plan.json version the current planner writes. Stored plans below
 * this are STALE — produced by an older algorithm — and consumers must
 * treat them as absent so the pipeline re-plans instead of resurrecting
 * old motions. Bump alongside the geometry service's PLAN_VERSION.
 */
export const CURRENT_PLAN_VERSION = 3;

export type AssemblyPlan = {
  version: 1 | 2 | 3;
  unit: "mm";
  /** Assembly order (constraint-consistent; v1: reversed greedy disassembly) */
  sequence: string[];
  parts: Record<string, AssemblyPlanPart>;
  /**
   * v2: subassembly units keyed by groupId. v3 adds `name` — a pre-grouped unit
   * (e.g. a purchased PCB) carries its BOM/subassembly name for the step title.
   */
  groups?: Record<
    string,
    { partNodeIds: string[]; motion: Motion; name?: string }
  >;
  warnings: string[];
};

export type PlannedMotion = {
  motion: Motion;
  confidence: "high" | "low";
};

/**
 * The auto-planned motion for a step's parts, per the contract: a single
 * part uses its own motion; multiple parts use the shared motion when all
 * agree, otherwise the first part's motion with confidence low. Returns
 * null when the plan has nothing useful for these parts.
 */
export function planMotionForParts(
  plan: AssemblyPlan | null,
  partNodeIds: string[]
): PlannedMotion | null {
  if (!plan || partNodeIds.length === 0) return null;

  const entries = partNodeIds
    .map((nodeId) => plan.parts[nodeId])
    .filter(
      (entry): entry is AssemblyPlanPart =>
        entry !== undefined && entry.motion.type !== "none"
    );
  if (entries.length === 0) return null;

  const first = entries[0];
  if (!first) return null;

  if (entries.length === 1 && partNodeIds.length === 1) {
    return { motion: first.motion, confidence: first.confidence ?? "low" };
  }

  const firstKey = JSON.stringify(first.motion);
  const allAgree =
    entries.length === partNodeIds.length &&
    entries.every((entry) => JSON.stringify(entry.motion) === firstKey);

  if (allAgree) {
    const lowest = entries.some((entry) => entry.confidence !== "high")
      ? "low"
      : "high";
    return { motion: first.motion, confidence: lowest };
  }

  return { motion: first.motion, confidence: "low" };
}

const MOTION_TYPES = new Set(["linear", "L", "helix", "path", "none"]);

/** Structural guard for motions arriving from plan.json (untyped storage). */
function isMotion(value: unknown): value is Motion {
  return (
    typeof value === "object" &&
    value !== null &&
    MOTION_TYPES.has((value as { type?: string }).type ?? "")
  );
}

export type AssemblyStepGroup = {
  partNodeIds: string[];
  motion: Motion;
  confidence: "high" | "low";
  /**
   * Planner-recorded obstructions. Non-empty means the group is flagged: no
   * collision-free path exists, the motion is "none", and the player fades
   * the parts in at their seated pose.
   */
  blockedBy: string[];
  /** v3: the pre-grouped unit's name (e.g. "PCB Assembly"), for the step title. */
  name?: string;
};

function motionKey(motion: Motion): string {
  switch (motion.type) {
    case "linear":
      return `linear:${motion.direction.join(",")}`;
    case "L":
      return `L:${motion.segments
        .map((segment) => segment.direction.join(","))
        .join(";")}`;
    default:
      return motion.type;
  }
}

/**
 * Groups a plan's assembly sequence into draft steps: consecutive identical
 * parts (same geometry, same motion direction, same flag state) share a
 * step, keeping the longest travel so instances at different depths all
 * reach their seat. Subassembly units (shared `groupId`) always share one
 * step regardless of geometry, and rigidly merged parts ride their host's
 * step. Parts the planner flagged via `blockedBy` (or that failed forward
 * verification) get motion "none" — a fabricated path would animate
 * straight through geometry. Unflagged parts old plans left with motion
 * "none" get an AABB fallback so they never pop into place; the first
 * group is exempt (the base is placed, not inserted).
 */
export function buildAssemblyStepGroups(
  plan: AssemblyPlan,
  graphIndex: AssemblyGraphIndex | null
): AssemblyStepGroup[] {
  type WorkingGroup = AssemblyStepGroup & { key: string };
  const groups: WorkingGroup[] = [];

  // Rigidly merged parts (v2) are absent from the sequence: they install
  // with their host, animating as one body
  const mergedByHost = new Map<string, string[]>();
  for (const [nodeId, part] of Object.entries(plan.parts)) {
    if (!part.mergedInto) continue;
    const members = mergedByHost.get(part.mergedInto) ?? [];
    members.push(nodeId);
    mergedByHost.set(part.mergedInto, members);
  }

  for (const nodeId of plan.sequence) {
    const part = plan.parts[nodeId];
    if (part?.mergedInto) continue; // defensive: hosts carry their merges
    const blockedBy = part?.blockedBy ?? [];
    const flagged = blockedBy.length > 0 || part?.verified === false;
    const motion: Motion = flagged
      ? { type: "none" }
      : part && isMotion(part.motion)
        ? part.motion
        : { type: "none" };
    const confidence: "high" | "low" =
      !flagged && part?.confidence === "high" ? "high" : "low";
    const hash = graphIndex?.nodesById.get(nodeId)?.geometryHash ?? nodeId;
    // Subassembly members share a step no matter their geometry
    const key = part?.groupId
      ? `group:${part.groupId}`
      : `${hash}|${motionKey(motion)}|${confidence}|${flagged}`;

    const withMerged = [nodeId, ...(mergedByHost.get(nodeId) ?? [])];

    const previous = groups[groups.length - 1];
    if (previous && previous.key === key) {
      previous.partNodeIds.push(...withMerged);
      for (const blocker of blockedBy) {
        if (!previous.blockedBy.includes(blocker)) {
          previous.blockedBy.push(blocker);
        }
      }
      // Identical parts can sit at different depths: animate the longest
      if (motion.type === "linear" && previous.motion.type === "linear") {
        previous.motion = {
          ...previous.motion,
          distance: Math.max(previous.motion.distance, motion.distance)
        };
      }
      continue;
    }
    groups.push({
      partNodeIds: withMerged,
      motion,
      confidence,
      blockedBy: [...blockedBy],
      name: part?.groupId ? plan.groups?.[part.groupId]?.name : undefined,
      key
    });
  }

  if (graphIndex) {
    for (let index = 1; index < groups.length; index++) {
      const group = groups[index];
      if (
        !group ||
        group.motion.type !== "none" ||
        group.blockedBy.length > 0
      ) {
        continue;
      }
      const fallback = synthesizeFallbackMotion(graphIndex, group.partNodeIds);
      if (fallback && fallback.type !== "none") {
        group.motion = fallback;
        group.confidence = "low";
      }
    }
  }

  return groups.map(({ key: _key, ...group }) => group);
}
