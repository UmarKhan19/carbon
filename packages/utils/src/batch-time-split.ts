// Proportional time-splitting for a job operation batch.
//
// When a batch of N job operations runs on one batchable machine, the operator
// records ONE set of Setup/Labor/Machine `productionEvent` rows for the whole
// batch. At completion each recorded event is sliced into N per-member events
// whose durations are proportional to each member operation's planned quantity
// (weight = operationQuantity / Σ; equal weights only as a Σ=0 fallback).
//
// The split is materialized as contiguous sub-windows of the recorded span with
// largest-remainder rounding on whole seconds, so the per-member durations sum
// EXACTLY to the parent event duration (no drift, no gaps, no overlaps). Because
// the slices are real productionEvent rows, GL posting, job costing, and
// estimates-vs-actuals all show each job its proportional share with no
// special-casing.
//
// Pure module (no I/O) — the batch-operations edge function's completion path
// and any ERP costing surface can share this single source of truth.

export interface BatchMemberWeight {
  /** jobOperation id of the member. */
  id: string;
  /** Planned operation quantity; the proportional weight. May be 0. */
  weight: number;
}

export interface DurationShare {
  id: string;
  durationSeconds: number;
}

/**
 * Split `totalSeconds` across members proportionally to their weights using the
 * largest-remainder method, so the shares are whole seconds that sum EXACTLY to
 * `totalSeconds`. Members are kept in input order; leftover seconds go to the
 * largest fractional remainders (ties broken by input order for determinism).
 *
 * Weight Σ=0 (or a single member) falls back to an even split. Negative weights
 * are clamped to 0.
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

  // Σ=0 fallback: even split (still largest-remainder so it sums exactly).
  const effective = weightSum > 0 ? weights : members.map(() => 1);
  const effectiveSum = weightSum > 0 ? weightSum : members.length;

  const raw = effective.map((w) => (total * w) / effectiveSum);
  const floors = raw.map((r) => Math.floor(r));
  let remaining = total - floors.reduce((a, b) => a + b, 0);

  // Distribute leftover seconds to the largest fractional remainders.
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
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  durationSeconds: number;
}

/**
 * Slice a recorded event span [startTime, endTime) into contiguous per-member
 * sub-windows whose durations are the proportional split of the span. Windows
 * tile the parent span exactly: member k+1 starts where member k ends, and the
 * last window ends at the parent `endTime`.
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
    // Last member closes out any residual millisecond drift on the parent span.
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
