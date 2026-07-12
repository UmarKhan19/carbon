import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ChangeOrderItemDiff,
  MethodDiffEntry,
  MethodDiffStatus
} from "./changeOrder.models";
import {
  getChangeOrderAffectedItems,
  getChangeOrderStagedMaterials,
  getChangeOrderStagedOperationChildren
} from "./changeOrder.staging";

// =============================================================================
// Change Orders — the reusable method-diff engine (Q5 git-style end-state).
//
// `diffMethod` is a PURE function (no DB access, unit-testable): it compares two
// method snapshots (a `base` = the current live method, a `target` = the CO's
// staged desired end-state) and classifies every material / operation as
// added / removed / modified / unchanged, plus a column-by-column attribute diff.
// The same shape is reused for the pre-release "tips" (staged-vs-live) and the
// post-release oldRev↔newRev redline (Task 17).
//
// `getChangeOrderDiff` is the DB-facing wrapper: for each affected item it reads
// the current source method live + the staged rows, runs `diffMethod`, and also
// returns the manual supersession declarations. Reads are flat selects + JS
// stitch (no composite-FK PostgREST embeds — the erp TS2589 budget; see lessons).
// =============================================================================

// A plain record — DB rows are passed straight through; the engine is generic
// over the shape and only reads the compared field subset + the identity keys.
type Row = Record<string, unknown>;

// Materials are matched by identity: a staged/target row's `sourceMaterialId`
// links it to a base row's `id`. Operations use `sourceOperationId`. Operation
// CHILDREN (steps / parameters / tools) use `sourceId` (the staged child's
// pointer at the live child it was copied from; NULL ⇒ added child line).
const MATERIAL_SOURCE_KEY = "sourceMaterialId";
const OPERATION_SOURCE_KEY = "sourceOperationId";
const CHILD_SOURCE_KEY = "sourceId";

// The business-meaningful field subset compared for a "modified" verdict. Audit
// and linkage columns are intentionally excluded (see IGNORED_FIELDS) so that a
// snapshot which only differs by id/timestamps reads as "unchanged".
const MATERIAL_COMPARE_FIELDS = [
  "itemId",
  "quantity",
  "order",
  "unitOfMeasureCode",
  "methodType",
  "sourcingType",
  "materialMakeMethodId",
  "itemType"
] as const;

const OPERATION_COMPARE_FIELDS = [
  "order",
  "operationOrder",
  "operationType",
  "processId",
  "workCenterId",
  "description",
  "setupTime",
  "setupUnit",
  "laborTime",
  "laborUnit",
  "machineTime",
  "machineUnit",
  "procedureId",
  "operationSupplierProcessId"
] as const;

// The compared field subsets for operation children. As with operations, audit /
// linkage columns are excluded (see IGNORED_FIELDS) so a snapshot that only
// differs by id/pointers/timestamps reads as "unchanged".
const STEP_COMPARE_FIELDS = [
  "name",
  "description",
  "type",
  "required",
  "sortOrder",
  "unitOfMeasureCode",
  "minValue",
  "maxValue"
] as const;

const PARAMETER_COMPARE_FIELDS = ["key", "value"] as const;

const TOOL_COMPARE_FIELDS = ["toolId", "quantity"] as const;

// Never compared — audit / linkage / tenancy columns. Used by the attribute diff
// (which is column-driven rather than a fixed subset) and as a guard elsewhere.
const IGNORED_FIELDS = new Set<string>([
  "id",
  "companyId",
  "changeOrderId",
  "affectedItemId",
  "sourceMaterialId",
  "sourceOperationId",
  "sourceId",
  "stagedOperationId",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy"
]);

// Loose equality tolerant of the numeric-string ↔ number skew that Supabase
// returns for NUMERIC columns (a live `quantity` may be `"1"` while a staged one
// is `1`). null and undefined are treated as the same "empty" value.
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  return false;
}

// Build the field-level change map for a matched (base, target) pair over a fixed
// field subset. Returns undefined when nothing in the subset differs.
function diffFields(
  base: Row,
  target: Row,
  fields: readonly string[]
): Record<string, { before: unknown; after: unknown }> | undefined {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of fields) {
    if (!valuesEqual(base[field], target[field])) {
      changed[field] = {
        before: base[field] ?? null,
        after: target[field] ?? null
      };
    }
  }
  return Object.keys(changed).length > 0 ? changed : undefined;
}

// Match target rows to base rows by the given source-pointer key, then classify.
//   - base row with no target pointing at it            ⇒ removed
//   - target row with a null/absent source pointer      ⇒ added
//   - target whose source pointer references a base row  ⇒ modified | unchanged
function diffRows(
  base: Row[],
  target: Row[],
  sourceKey: string,
  compareFields: readonly string[]
): MethodDiffEntry<Row>[] {
  const entries: MethodDiffEntry<Row>[] = [];

  // Index base rows by their id for O(1) lookup, and track which get matched.
  const baseById = new Map<string, Row>();
  for (const row of base) {
    const id = row.id;
    if (typeof id === "string") baseById.set(id, row);
  }
  const matchedBaseIds = new Set<string>();

  for (const targetRow of target) {
    const sourceId = targetRow[sourceKey];
    const baseRow =
      typeof sourceId === "string" ? baseById.get(sourceId) : undefined;

    if (!baseRow) {
      // No live counterpart — a newly-added line.
      entries.push({ status: "added", before: null, after: targetRow });
      continue;
    }

    matchedBaseIds.add(baseRow.id as string);
    const changedFields = diffFields(baseRow, targetRow, compareFields);
    const status: MethodDiffStatus = changedFields ? "modified" : "unchanged";
    entries.push({
      status,
      before: baseRow,
      after: targetRow,
      ...(changedFields ? { changedFields } : {})
    });
  }

  // Any base row nothing pointed at was dropped from the staged end-state.
  for (const baseRow of base) {
    const id = baseRow.id;
    if (typeof id === "string" && !matchedBaseIds.has(id)) {
      entries.push({ status: "removed", before: baseRow, after: null });
    }
  }

  return entries;
}

// -----------------------------------------------------------------------------
// Operation children (steps / parameters / tools)
// -----------------------------------------------------------------------------

// The three staged child buckets for a single operation, keyed by the staged
// operation's id. Both the live (base) children and the staged (target) children
// share this shape.
export type OperationChildren = {
  steps: Row[];
  parameters: Row[];
  tools: Row[];
};

// The per-operation child diff: each bucket classified added/removed/modified/
// unchanged, matched by the staged child's `sourceId` (mirrors materials).
export type OperationChildrenDiff = {
  steps: MethodDiffEntry<Row>[];
  parameters: MethodDiffEntry<Row>[];
  tools: MethodDiffEntry<Row>[];
};

// An operation diff entry, optionally carrying its child-level diff. Backward
// compatible with MethodDiffEntry<Row> — `children` is additive and undefined
// for callers that don't supply children.
export type OperationDiffEntry = MethodDiffEntry<Row> & {
  children?: OperationChildrenDiff;
};

// Base/target children keyed by operation id. For target (staged) operations the
// key is the staged operation's own id; for base (live) operations it's the live
// operation's id. Matching a staged operation to its base children goes through
// the operation's `sourceOperationId`.
export type ChildrenByOperationId = Record<string, OperationChildren>;

function emptyChildren(): OperationChildren {
  return { steps: [], parameters: [], tools: [] };
}

// Diff one operation's children. `base`/`target` are the live/staged child
// buckets; each bucket is matched by `sourceId` over its own compare-field set.
function diffOperationChildren(
  base: OperationChildren,
  target: OperationChildren
): OperationChildrenDiff {
  return {
    steps: diffRows(
      base.steps,
      target.steps,
      CHILD_SOURCE_KEY,
      STEP_COMPARE_FIELDS
    ),
    parameters: diffRows(
      base.parameters,
      target.parameters,
      CHILD_SOURCE_KEY,
      PARAMETER_COMPARE_FIELDS
    ),
    tools: diffRows(
      base.tools,
      target.tools,
      CHILD_SOURCE_KEY,
      TOOL_COMPARE_FIELDS
    )
  };
}

// Diff operations AND, when child buckets are supplied, attach a per-operation
// child diff. Matches operations exactly like diffRows (by `sourceOperationId`);
// for each entry it pairs the base children (via the matched base operation id)
// with the target children (via the staged operation id) and runs
// `diffOperationChildren`. When no child maps are supplied it degrades to the
// plain operation diff (identical to `diffRows`), so existing callers/tests are
// unaffected.
function diffOperations(
  base: Row[],
  target: Row[],
  baseChildren?: ChildrenByOperationId,
  targetChildren?: ChildrenByOperationId
): OperationDiffEntry[] {
  const entries = diffRows(
    base,
    target,
    OPERATION_SOURCE_KEY,
    OPERATION_COMPARE_FIELDS
  ) as OperationDiffEntry[];

  if (!baseChildren && !targetChildren) return entries;

  for (const entry of entries) {
    const baseId = (entry.before as { id?: string } | null)?.id;
    const targetId = (entry.after as { id?: string } | null)?.id;
    const baseKids = (baseId && baseChildren?.[baseId]) || emptyChildren();
    const targetKids =
      (targetId && targetChildren?.[targetId]) || emptyChildren();
    entry.children = diffOperationChildren(baseKids, targetKids);
  }

  return entries;
}

// Column-by-column diff of two attribute objects. Every key present in either
// object (minus the ignored audit/linkage set) is compared; each changed column
// becomes one MethodDiffEntry whose `changedFields` holds the single field. When
// nothing changed a single "unchanged" entry is returned so callers can render
// "no attribute changes" uniformly.
function diffAttributes(
  base: Row | null,
  target: Row | null
): MethodDiffEntry<Row>[] {
  const b = base ?? {};
  const t = target ?? {};
  const keys = new Set<string>([...Object.keys(b), ...Object.keys(t)]);

  const entries: MethodDiffEntry<Row>[] = [];
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    if (valuesEqual(b[key], t[key])) continue;
    entries.push({
      status: "modified",
      before: base,
      after: target,
      changedFields: {
        [key]: { before: b[key] ?? null, after: t[key] ?? null }
      }
    });
  }

  if (entries.length === 0) {
    return [{ status: "unchanged", before: base, after: target }];
  }
  return entries;
}

// -----------------------------------------------------------------------------
// The pure diff engine
// -----------------------------------------------------------------------------

export type DiffMethodInput = {
  baseMaterials: Row[];
  targetMaterials: Row[];
  baseOperations: Row[];
  targetOperations: Row[];
  baseAttributes?: Row | null;
  targetAttributes?: Row | null;
  // Optional per-operation children (steps/parameters/tools), keyed by operation
  // id (live op id for base, staged op id for target). When omitted, operation
  // entries carry no `children` and the result is identical to the pre-Task-16
  // shape.
  baseOperationChildren?: ChildrenByOperationId;
  targetOperationChildren?: ChildrenByOperationId;
};

export type DiffMethodResult = {
  materials: MethodDiffEntry<Row>[];
  // Operations may carry an optional child-level diff (see OperationDiffEntry).
  // OperationDiffEntry is a superset of MethodDiffEntry<Row>, so consumers typed
  // against MethodDiffEntry<Row>[] keep working.
  operations: OperationDiffEntry[];
  attributes: MethodDiffEntry<Row>[];
};

// PURE. Compares two method snapshots. No DB access — the caller supplies plain
// rows (live method rows as `base`, CO-staged rows as `target`), and optionally
// the per-operation child buckets to also diff steps/parameters/tools.
export function diffMethod(input: DiffMethodInput): DiffMethodResult {
  return {
    materials: diffRows(
      input.baseMaterials,
      input.targetMaterials,
      MATERIAL_SOURCE_KEY,
      MATERIAL_COMPARE_FIELDS
    ),
    operations: diffOperations(
      input.baseOperations,
      input.targetOperations,
      input.baseOperationChildren,
      input.targetOperationChildren
    ),
    attributes: diffAttributes(
      input.baseAttributes ?? null,
      input.targetAttributes ?? null
    )
  };
}

// -----------------------------------------------------------------------------
// DB-facing wrapper
// -----------------------------------------------------------------------------

type ChangeOrderSupersessionRow =
  Database["public"]["Tables"]["changeOrderSupersession"]["Row"];

export type ChangeOrderDiff = {
  items: ChangeOrderItemDiff[];
  supersessions: ChangeOrderSupersessionRow[];
};

// For every affected item: read the CURRENT source make method live
// (activeMakeMethods → methodMaterial / methodOperation) as `base` and the CO's
// staged rows as `target`, run `diffMethod`, and collect the results. Also reads
// the manual supersession declarations for the whole change order. All reads are
// flat selects scoped by companyId; the classification is delegated to the pure
// `diffMethod`.
export async function getChangeOrderDiff(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<{ data: ChangeOrderDiff; error: { message: string } | null }> {
  const affected = await getChangeOrderAffectedItems(
    client,
    changeOrderId,
    companyId
  );
  if (affected.error)
    return { data: { items: [], supersessions: [] }, error: affected.error };

  const items: ChangeOrderItemDiff[] = [];

  for (const affectedItem of affected.data) {
    // Resolve the item's current Active make method (per item, status Active).
    const activeMethod = await client
      .from("activeMakeMethods")
      .select("id")
      .eq("itemId", affectedItem.itemId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (activeMethod.error)
      return {
        data: { items: [], supersessions: [] },
        error: activeMethod.error
      };
    const makeMethodId = activeMethod.data?.id ?? null;

    // Live method snapshot (the diff base). Empty for Buy items with no method.
    let baseMaterials: Row[] = [];
    let baseOperations: Row[] = [];
    // Live operation children keyed by live operation id.
    const baseOperationChildren: ChildrenByOperationId = {};
    if (makeMethodId) {
      const [liveMaterials, liveOperations] = await Promise.all([
        client
          .from("methodMaterial")
          .select("*")
          .eq("makeMethodId", makeMethodId)
          .eq("companyId", companyId)
          .order("order", { ascending: true }),
        client
          .from("methodOperation")
          .select("*")
          .eq("makeMethodId", makeMethodId)
          .eq("companyId", companyId)
          .order("order", { ascending: true })
      ]);
      if (liveMaterials.error)
        return {
          data: { items: [], supersessions: [] },
          error: liveMaterials.error
        };
      if (liveOperations.error)
        return {
          data: { items: [], supersessions: [] },
          error: liveOperations.error
        };
      baseMaterials = (liveMaterials.data ?? []) as Row[];
      baseOperations = (liveOperations.data ?? []) as Row[];

      // Live operation children (steps/parameters/tools) for every base
      // operation, fetched in one query per child table and bucketed by
      // operationId. Flat selects scoped by companyId — no PostgREST embeds.
      const operationIds = baseOperations
        .map((o) => o.id)
        .filter((id): id is string => typeof id === "string");
      if (operationIds.length > 0) {
        const [liveSteps, liveParameters, liveTools] = await Promise.all([
          client
            .from("methodOperationStep")
            .select("*")
            .in("operationId", operationIds)
            .eq("companyId", companyId),
          client
            .from("methodOperationParameter")
            .select("*")
            .in("operationId", operationIds)
            .eq("companyId", companyId),
          client
            .from("methodOperationTool")
            .select("*")
            .in("operationId", operationIds)
            .eq("companyId", companyId)
        ]);
        if (liveSteps.error)
          return {
            data: { items: [], supersessions: [] },
            error: liveSteps.error
          };
        if (liveParameters.error)
          return {
            data: { items: [], supersessions: [] },
            error: liveParameters.error
          };
        if (liveTools.error)
          return {
            data: { items: [], supersessions: [] },
            error: liveTools.error
          };
        for (const id of operationIds)
          baseOperationChildren[id] = {
            steps: [],
            parameters: [],
            tools: []
          };
        for (const row of (liveSteps.data ?? []) as Row[]) {
          const opId = row.operationId;
          if (typeof opId === "string")
            baseOperationChildren[opId]?.steps.push(row);
        }
        for (const row of (liveParameters.data ?? []) as Row[]) {
          const opId = row.operationId;
          if (typeof opId === "string")
            baseOperationChildren[opId]?.parameters.push(row);
        }
        for (const row of (liveTools.data ?? []) as Row[]) {
          const opId = row.operationId;
          if (typeof opId === "string")
            baseOperationChildren[opId]?.tools.push(row);
        }
      }
    }

    // Staged end-state (the diff target). Materials via the shared staging read;
    // operations + attributes read flat here.
    const stagedMaterials = await getChangeOrderStagedMaterials(
      client,
      affectedItem.id,
      companyId
    );
    if (stagedMaterials.error)
      return {
        data: { items: [], supersessions: [] },
        error: stagedMaterials.error
      };

    const [stagedOperations, stagedAttributes, liveAttributes] =
      await Promise.all([
        client
          .from("changeOrderStagedOperation")
          .select("*")
          .eq("affectedItemId", affectedItem.id)
          .eq("companyId", companyId)
          .order("order", { ascending: true }),
        client
          .from("changeOrderStagedItemAttributes")
          .select("*")
          .eq("affectedItemId", affectedItem.id)
          .eq("companyId", companyId)
          .maybeSingle(),
        // The live item's editable attributes form the attribute-diff base.
        client
          .from("item")
          .select(
            "name, description, unitOfMeasureCode, itemTrackingType, defaultMethodType, replenishmentSystem, sourcingType, requiresInspection, thumbnailPath"
          )
          .eq("id", affectedItem.itemId)
          .eq("companyId", companyId)
          .maybeSingle()
      ]);
    if (stagedOperations.error)
      return {
        data: { items: [], supersessions: [] },
        error: stagedOperations.error
      };
    if (stagedAttributes.error)
      return {
        data: { items: [], supersessions: [] },
        error: stagedAttributes.error
      };
    if (liveAttributes.error)
      return {
        data: { items: [], supersessions: [] },
        error: liveAttributes.error
      };

    // Staged operation children (steps/parameters/tools) for every staged
    // operation, bucketed by staged operation id. Uses the shared combined
    // staging read per operation.
    const targetOperations = (stagedOperations.data ?? []) as Row[];
    const targetOperationChildren: ChildrenByOperationId = {};
    for (const op of targetOperations) {
      const opId = op.id;
      if (typeof opId !== "string") continue;
      const children = await getChangeOrderStagedOperationChildren(
        client,
        opId,
        companyId
      );
      if (children.error)
        return {
          data: { items: [], supersessions: [] },
          error: children.error
        };
      targetOperationChildren[opId] = {
        steps: (children.data.steps ?? []) as Row[],
        parameters: (children.data.parameters ?? []) as Row[],
        tools: (children.data.tools ?? []) as Row[]
      };
    }

    const diff = diffMethod({
      baseMaterials,
      targetMaterials: stagedMaterials.data as unknown as Row[],
      baseOperations,
      targetOperations,
      baseAttributes: (liveAttributes.data ?? null) as Row | null,
      targetAttributes: (stagedAttributes.data ?? null) as Row | null,
      baseOperationChildren,
      targetOperationChildren
    });

    items.push({
      affectedItemId: affectedItem.id,
      itemId: affectedItem.itemId,
      materials: diff.materials,
      operations: diff.operations,
      attributes: diff.attributes
    });
  }

  // Manual different-part supersession declarations for the whole change order.
  const supersessions = await client
    .from("changeOrderSupersession")
    .select("*")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
  if (supersessions.error)
    return { data: { items, supersessions: [] }, error: supersessions.error };

  return {
    data: { items, supersessions: supersessions.data ?? [] },
    error: null
  };
}
