import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Activity,
  ActivityInput,
  ActivityOutput,
  GraphData,
  TrackedEntity
} from "./types";
import { clampDepth } from "./ui/Traceability/constants";
import type {
  IssueContainment,
  IssueContainmentStatus,
  StepRecord
} from "./ui/Traceability/utils";

export type LineageDirection = "up" | "down" | "both";

export type LineagePayload = {
  entities: TrackedEntity[];
  inputs: ActivityInput[];
  outputs: ActivityOutput[];
  activities: Activity[];
  stepRecords?: StepRecord[];
  containments?: IssueContainment[];
};

const MAX_ENTITIES = 200;

type LineageState = {
  entities: Map<string, TrackedEntity>;
  activities: Map<string, Activity>;
  inputs: Map<string, ActivityInput>;
  outputs: Map<string, ActivityOutput>;
  visited: Set<string>;
};

function newLineageState(): LineageState {
  return {
    entities: new Map(),
    activities: new Map(),
    inputs: new Map(),
    outputs: new Map(),
    visited: new Set()
  };
}

async function expandActivitySiblings(
  client: SupabaseClient<Database>,
  state: LineageState,
  activityIds: string[]
): Promise<void> {
  const { entities, activities, inputs, outputs } = state;
  const newActivityIds = activityIds.filter((id) => !activities.has(id));
  if (newActivityIds.length > 0) {
    const fetched = await client
      .from("trackedActivity")
      .select("*")
      .in("id", newActivityIds);
    for (const row of fetched.data ?? []) {
      activities.set(row.id, row as unknown as Activity);
    }
  }

  // Pull sibling inputs/outputs for every activity so by-products (e.g. SCRAP)
  // appear even when not on the direct upstream/downstream path.
  const [siblingInputs, siblingOutputs] = await Promise.all([
    client
      .from("trackedActivityInput")
      .select("*")
      .in("trackedActivityId", activityIds),
    client
      .from("trackedActivityOutput")
      .select("*")
      .in("trackedActivityId", activityIds)
  ]);

  const siblingEntityIds = new Set<string>();
  for (const row of siblingInputs.data ?? []) {
    const key = `${row.trackedActivityId}:${row.trackedEntityId}`;
    if (!inputs.has(key)) {
      inputs.set(key, {
        trackedActivityId: row.trackedActivityId,
        trackedEntityId: row.trackedEntityId,
        quantity: row.quantity
      });
    }
    if (!entities.has(row.trackedEntityId)) {
      siblingEntityIds.add(row.trackedEntityId);
    }
  }
  for (const row of siblingOutputs.data ?? []) {
    const key = `${row.trackedActivityId}:${row.trackedEntityId}`;
    if (!outputs.has(key)) {
      outputs.set(key, {
        trackedActivityId: row.trackedActivityId,
        trackedEntityId: row.trackedEntityId,
        quantity: row.quantity
      });
    }
    if (!entities.has(row.trackedEntityId)) {
      siblingEntityIds.add(row.trackedEntityId);
    }
  }

  if (siblingEntityIds.size > 0) {
    const remainingCapacity = MAX_ENTITIES - entities.size;
    const idsToFetch = Array.from(siblingEntityIds).slice(0, remainingCapacity);
    if (idsToFetch.length > 0) {
      const fetched = await client
        .from("trackedEntity")
        .select("*")
        .in("id", idsToFetch);
      for (const row of fetched.data ?? []) {
        entities.set(row.id, row as TrackedEntity);
      }
    }
  }
}

async function runLineageBfs(
  client: SupabaseClient<Database>,
  state: LineageState,
  initialFrontier: string[],
  direction: LineageDirection,
  safeDepth: number
): Promise<void> {
  const { entities, inputs, outputs, visited } = state;
  let frontier = initialFrontier.filter((id) => {
    if (visited.has(id)) return true;
    visited.add(id);
    return true;
  });

  for (let hop = 0; hop < safeDepth; hop++) {
    if (frontier.length === 0) break;
    if (entities.size >= MAX_ENTITIES) break;

    type BatchRow = {
      sourceEntityId: string;
      trackedActivityId: string;
      id: string;
      quantity: number;
    };

    const calls: Promise<void>[] = [];
    let descendantsBatch: BatchRow[] = [];
    let ancestorsBatch: BatchRow[] = [];

    if (direction === "down" || direction === "both") {
      calls.push(
        (async () => {
          const res = await client.rpc(
            "get_direct_descendants_of_tracked_entities_strict",
            { p_tracked_entity_ids: frontier }
          );
          descendantsBatch = (res.data ?? []) as BatchRow[];
        })()
      );
    }
    if (direction === "up" || direction === "both") {
      calls.push(
        (async () => {
          const res = await client.rpc(
            "get_direct_ancestors_of_tracked_entities_strict",
            { p_tracked_entity_ids: frontier }
          );
          ancestorsBatch = (res.data ?? []) as BatchRow[];
        })()
      );
    }

    await Promise.all(calls);

    const nextFrontier = new Set<string>();
    const newEntityIds = new Set<string>();
    const activityIds = new Set<string>();

    for (let i = 0; i < descendantsBatch.length; i++) {
      const row = descendantsBatch[i];
      if (!row?.id) continue;
      activityIds.add(row.trackedActivityId);
      const outputKey = `${row.trackedActivityId}:${row.sourceEntityId}`;
      if (!outputs.has(outputKey)) {
        outputs.set(outputKey, {
          trackedActivityId: row.trackedActivityId,
          trackedEntityId: row.sourceEntityId,
          quantity: row.quantity
        });
      }
      if (!visited.has(row.id)) {
        visited.add(row.id);
        newEntityIds.add(row.id);
        nextFrontier.add(row.id);
      }
      const inputKey = `${row.trackedActivityId}:${row.id}`;
      if (!inputs.has(inputKey)) {
        inputs.set(inputKey, {
          trackedActivityId: row.trackedActivityId,
          trackedEntityId: row.id,
          quantity: row.quantity
        });
      }
    }

    for (let i = 0; i < ancestorsBatch.length; i++) {
      const row = ancestorsBatch[i];
      if (!row?.id) continue;
      activityIds.add(row.trackedActivityId);
      const inputKey = `${row.trackedActivityId}:${row.sourceEntityId}`;
      if (!inputs.has(inputKey)) {
        inputs.set(inputKey, {
          trackedActivityId: row.trackedActivityId,
          trackedEntityId: row.sourceEntityId,
          quantity: row.quantity
        });
      }
      if (!visited.has(row.id)) {
        visited.add(row.id);
        newEntityIds.add(row.id);
        nextFrontier.add(row.id);
      }
      const outputKey = `${row.trackedActivityId}:${row.id}`;
      if (!outputs.has(outputKey)) {
        outputs.set(outputKey, {
          trackedActivityId: row.trackedActivityId,
          trackedEntityId: row.id,
          quantity: row.quantity
        });
      }
    }

    if (newEntityIds.size > 0) {
      const remainingCapacity = MAX_ENTITIES - entities.size;
      const idsToFetch = Array.from(newEntityIds).slice(0, remainingCapacity);
      const fetched = await client
        .from("trackedEntity")
        .select("*")
        .in("id", idsToFetch);
      for (const row of fetched.data ?? []) {
        entities.set(row.id, row as TrackedEntity);
      }
    }

    if (activityIds.size > 0) {
      await expandActivitySiblings(client, state, Array.from(activityIds));
    }

    frontier = Array.from(nextFrontier);
  }
}

function buildEntityPath(
  rootEntityId: string,
  activities: Activity[],
  inputs: ActivityInput[],
  outputs: ActivityOutput[]
): { keepEntities: Set<string>; keepActivities: Set<string> } {
  const activityById = new Map(activities.map((a) => [a.id, a]));

  const producedBy = new Map<string, string[]>();
  const consumedBy = new Map<string, string[]>();
  const activityOutputMap = new Map<string, string[]>();
  const activityInputMap = new Map<string, string[]>();

  for (const o of outputs) {
    (
      producedBy.get(o.trackedEntityId) ??
      (producedBy.set(o.trackedEntityId, []),
      producedBy.get(o.trackedEntityId)!)
    ).push(o.trackedActivityId);
    (
      activityOutputMap.get(o.trackedActivityId) ??
      (activityOutputMap.set(o.trackedActivityId, []),
      activityOutputMap.get(o.trackedActivityId)!)
    ).push(o.trackedEntityId);
  }
  for (const i of inputs) {
    (
      consumedBy.get(i.trackedEntityId) ??
      (consumedBy.set(i.trackedEntityId, []),
      consumedBy.get(i.trackedEntityId)!)
    ).push(i.trackedActivityId);
    (
      activityInputMap.get(i.trackedActivityId) ??
      (activityInputMap.set(i.trackedActivityId, []),
      activityInputMap.get(i.trackedActivityId)!)
    ).push(i.trackedEntityId);
  }

  const keepEntities = new Set<string>([rootEntityId]);
  const keepActivities = new Set<string>();

  // Backward: find what produced the root entity.
  // For Split activities, include sibling outputs (remainder) but not
  // sibling outputs of other activity types (e.g. serial peers from a Receipt).
  const bwQueue: string[] = [rootEntityId];
  while (bwQueue.length > 0) {
    const eId = bwQueue.pop()!;
    for (const aId of producedBy.get(eId) ?? []) {
      if (keepActivities.has(aId)) continue;
      keepActivities.add(aId);
      const a = activityById.get(aId);
      if (a?.type === "Split") {
        for (const sibId of activityOutputMap.get(aId) ?? []) {
          if (!keepEntities.has(sibId)) keepEntities.add(sibId);
        }
      }
      for (const upId of activityInputMap.get(aId) ?? []) {
        if (!keepEntities.has(upId)) {
          keepEntities.add(upId);
          bwQueue.push(upId);
        }
      }
    }
  }

  // Forward: find what consumed the root entity (and recursively downstream).
  const fwQueue: string[] = [rootEntityId];
  while (fwQueue.length > 0) {
    const eId = fwQueue.pop()!;
    for (const aId of consumedBy.get(eId) ?? []) {
      if (keepActivities.has(aId)) continue;
      keepActivities.add(aId);
      for (const downId of activityOutputMap.get(aId) ?? []) {
        if (!keepEntities.has(downId)) {
          keepEntities.add(downId);
          fwQueue.push(downId);
        }
      }
    }
  }

  return { keepEntities, keepActivities };
}

async function filterHistoricalActivities(
  client: SupabaseClient<Database>,
  state: LineageState,
  rootEntityId?: string
): Promise<{
  entities: TrackedEntity[];
  activities: Activity[];
  inputs: ActivityInput[];
  outputs: ActivityOutput[];
}> {
  // Collect readable PL IDs from picking-list-linked activities so we can
  // check whether each PL is still active (Confirmed). Cancelled/reversed PLs
  // produce Reverse activities and duplicate Consume/Split activities that
  // inflate the graph with historical noise.
  const plReadableIds = new Set<string>();
  for (const activity of state.activities.values()) {
    const src = activity.sourceDocument;
    const rid = activity.sourceDocumentReadableId;
    if ((src === "Picking List" || src === "Job Material") && rid) {
      plReadableIds.add(rid);
    }
  }

  const confirmedPlSet = new Set<string>();
  if (plReadableIds.size > 0) {
    const plData = await client
      .from("pickingList")
      .select("pickingListId")
      .in("pickingListId", Array.from(plReadableIds))
      .eq("status", "Confirmed");
    for (const pl of plData.data ?? []) {
      if (pl.pickingListId) confirmedPlSet.add(pl.pickingListId);
    }
  }

  const relevantActivities = Array.from(state.activities.values()).filter(
    (a) => {
      if (a.type === "Reverse") return false;
      const src = a.sourceDocument;
      if (src === "Picking List" || src === "Job Material") {
        return confirmedPlSet.has(a.sourceDocumentReadableId ?? "");
      }
      return true;
    }
  );

  const relevantActivityIds = new Set(relevantActivities.map((a) => a.id));
  const relevantInputs = Array.from(state.inputs.values()).filter((i) =>
    relevantActivityIds.has(i.trackedActivityId)
  );
  const relevantOutputs = Array.from(state.outputs.values()).filter((o) =>
    relevantActivityIds.has(o.trackedActivityId)
  );

  // Split activities reuse the original entity ID as both input (qty=originalQty)
  // and output (qty=pickedQty). This creates a cycle entity→Split→entity that
  // the DAG layout marks as a back-edge (0.2 opacity), making connections invisible.
  // Drop the self-loop input so the graph shows Split→entity cleanly.
  const splitSelfLoopKeys = new Set<string>();
  for (const a of relevantActivities) {
    if (a.type !== "Split") continue;
    const splitOutputEntityIds = new Set(
      relevantOutputs
        .filter((o) => o.trackedActivityId === a.id)
        .map((o) => o.trackedEntityId)
    );
    for (const i of relevantInputs) {
      if (
        i.trackedActivityId === a.id &&
        splitOutputEntityIds.has(i.trackedEntityId)
      ) {
        splitSelfLoopKeys.add(`${a.id}:${i.trackedEntityId}`);
      }
    }
  }
  const finalInputs =
    splitSelfLoopKeys.size > 0
      ? relevantInputs.filter(
          (i) =>
            !splitSelfLoopKeys.has(
              `${i.trackedActivityId}:${i.trackedEntityId}`
            )
        )
      : relevantInputs;

  // When a specific root entity is given (single-entity view), restrict the
  // payload to entities on the direct lineage path. This removes "siblings"
  // that share an upstream activity (e.g. serial entities from the same
  // receipt) while still keeping Split remainder entities.
  if (rootEntityId) {
    const { keepEntities, keepActivities } = buildEntityPath(
      rootEntityId,
      relevantActivities,
      finalInputs,
      relevantOutputs
    );
    const pathEntities = Array.from(state.entities.values()).filter((e) =>
      keepEntities.has(e.id)
    );
    const pathActivities = relevantActivities.filter((a) =>
      keepActivities.has(a.id)
    );
    const pathInputs = finalInputs.filter(
      (i) =>
        keepEntities.has(i.trackedEntityId) &&
        keepActivities.has(i.trackedActivityId)
    );
    const pathOutputs = relevantOutputs.filter(
      (o) =>
        keepEntities.has(o.trackedEntityId) &&
        keepActivities.has(o.trackedActivityId)
    );
    return {
      entities: pathEntities,
      inputs: pathInputs,
      outputs: pathOutputs,
      activities: pathActivities
    };
  }

  const entityIdsWithEdges = new Set<string>();
  for (const i of finalInputs) entityIdsWithEdges.add(i.trackedEntityId);
  for (const o of relevantOutputs) entityIdsWithEdges.add(o.trackedEntityId);

  const relevantEntities =
    entityIdsWithEdges.size > 0
      ? Array.from(state.entities.values()).filter((e) =>
          entityIdsWithEdges.has(e.id)
        )
      : Array.from(state.entities.values());

  return {
    entities: relevantEntities,
    inputs: finalInputs,
    outputs: relevantOutputs,
    activities: relevantActivities
  };
}

export async function fetchLineageSubgraph(
  client: SupabaseClient<Database>,
  rootEntityId: string,
  depth: number,
  direction: LineageDirection = "both"
): Promise<LineagePayload> {
  const safeDepth = clampDepth(depth);

  const rootEntity = await client
    .from("trackedEntity")
    .select("*")
    .eq("id", rootEntityId)
    .maybeSingle();

  const state = newLineageState();
  if (rootEntity.data)
    state.entities.set(rootEntity.data.id, rootEntity.data as TrackedEntity);

  // Pre-seed activities the root entity directly participates in.
  // The BFS batch RPCs require a peer entity on the other side of each
  // activity (via INNER JOIN), so terminal nodes — e.g. a Consumed entity
  // whose Consume activity has no output because the finished good is
  // not tracked — would be silently skipped. Seeding direct activities
  // first ensures they always appear regardless of output existence.
  const [directInputRows, directOutputRows] = await Promise.all([
    client
      .from("trackedActivityInput")
      .select("trackedActivityId")
      .eq("trackedEntityId", rootEntityId),
    client
      .from("trackedActivityOutput")
      .select("trackedActivityId")
      .eq("trackedEntityId", rootEntityId)
  ]);
  const directActivityIds = Array.from(
    new Set([
      ...(directInputRows.data ?? []).map((r) => r.trackedActivityId),
      ...(directOutputRows.data ?? []).map((r) => r.trackedActivityId)
    ])
  );
  if (directActivityIds.length > 0) {
    await expandActivitySiblings(client, state, directActivityIds);
  }

  await runLineageBfs(client, state, [rootEntityId], direction, safeDepth);

  return filterHistoricalActivities(client, state, rootEntityId);
}

export async function fetchJobStepRecords(
  client: SupabaseClient<Database>,
  jobId: string
): Promise<StepRecord[]> {
  const res = await client.rpc("get_job_operation_step_records", {
    p_job_id: jobId
  });
  if (!res.data) return [];
  return (res.data as any[]).map((r) => ({
    id: r.id,
    jobOperationStepId: r.jobOperationStepId,
    index: r.index,
    type: r.type,
    name: r.name,
    value: r.value,
    numericValue: r.numericValue,
    booleanValue: r.booleanValue,
    userValue: r.userValue,
    unitOfMeasureCode: r.unitOfMeasureCode,
    minValue: r.minValue,
    maxValue: r.maxValue,
    operationId: r.operationId,
    operationDescription: r.operationDescription,
    itemId: r.itemId,
    itemReadableId: r.itemReadableId,
    createdAt: r.createdAt,
    createdBy: r.createdBy
  }));
}

export async function fetchContainmentsForEntities(
  client: SupabaseClient<Database>,
  entityIds: string[]
): Promise<IssueContainment[]> {
  if (entityIds.length === 0) return [];

  // Single round-trip: PostgREST embed pulls the linked issue inline and
  // filters server-side to only Contained/Uncontained statuses.
  const res = await client
    .from("nonConformanceTrackedEntity")
    .select(
      `trackedEntityId,
       nonConformanceId,
       issue:issues!inner(id, status, priority, containmentStatus)`
    )
    .in("trackedEntityId", entityIds)
    .in("issue.containmentStatus", ["Contained", "Uncontained"]);

  const containments: IssueContainment[] = [];
  for (const row of res.data ?? []) {
    const issue = row.issue as {
      id: string | null;
      status: string | null;
      priority: string | null;
      containmentStatus: string | null;
    } | null;
    if (!issue) continue;
    const status = issue.containmentStatus;
    if (status !== "Contained" && status !== "Uncontained") continue;
    containments.push({
      id: issue.id ?? row.nonConformanceId,
      readableId: row.nonConformanceId,
      containmentStatus: status as IssueContainmentStatus,
      status: issue.status ?? "",
      priority: issue.priority ?? null,
      trackedEntityId: row.trackedEntityId
    });
  }
  return containments;
}

export async function fetchJobScopedLineage(
  client: SupabaseClient<Database>,
  jobId: string,
  depth: number
): Promise<LineagePayload> {
  const safeDepth = clampDepth(depth);

  const [seedEntitiesRes, seedActivitiesRes] = await Promise.all([
    client.from("trackedEntity").select("*").eq("attributes->>Job", jobId),
    client.from("trackedActivity").select("*").eq("attributes->>Job", jobId)
  ]);

  const state = newLineageState();
  for (const row of (seedEntitiesRes.data ?? []) as TrackedEntity[]) {
    state.entities.set(row.id, row);
  }
  for (const row of (seedActivitiesRes.data ?? []) as unknown as Activity[]) {
    state.activities.set(row.id, row);
  }

  if (state.activities.size > 0) {
    await expandActivitySiblings(
      client,
      state,
      Array.from(state.activities.keys())
    );
  }

  if (state.entities.size > 0) {
    await runLineageBfs(
      client,
      state,
      Array.from(state.entities.keys()),
      "both",
      safeDepth
    );
  }

  const filtered = await filterHistoricalActivities(client, state);

  const containments = await fetchContainmentsForEntities(
    client,
    filtered.entities.map((e) => e.id)
  );

  return { ...filtered, containments };
}

export function toGraphData(payload: LineagePayload): GraphData {
  const nodes = [
    ...payload.entities.map((entity) => ({
      id: entity.id,
      type: "entity" as const,
      data: entity,
      parentId: null
    })),
    ...payload.activities.map((activity) => ({
      id: activity.id,
      type: "activity" as const,
      data: activity,
      parentId: null
    }))
  ];

  const links = [
    ...payload.inputs.map((input) => ({
      source: input.trackedEntityId,
      target: input.trackedActivityId,
      type: "input" as const,
      quantity: input.quantity
    })),
    ...payload.outputs.map((output) => ({
      source: output.trackedActivityId,
      target: output.trackedEntityId,
      type: "output" as const,
      quantity: output.quantity
    }))
  ];

  return { nodes, links };
}
