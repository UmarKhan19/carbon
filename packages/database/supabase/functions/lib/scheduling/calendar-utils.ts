/**
 * Calendar expansion + slot-walking utilities for finite-capacity scheduling.
 * Pure functions — no DB access. The caller loads resourceCalendarShift /
 * resourceCalendarException rows and the location timezone, then expands them
 * into concrete UTC windows for the scheduling horizon.
 */

export type CalendarShiftRow = {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  startTime: string; // "HH:MM" or "HH:MM:SS", local to the calendar's timezone
  endTime: string;
};

export type CalendarExceptionRow = {
  startAt: Date;
  endAt: Date;
  type: "Closed" | "Open" | "ReducedCapacity";
  // Fraction of normal capacity (0..1) for ReducedCapacity; null = no reduction
  capacityOverride: number | null;
};

export type CalendarWindow = {
  start: Date;
  end: Date;
  capacityFactor: number; // 1 normally, <1 in a ReducedCapacity exception
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Timezone offset (ms to ADD to a UTC instant to get local wall time). */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return asUTC - date.getTime();
}

/** Local calendar date (y/m/d) of a UTC instant in a timezone. */
function localDateParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Convert a local wall-clock time on a local calendar day to the UTC instant.
 * `dayDate` is UTC midnight representing the local calendar day (its UTC
 * y/m/d fields ARE the local date). Two-pass offset correction handles DST.
 */
export function shiftTimeToDate(
  dayDate: Date,
  time: string,
  timezone: string
): Date {
  const [h, m, s] = time.split(":").map((v) => Number(v));
  const naive = new Date(
    Date.UTC(
      dayDate.getUTCFullYear(),
      dayDate.getUTCMonth(),
      dayDate.getUTCDate(),
      h ?? 0,
      m ?? 0,
      s ?? 0
    )
  );
  const offset1 = tzOffsetMs(naive, timezone);
  const corrected = new Date(naive.getTime() - offset1);
  const offset2 = tzOffsetMs(corrected, timezone);
  return new Date(naive.getTime() - offset2);
}

type RawInterval = { start: number; end: number; factor: number };

/** Clip an interval to [rangeStart, rangeEnd); null if empty. */
function clip(
  start: number,
  end: number,
  rangeStart: number,
  rangeEnd: number
): { start: number; end: number } | null {
  const s = Math.max(start, rangeStart);
  const e = Math.min(end, rangeEnd);
  return e > s ? { start: s, end: e } : null;
}

/**
 * Expand a weekly shift pattern + exceptions into concrete, disjoint,
 * chronologically sorted working windows over [rangeStart, rangeEnd).
 *
 * - Empty `shifts` => one 24x7 window covering the whole range (back-compat:
 *   a resource with no calendar is always open).
 * - `Open` exceptions add working time (factor 1).
 * - `Closed` exceptions remove working time.
 * - `ReducedCapacity` exceptions scale the overlapped portion's capacityFactor
 *   by `capacityOverride` (fraction of normal capacity; null = no reduction).
 * - An overnight shift row (endTime <= startTime) runs into the next day.
 */
export function expandCalendar(
  shifts: CalendarShiftRow[],
  exceptions: CalendarExceptionRow[],
  rangeStart: Date,
  rangeEnd: Date,
  timezone = "UTC"
): CalendarWindow[] {
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEnd.getTime();
  if (rangeEndMs <= rangeStartMs) {
    return [];
  }

  // 1. Base working intervals
  const base: RawInterval[] = [];
  if (shifts.length === 0) {
    base.push({ start: rangeStartMs, end: rangeEndMs, factor: 1 });
  } else {
    // Iterate local calendar days covering the range (pad one day each side
    // so overnight shifts and tz offsets can't clip the boundary days).
    const startLocal = localDateParts(rangeStart, timezone);
    let dayCursor = Date.UTC(
      startLocal.year,
      startLocal.month - 1,
      startLocal.day
    );
    dayCursor -= DAY_MS;
    const lastDay = rangeEndMs + DAY_MS;

    for (; dayCursor <= lastDay; dayCursor += DAY_MS) {
      const dayDate = new Date(dayCursor);
      const dow = dayDate.getUTCDay(); // weekday of the local calendar date
      for (const shift of shifts) {
        if (shift.dayOfWeek !== dow) continue;
        const start = shiftTimeToDate(dayDate, shift.startTime, timezone);
        let end = shiftTimeToDate(dayDate, shift.endTime, timezone);
        if (end.getTime() <= start.getTime()) {
          // overnight shift: ends the next local day
          end = shiftTimeToDate(
            new Date(dayCursor + DAY_MS),
            shift.endTime,
            timezone
          );
        }
        const clipped = clip(
          start.getTime(),
          end.getTime(),
          rangeStartMs,
          rangeEndMs
        );
        if (clipped) {
          base.push({ ...clipped, factor: 1 });
        }
      }
    }
  }

  // 2. Open exceptions add working time
  for (const ex of exceptions) {
    if (ex.type !== "Open") continue;
    const clipped = clip(
      ex.startAt.getTime(),
      ex.endAt.getTime(),
      rangeStartMs,
      rangeEndMs
    );
    if (clipped) {
      base.push({ ...clipped, factor: 1 });
    }
  }

  if (base.length === 0) {
    return [];
  }

  // 3. Boundary sweep -> disjoint segments (factor = max of covering windows)
  const closed = exceptions.filter((e) => e.type === "Closed");
  const reduced = exceptions.filter((e) => e.type === "ReducedCapacity");

  const boundaries = new Set<number>();
  for (const i of base) {
    boundaries.add(i.start);
    boundaries.add(i.end);
  }
  for (const ex of [...closed, ...reduced]) {
    const s = ex.startAt.getTime();
    const e = ex.endAt.getTime();
    if (e > rangeStartMs && s < rangeEndMs) {
      boundaries.add(Math.max(s, rangeStartMs));
      boundaries.add(Math.min(e, rangeEndMs));
    }
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);

  const result: CalendarWindow[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = sorted[i];
    const segEnd = sorted[i + 1];
    const mid = (segStart + segEnd) / 2;

    // covered by any working interval?
    let factor = 0;
    for (const interval of base) {
      if (interval.start <= segStart && interval.end >= segEnd) {
        factor = Math.max(factor, interval.factor);
      } else if (interval.start < segEnd && interval.end > segStart) {
        // partial overlap can't happen after the sweep unless boundaries
        // missed it; guard with midpoint containment
        if (interval.start <= mid && interval.end >= mid) {
          factor = Math.max(factor, interval.factor);
        }
      }
    }
    if (factor === 0) continue;

    // Closed removes the segment entirely
    if (
      closed.some(
        (ex) => ex.startAt.getTime() <= mid && ex.endAt.getTime() >= mid
      )
    ) {
      continue;
    }

    // ReducedCapacity scales the factor
    for (const ex of reduced) {
      if (ex.startAt.getTime() <= mid && ex.endAt.getTime() >= mid) {
        factor = Math.min(factor, factor * (ex.capacityOverride ?? 1));
      }
    }

    // merge with previous when contiguous and same factor
    const prev = result[result.length - 1];
    if (prev && prev.end.getTime() === segStart && prev.capacityFactor === factor) {
      prev.end = new Date(segEnd);
    } else {
      result.push({
        start: new Date(segStart),
        end: new Date(segEnd),
        capacityFactor: factor,
      });
    }
  }

  return result;
}

/** Count reservations overlapping [start, end). */
export function countOverlaps(
  reservations: { startAt: Date; endAt: Date }[],
  start: Date,
  end: Date
): number {
  const s = start.getTime();
  const e = end.getTime();
  let count = 0;
  for (const r of reservations) {
    if (r.startAt.getTime() < e && r.endAt.getTime() > s) {
      count++;
    }
  }
  return count;
}

export type SlotResult = { start: Date; end: Date } | null;

/**
 * Find the earliest interval >= earliestStart inside `windows` that
 * accumulates `durationHours` of working time. An operation may span multiple
 * windows (gaps between windows are non-working time and do not count toward
 * the duration). `isFree(start, end)` is consulted per candidate placement;
 * on rejection the walk resumes from `nextTryAfter` (or the next window
 * boundary when absent).
 */
export function findSlot(args: {
  windows: CalendarWindow[];
  durationHours: number;
  earliestStart: Date;
  isFree: (start: Date, end: Date) => { free: boolean; nextTryAfter?: Date };
}): SlotResult {
  const { windows, durationHours, earliestStart, isFree } = args;
  if (windows.length === 0) {
    return null;
  }

  const durationMs = durationHours * HOUR_MS;
  let candidate = earliestStart.getTime();

  // Cap iterations as a runaway guard; each iteration advances the candidate.
  for (let guard = 0; guard < 100_000; guard++) {
    // snap candidate into a window
    const windowIndex = windows.findIndex((w) => w.end.getTime() > candidate);
    if (windowIndex === -1) {
      return null; // horizon exhausted
    }
    const startMs = Math.max(candidate, windows[windowIndex].start.getTime());

    // accumulate working time across windows from startMs
    let remaining = durationMs;
    let endMs = startMs;
    let i = windowIndex;
    while (remaining > 0) {
      if (i >= windows.length) {
        return null; // cannot fit before the end of the horizon
      }
      const from = i === windowIndex ? startMs : windows[i].start.getTime();
      const available = windows[i].end.getTime() - from;
      if (available >= remaining) {
        endMs = from + remaining;
        remaining = 0;
      } else {
        remaining -= Math.max(available, 0);
        i++;
      }
    }

    const start = new Date(startMs);
    const end = new Date(endMs);
    const check = isFree(start, end);
    if (check.free) {
      return { start, end };
    }

    // advance: explicit hint, else the next window boundary
    let next = check.nextTryAfter?.getTime() ?? null;
    if (next === null || next <= candidate) {
      const nextBoundary = windows
        .map((w) => w.start.getTime())
        .find((b) => b > startMs);
      next = nextBoundary ?? null;
      if (next === null) {
        return null;
      }
    }
    candidate = next;
  }

  return null;
}
