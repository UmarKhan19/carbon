/**
 * Finite slot allocator — places one operation into the earliest feasible
 * window on a work center, respecting parallel capacity (machine slots),
 * time-phased capacity overrides, and (optionally) qualified-operator pools.
 * Pure given preloaded data: no DB access, fully testable with fixtures.
 */

import {
  type CalendarWindow,
  countOverlaps,
  findSlot,
} from "./calendar-utils.ts";

export type ReservationInterval = { startAt: Date; endAt: Date };

export type CapacityOverrideRow = {
  effectiveFrom: string; // ISO date
  effectiveTo: string | null;
  parallelCapacity: number;
};

export type ResourceCapacityData = {
  workCenter: {
    id: string;
    parallelCapacity: number;
    efficiencyFactor: number;
    schedulingMode: "Finite" | "Infinite";
    requiredAbilityId?: string | null; // coarse skill fallback (not used by the allocator itself)
  };
  windows: CalendarWindow[]; // from expandCalendar, already tz-resolved
  capacityOverrides: CapacityOverrideRow[];
  reservations: ReservationInterval[]; // other jobs + earlier ops this run
};

export type OperatorPool = {
  abilityId: string;
  abilityName: string;
  poolSize: number; // # eligible operators (eligibility applied by caller)
  reservations: ReservationInterval[]; // existing OperatorPool reservations
};

export type AllocationSuccess = { start: Date; end: Date };
export type AllocationConflict = { conflict: string };
export type AllocationResult = AllocationSuccess | AllocationConflict;

export function isConflict(r: AllocationResult): r is AllocationConflict {
  return "conflict" in r;
}

/**
 * Effective parallel capacity of the work center on a given instant:
 * time-phased override row covering the date wins, else the scalar column;
 * scaled by the calendar window's capacityFactor (floored, min 0).
 */
export function effectiveParallelCapacity(
  capacity: ResourceCapacityData,
  at: Date,
  windowFactor: number
): number {
  const dateStr = at.toISOString().slice(0, 10);
  let base = capacity.workCenter.parallelCapacity;
  for (const row of capacity.capacityOverrides) {
    if (
      row.effectiveFrom <= dateStr &&
      (row.effectiveTo === null || row.effectiveTo >= dateStr)
    ) {
      base = row.parallelCapacity;
      break;
    }
  }
  return Math.max(0, Math.floor(base * windowFactor));
}

/** The calendar window covering an instant (windows are disjoint + sorted). */
function windowAt(windows: CalendarWindow[], at: number): CalendarWindow | null {
  for (const w of windows) {
    if (w.start.getTime() <= at && w.end.getTime() > at) {
      return w;
    }
  }
  return null;
}

/**
 * Check machine-capacity freeness of [start, end): at every point covered by
 * a calendar window, concurrent reservations must stay below the effective
 * parallel capacity. Returns the earliest reservation end inside the interval
 * as the retry hint when busy.
 */
function machineIsFree(
  capacity: ResourceCapacityData,
  start: Date,
  end: Date
): { free: boolean; nextTryAfter?: Date } {
  const s = start.getTime();
  const e = end.getTime();

  // capacity can only change at reservation boundaries, window boundaries,
  // or capacity-override date boundaries — sample at each
  const samplePoints = new Set<number>([s]);
  for (const r of capacity.reservations) {
    const rs = r.startAt.getTime();
    const re = r.endAt.getTime();
    if (rs > s && rs < e) samplePoints.add(rs);
    if (re > s && re < e) samplePoints.add(re);
  }
  for (const w of capacity.windows) {
    const ws = w.start.getTime();
    if (ws > s && ws < e) samplePoints.add(ws);
  }
  for (const row of capacity.capacityOverrides) {
    const from = new Date(`${row.effectiveFrom}T00:00:00Z`).getTime();
    if (from > s && from < e) samplePoints.add(from);
    if (row.effectiveTo) {
      const to = new Date(`${row.effectiveTo}T00:00:00Z`).getTime() + 86_400_000;
      if (to > s && to < e) samplePoints.add(to);
    }
  }

  for (const point of samplePoints) {
    const w = windowAt(capacity.windows, point);
    if (!w) continue; // non-working time inside the span — no capacity needed
    const at = new Date(point);
    const ceiling = effectiveParallelCapacity(capacity, at, w.capacityFactor);
    const concurrent = countOverlaps(
      capacity.reservations,
      at,
      new Date(point + 1)
    );
    if (concurrent >= ceiling) {
      // retry after the earliest reservation that ends inside/after this point
      const candidates = capacity.reservations
        .filter((r) => r.startAt.getTime() <= point && r.endAt.getTime() > point)
        .map((r) => r.endAt.getTime());
      const nextTry = candidates.length > 0 ? Math.min(...candidates) : null;
      return {
        free: false,
        nextTryAfter: nextTry !== null ? new Date(nextTry) : undefined,
      };
    }
  }

  return { free: true };
}

/**
 * Check operator-pool freeness of [start, end): for every required ability,
 * concurrent pool reservations must stay below the pool size.
 */
function poolsAreFree(
  pools: OperatorPool[],
  start: Date,
  end: Date
): { free: boolean; nextTryAfter?: Date } {
  for (const pool of pools) {
    const s = start.getTime();
    const e = end.getTime();
    const samplePoints = new Set<number>([s]);
    for (const r of pool.reservations) {
      const rs = r.startAt.getTime();
      const re = r.endAt.getTime();
      if (rs > s && rs < e) samplePoints.add(rs);
      if (re > s && re < e) samplePoints.add(re);
    }
    for (const point of samplePoints) {
      const at = new Date(point);
      const concurrent = countOverlaps(pool.reservations, at, new Date(point + 1));
      if (concurrent >= pool.poolSize) {
        const candidates = pool.reservations
          .filter(
            (r) => r.startAt.getTime() <= point && r.endAt.getTime() > point
          )
          .map((r) => r.endAt.getTime());
        const nextTry = candidates.length > 0 ? Math.min(...candidates) : null;
        return {
          free: false,
          nextTryAfter: nextTry !== null ? new Date(nextTry) : undefined,
        };
      }
    }
  }
  return { free: true };
}

/**
 * Allocate one operation. Walks the work center's calendar forward from
 * `earliestStart` to the first interval where a machine slot AND (when
 * required) a qualified operator are simultaneously free — the DRC core.
 *
 * Callers must not invoke this for `schedulingMode === 'Infinite'` work
 * centers (current load-balancing behavior applies there); doing so anyway
 * returns a conflict so the bug is visible instead of silent.
 */
export function allocateOperation(args: {
  durationHours: number; // standard duration / workCenter.efficiencyFactor
  earliestStart: Date;
  horizonEnd: Date; // never walk unbounded
  capacity: ResourceCapacityData;
  operatorPools?: OperatorPool[];
}): AllocationResult {
  const { durationHours, earliestStart, horizonEnd, capacity } = args;
  const pools = args.operatorPools ?? [];

  if (capacity.workCenter.schedulingMode === "Infinite") {
    return {
      conflict:
        "allocateOperation called for an Infinite work center — use the load-balancing path",
    };
  }

  // A pool with zero eligible operators can never free up — immediate skill conflict
  for (const pool of pools) {
    if (pool.poolSize <= 0) {
      return {
        conflict: `No qualified operator for ${pool.abilityName}`,
      };
    }
  }

  // Clip the calendar to the horizon
  const windows = capacity.windows.filter(
    (w) => w.start.getTime() < horizonEnd.getTime()
  );
  if (windows.length === 0) {
    return {
      conflict: `No working calendar time available at work center before ${
        horizonEnd.toISOString().slice(0, 10)
      }`,
    };
  }

  const slot = findSlot({
    windows,
    durationHours,
    earliestStart,
    isFree: (start, end) => {
      if (end.getTime() > horizonEnd.getTime()) {
        return { free: false }; // past the horizon; findSlot will exhaust
      }
      const machine = machineIsFree(capacity, start, end);
      if (!machine.free) {
        return machine;
      }
      return poolsAreFree(pools, start, end);
    },
  });

  if (!slot) {
    const cause =
      pools.length > 0
        ? "No slot with both machine capacity and a qualified operator"
        : "No machine capacity";
    return {
      conflict: `${cause} available before ${
        horizonEnd.toISOString().slice(0, 10)
      }`,
    };
  }

  return slot;
}
