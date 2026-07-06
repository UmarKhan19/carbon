/**
 * Deriving the "units" a motion planner should treat as one rigid body from a
 * CAD assembly graph, its item BOM, geometry↔BOM mappings, LLM matches, and
 * user overrides. Pure (no IO), so the planner worker, the editor UI, and tests
 * all share one implementation.
 *
 * The graph shape is declared structurally (only the fields used) so this file
 * has no dependency on the viewer/three rendering package — `@carbon/viewer`'s
 * `AssemblyGraph` is assignable to `UnitGraph`.
 */

/** Minimal structural view of a graph.json node. */
export type UnitGraphNode = {
  nodeId: string;
  name: string;
  isAssembly: boolean;
  geometryHash: string | null;
  children: UnitGraphNode[];
};

export type UnitGraph = { root: UnitGraphNode };

// --- Name similarity (shared with BOM auto-matching) ---------------------

/** Lowercase alphanumeric+dot tokens (drops punctuation/whitespace). */
export function tokenizeName(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9.]+/)
      .filter((token) => token.length > 0)
  );
}

/** Jaccard overlap of two names' token sets, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const tokensA = tokenizeName(a);
  const tokensB = tokenizeName(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  return shared / (tokensA.size + tokensB.size - shared);
}

/** Threshold above which two names are treated as the same part. */
export const NAME_MATCH_THRESHOLD = 0.45;

// --- Unit derivation -----------------------------------------------------

/**
 * A planned unit: the set of leaf parts the planner should treat as one rigid
 * body (and that becomes one assembly step). A purchased PCB whose CAD model
 * carries hundreds of tiny child solids collapses to a single unit.
 */
export type AssemblyUnit = {
  /** Stable id: the subtree root's nodeId (single-leaf units use the leaf id). */
  id: string;
  name: string;
  /** Member LEAF nodeIds — what the planner merges and the step installs. */
  nodeIds: string[];
  /** BOM item this unit maps to, when resolvable. */
  itemId?: string;
  source: "authored" | "bom" | "hierarchy";
};

/**
 * A subassembly node the caller may want an LLM to match against the BOM.
 * Leaves aren't candidates — they're already units of themselves; only
 * assembly-node subtrees need a "collapse to one BOM item vs expand" decision.
 */
export type AssemblyUnitCandidate = {
  nodeId: string;
  name: string;
  /** Leaf instances under this node. */
  leafCount: number;
  /** A sample of descendant part names, for the matcher's context. */
  sampleParts: string[];
};

type BomMaterial = { itemId: string; name: string | null };
type PartMapping = { geometryHash: string; itemId: string };
type AuthoredUnit = { id: string; partNodeIds: string[]; name?: string };
/** nodeId → BOM itemId, as decided by the LLM matcher. */
type NodeMatch = { nodeId: string; itemId: string };

/** A node the graph treats as a leaf instance (see indexAssemblyGraph). */
function isLeaf(node: UnitGraphNode): boolean {
  return !node.isAssembly && node.children.length === 0;
}

function collectLeaves(node: UnitGraphNode, out: UnitGraphNode[]): void {
  if (isLeaf(node)) {
    out.push(node);
    return;
  }
  for (const child of node.children) collectLeaves(child, out);
}

/** Descend through single-child assembly wrapper layers to the real root. */
function unwrapWrappers(node: UnitGraphNode): UnitGraphNode {
  let current = node;
  while (
    !isLeaf(current) &&
    current.children.length === 1 &&
    current.children[0] !== undefined
  ) {
    current = current.children[0];
  }
  return current;
}

/**
 * The subassembly nodes an LLM should match against the BOM: the unwrapped
 * root's assembly-node children. Pure, so the worker can build a matcher prompt
 * from it and unit-test the selection.
 */
export function assemblyUnitCandidates(
  graph: UnitGraph,
  sampleSize = 12
): AssemblyUnitCandidate[] {
  const candidates: AssemblyUnitCandidate[] = [];
  for (const child of unwrapWrappers(graph.root).children) {
    if (isLeaf(child)) continue;
    const leaves: UnitGraphNode[] = [];
    collectLeaves(child, leaves);
    if (leaves.length === 0) continue;
    const sampleParts = [...new Set(leaves.map((l) => l.name))].slice(
      0,
      sampleSize
    );
    candidates.push({
      nodeId: child.nodeId,
      name: child.name,
      leafCount: leaves.length,
      sampleParts
    });
  }
  return candidates;
}

/**
 * Derives the planned units for a model from its CAD hierarchy, the item's BOM,
 * geometry↔BOM mappings, LLM node matches, and any user-authored overrides.
 *
 * Rules, in precedence order:
 *  1. Authored units are explicit (the override).
 *  2. Unwrap single-child wrapper layers from the root.
 *  3. The unwrapped root's direct children are the candidates. A leaf child is a
 *     unit of itself.
 *  4. For an assembly-node candidate: collapse it into one unit when the LLM
 *     matched it to a BOM item, or when its mapped leaves resolve to ≤1 BOM item
 *     (the PCB case); otherwise, if its children span several BOM items, descend
 *     one level and re-apply. With no BOM, collapse the subassembly node
 *     (top-level-only fallback). Flat models yield one unit per leaf.
 */
export function deriveAssemblyUnits(args: {
  graph: UnitGraph;
  bomMaterials: BomMaterial[];
  partMappings: PartMapping[];
  authoredUnits: AuthoredUnit[];
  /** nodeId → itemId matches from the LLM matcher (optional). */
  nodeMatches?: NodeMatch[];
}): AssemblyUnit[] {
  const {
    graph,
    bomMaterials,
    partMappings,
    authoredUnits,
    nodeMatches = []
  } = args;

  const itemById = new Map(bomMaterials.map((m) => [m.itemId, m]));
  const itemByHash = new Map(
    partMappings.map((m) => [m.geometryHash, m.itemId])
  );
  const itemByNode = new Map(nodeMatches.map((m) => [m.nodeId, m.itemId]));
  const hasBom = bomMaterials.length > 0;

  const units: AssemblyUnit[] = [];
  const claimed = new Set<string>();

  // 1. Authored overrides win. Their member leaves are removed from the
  //    automatic pass so a leaf is never planned twice.
  for (const authored of authoredUnits) {
    const nodeIds = authored.partNodeIds.filter((id) => !claimed.has(id));
    if (nodeIds.length === 0) continue;
    for (const id of nodeIds) claimed.add(id);
    const itemId = resolveItemId(nodeIds, itemByHash, graph);
    units.push({
      id: authored.id,
      name: authored.name ?? itemName(itemId, itemById) ?? "Subassembly",
      nodeIds,
      itemId,
      source: "authored"
    });
  }

  /** Distinct BOM item ids the subtree's mapped leaves resolve to. */
  const distinctBomItems = (leaves: UnitGraphNode[]): Set<string> => {
    const ids = new Set<string>();
    for (const leaf of leaves) {
      const itemId = leaf.geometryHash
        ? itemByHash.get(leaf.geometryHash)
        : undefined;
      if (itemId) ids.add(itemId);
    }
    return ids;
  };

  const emitCollapsed = (
    node: UnitGraphNode,
    leaves: UnitGraphNode[],
    itemId: string | undefined
  ): void => {
    const nodeIds = leaves
      .map((l) => l.nodeId)
      .filter((id) => !claimed.has(id));
    if (nodeIds.length === 0) return;
    for (const id of nodeIds) claimed.add(id);
    units.push({
      id: nodeIds.length === 1 ? nodeIds[0]! : node.nodeId,
      name: itemName(itemId, itemById) ?? node.name,
      nodeIds,
      itemId,
      source: itemId ? "bom" : "hierarchy"
    });
  };

  const visit = (node: UnitGraphNode): void => {
    if (isLeaf(node)) {
      emitCollapsed(
        node,
        [node],
        node.geometryHash ? itemByHash.get(node.geometryHash) : undefined
      );
      return;
    }

    const leaves: UnitGraphNode[] = [];
    collectLeaves(node, leaves);
    if (leaves.length === 0) return;

    // The LLM matched this whole subtree to one BOM item → collapse.
    const matched = itemByNode.get(node.nodeId);
    if (matched) {
      emitCollapsed(node, leaves, matched);
      return;
    }

    const distinct = distinctBomItems(leaves);
    if (!hasBom || distinct.size <= 1) {
      // No BOM to refine against, or the whole subtree is one BOM item (plus
      // unmapped noise) → collapse as one unit.
      emitCollapsed(node, leaves, [...distinct][0]);
      return;
    }

    // A gratuitous grouping layer spanning several BOM items → descend.
    for (const child of node.children) visit(child);
  };

  for (const child of unwrapWrappers(graph.root).children) visit(child);

  return units;
}

/** The single BOM item a set of leaf nodeIds maps to, if unambiguous. */
function resolveItemId(
  nodeIds: string[],
  itemByHash: Map<string, string>,
  graph: UnitGraph
): string | undefined {
  const hashByNode = new Map<string, string>();
  const index = (node: UnitGraphNode): void => {
    if (node.geometryHash) hashByNode.set(node.nodeId, node.geometryHash);
    for (const child of node.children) index(child);
  };
  index(graph.root);
  const items = new Set<string>();
  for (const nodeId of nodeIds) {
    const hash = hashByNode.get(nodeId);
    const itemId = hash ? itemByHash.get(hash) : undefined;
    if (itemId) items.add(itemId);
  }
  return items.size === 1 ? [...items][0] : undefined;
}

function itemName(
  itemId: string | undefined,
  itemById: Map<string, BomMaterial>
): string | undefined {
  if (!itemId) return undefined;
  return itemById.get(itemId)?.name ?? undefined;
}
