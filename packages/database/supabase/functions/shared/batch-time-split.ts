// Proportional time-splitting + completion planning for a job operation batch.
//
// Deno-side MIRROR of packages/utils/src/batch-time-split.ts. Deno edge functions
// cannot import workspace packages, so this pure logic is duplicated here. The
// canonical version (with the vitest coverage) is the @carbon/utils file — keep
// the two in sync. See .ai/specs/2026-07-03-job-operation-batching.md.

export interface BatchMemberWeight {
  id: string;
  weight: number;
}

export interface DurationShare {
  id: string;
  durationSeconds: number;
}

/**
 * Split `totalSeconds` across members proportionally to their weights using the
 * largest-remainder method, so the shares are whole seconds that sum EXACTLY to
 * `totalSeconds`. Weight Σ=0 falls back to an even split; negatives clamp to 0.
 */
export function splitSecondsByWeight(
  totalSeconds: number,
  members: BatchMemberWeight[]
): DurationShare[] {
  if (members.length === 0) return [];
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return members.map((m) => ({ id: m.id, durationSeconds: 0 }));
  }

  const total = Math.floor(totalSeconds);
  const weights = members.map((m) => (m.weight > 0 ? m.weight : 0));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const effective = weightSum > 0 ? weights : members.map(() => 1);
  const effectiveSum = weightSum > 0 ? weightSum : members.length;

  const raw = effective.map((w) => (total * w) / effectiveSum);
  const floors = raw.map((r) => Math.floor(r));
  let remaining = total - floors.reduce((a, b) => a + b, 0);

  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const shares = floors.slice();
  for (let k = 0; k < order.length && remaining > 0; k++) {
    const idx = order[k]!.i;
    shares[idx] = (shares[idx] ?? 0) + 1;
    remaining -= 1;
  }

  return members.map((m, i) => ({ id: m.id, durationSeconds: shares[i] ?? 0 }));
}

export interface EventWindow {
  id: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
}

/**
 * Slice a recorded event span [startTime, endTime) into contiguous per-member
 * sub-windows whose durations are the proportional split of the span.
 */
export function sliceEventByWeight(
  event: { startTime: string; endTime: string },
  members: BatchMemberWeight[]
): EventWindow[] {
  const startMs = Date.parse(event.startTime);
  const endMs = Date.parse(event.endTime);
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));

  const shares = splitSecondsByWeight(totalSeconds, members);

  let cursorMs = startMs;
  return shares.map((share, i) => {
    const windowStartMs = cursorMs;
    const windowEndMs =
      i === shares.length - 1
        ? endMs
        : windowStartMs + share.durationSeconds * 1000;
    cursorMs = windowEndMs;
    return {
      id: share.id,
      startTime: new Date(windowStartMs).toISOString(),
      endTime: new Date(windowEndMs).toISOString(),
      durationSeconds: share.durationSeconds
    };
  });
}

export interface BatchCompletionMember {
  jobOperationId: string;
  operationQuantity: number;
  quantity: number;
  scrapQuantity?: number;
}

export interface RecordedBatchEvent {
  id: string;
  type: string | null;
  startTime: string;
  endTime: string;
  workCenterId: string | null;
  employeeId: string | null;
}

export interface PlannedMemberEvent {
  jobOperationId: string;
  sourceEventId: string;
  type: string | null;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  workCenterId: string | null;
  employeeId: string | null;
}

export interface PlannedProductionQuantity {
  jobOperationId: string;
  type: "Production" | "Scrap";
  quantity: number;
}

export interface BatchCompletionPlan {
  memberEvents: PlannedMemberEvent[];
  quantities: PlannedProductionQuantity[];
}

/**
 * Build the exact per-member `productionEvent` + `productionQuantity` rows a
 * batch completion must write. Each recorded batch event is sliced across the
 * members proportionally to their planned `operationQuantity`; every member
 * emits a Production row (plus a Scrap row when `scrapQuantity > 0`).
 */
export function buildBatchCompletionPlan(
  events: RecordedBatchEvent[],
  members: BatchCompletionMember[]
): BatchCompletionPlan {
  const weights: BatchMemberWeight[] = members.map((m) => ({
    id: m.jobOperationId,
    weight: m.operationQuantity
  }));

  const memberEvents: PlannedMemberEvent[] = [];
  for (const event of events) {
    const windows = sliceEventByWeight(event, weights);
    for (const w of windows) {
      memberEvents.push({
        jobOperationId: w.id,
        sourceEventId: event.id,
        type: event.type,
        startTime: w.startTime,
        endTime: w.endTime,
        durationSeconds: w.durationSeconds,
        workCenterId: event.workCenterId,
        employeeId: event.employeeId
      });
    }
  }

  const quantities: PlannedProductionQuantity[] = [];
  for (const m of members) {
    quantities.push({
      jobOperationId: m.jobOperationId,
      type: "Production",
      quantity: m.quantity
    });
    if ((m.scrapQuantity ?? 0) > 0) {
      quantities.push({
        jobOperationId: m.jobOperationId,
        type: "Scrap",
        quantity: m.scrapQuantity as number
      });
    }
  }

  return { memberEvents, quantities };
}
