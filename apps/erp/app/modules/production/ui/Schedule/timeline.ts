import type { GanttEvent } from "~/components/Gantt";

/**
 * Pure mapping from scheduling data (job operations, capacity reservations,
 * production events) to the Gantt trace-viewer's event model. All date math
 * lives here so it can be unit-tested without a loader.
 *
 * Time semantics:
 * - Reservations and production events carry clock-precise timestamps.
 * - Operation startDate/dueDate are date-only; dueDate is an INCLUSIVE end
 *   date, so a date-derived span ends at dueDate + 1 day. Date-derived spans
 *   are marked isPartial (approximate).
 */

const DAY_MS = 24 * 3_600_000;

export type TimelineJob = {
  id: string;
  readableId: string;
  status: string | null;
};

export type TimelineOperation = {
  id: string;
  description: string | null;
  order: number;
  status: string | null;
  startDate: string | null;
  dueDate: string | null;
  hasConflict: boolean | null;
  conflictReason: string | null;
  assigneeName: string | null;
  workCenterName: string | null;
  makeMethodId: string | null;
  makeMethodParentMaterialId: string | null;
  makeMethodItemReadableId: string | null;
};

export type TimelineReservation = {
  id: string;
  operationId: string;
  resourceKind: "WorkCenter" | "OperatorPool";
  resourceName: string;
  startAt: string;
  endAt: string;
};

export type TimelineProductionEvent = {
  id: string;
  operationId: string;
  type: string | null;
  employeeName: string | null;
  startTime: string;
  endTime: string | null;
};

export type TimelineNodeDetail = {
  kind: "job" | "assembly" | "operation" | "reservation" | "productionEvent";
  title: string;
  start: string | null; // ISO
  end: string | null; // ISO
  durationMs: number;
  approximate: boolean;
  status?: string | null;
  workCenterName?: string | null;
  assigneeName?: string | null;
  employeeName?: string | null;
  resourceKind?: "WorkCenter" | "OperatorPool";
  conflictReason?: string | null;
};

export type JobTimeline = {
  events: GanttEvent[];
  totalDuration: number;
  windowStart: Date | undefined;
  detailsById: Record<string, TimelineNodeDetail>;
};

type Span = { start: number; end: number; approximate: boolean };

function parseDateOnly(date: string): number {
  return Date.parse(date);
}

function operationSpan(
  op: TimelineOperation,
  reservations: TimelineReservation[],
  fallbackStart: number,
  now: number
): Span {
  if (reservations.length > 0) {
    const start = Math.min(...reservations.map((r) => Date.parse(r.startAt)));
    const end = Math.max(...reservations.map((r) => Date.parse(r.endAt)));
    return { start, end: Math.max(end, start), approximate: false };
  }

  if (op.startDate) {
    const start = parseDateOnly(op.startDate);
    const end = op.dueDate ? parseDateOnly(op.dueDate) + DAY_MS : start;
    return { start, end: Math.max(end, start), approximate: true };
  }

  if (op.dueDate) {
    const end = parseDateOnly(op.dueDate) + DAY_MS;
    return { start: end - DAY_MS, end, approximate: true };
  }

  return { start: fallbackStart, end: fallbackStart, approximate: true };
}

export function buildJobTimeline(input: {
  job: TimelineJob;
  operations: TimelineOperation[];
  reservations: TimelineReservation[];
  productionEvents: TimelineProductionEvent[];
  now?: Date;
}): JobTimeline {
  const { job, operations, reservations, productionEvents } = input;
  const now = (input.now ?? new Date()).getTime();

  const reservationsByOperation = new Map<string, TimelineReservation[]>();
  for (const r of reservations) {
    const list = reservationsByOperation.get(r.operationId) ?? [];
    list.push(r);
    reservationsByOperation.set(r.operationId, list);
  }

  const eventsByOperation = new Map<string, TimelineProductionEvent[]>();
  for (const e of productionEvents) {
    const list = eventsByOperation.get(e.operationId) ?? [];
    list.push(e);
    eventsByOperation.set(e.operationId, list);
  }

  // Window = min/max over every timestamp we know about
  const timestamps: number[] = [];
  for (const r of reservations) {
    timestamps.push(Date.parse(r.startAt), Date.parse(r.endAt));
  }
  for (const e of productionEvents) {
    timestamps.push(Date.parse(e.startTime));
    timestamps.push(e.endTime ? Date.parse(e.endTime) : now);
  }
  for (const op of operations) {
    if (op.startDate) timestamps.push(parseDateOnly(op.startDate));
    if (op.dueDate) timestamps.push(parseDateOnly(op.dueDate) + DAY_MS);
  }

  const events: GanttEvent[] = [];
  const detailsById: Record<string, TimelineNodeDetail> = {};

  if (timestamps.length === 0) {
    const root: GanttEvent = {
      id: job.id,
      parentId: undefined,
      children: [],
      hasChildren: false,
      level: 0,
      data: {
        duration: 0,
        offset: 0,
        message: job.readableId,
        isRoot: true,
        isError: false,
        isPartial: true,
        isCancelled: false,
        level: "TRACE" as GanttEvent["data"]["level"],
        style: { icon: "job" }
      }
    };
    detailsById[job.id] = {
      kind: "job",
      title: job.readableId,
      start: null,
      end: null,
      durationMs: 0,
      approximate: true,
      status: job.status
    };
    return {
      events: [root],
      totalDuration: 0,
      windowStart: undefined,
      detailsById
    };
  }

  const windowStart = Math.min(...timestamps);
  const windowEnd = Math.max(...timestamps);
  const totalDuration = Math.max(windowEnd - windowStart, 1);

  const spanByOperation = new Map<string, Span>();
  for (const op of operations) {
    spanByOperation.set(
      op.id,
      operationSpan(
        op,
        reservationsByOperation.get(op.id) ?? [],
        windowStart,
        now
      )
    );
  }

  const sortedOperations = [...operations].sort((a, b) => {
    const sa = spanByOperation.get(a.id)!.start;
    const sb = spanByOperation.get(b.id)!.start;
    if (sa !== sb) return sa - sb;
    return a.order - b.order;
  });

  // Assembly grouping only when the job spans multiple make methods
  const makeMethodIds = new Set(
    operations.map((op) => op.makeMethodId).filter(Boolean)
  );
  const useAssemblies = makeMethodIds.size > 1;

  const anyConflict = operations.some((op) => !!op.hasConflict);

  const root: GanttEvent = {
    id: job.id,
    parentId: undefined,
    children: [],
    hasChildren: false,
    level: 0,
    data: {
      duration: totalDuration,
      offset: 0,
      message: job.readableId,
      isRoot: true,
      isError: anyConflict,
      isPartial: false,
      isCancelled: false,
      level: (anyConflict ? "ERROR" : "TRACE") as GanttEvent["data"]["level"],
      style: { icon: "job" }
    }
  };
  events.push(root);
  detailsById[job.id] = {
    kind: "job",
    title: job.readableId,
    start: new Date(windowStart).toISOString(),
    end: new Date(windowEnd).toISOString(),
    durationMs: totalDuration,
    approximate: false,
    status: job.status
  };

  const assemblyNodeByMakeMethod = new Map<string, GanttEvent>();
  if (useAssemblies) {
    for (const op of sortedOperations) {
      if (!op.makeMethodId) continue;
      if (assemblyNodeByMakeMethod.has(op.makeMethodId)) continue;
      const node: GanttEvent = {
        id: op.makeMethodId,
        parentId: job.id,
        children: [],
        hasChildren: false,
        level: 1,
        data: {
          duration: 0,
          offset: Number.MAX_SAFE_INTEGER,
          message: op.makeMethodItemReadableId ?? job.readableId,
          isRoot: false,
          isError: false,
          isPartial: false,
          isCancelled: false,
          level: "TRACE" as GanttEvent["data"]["level"],
          style: { icon: "assembly", variant: "primary" }
        }
      };
      assemblyNodeByMakeMethod.set(op.makeMethodId, node);
      root.children.push(node.id);
      root.hasChildren = true;
      events.push(node);
    }
  }

  for (const op of sortedOperations) {
    const span = spanByOperation.get(op.id)!;
    const parent =
      (useAssemblies &&
        op.makeMethodId &&
        assemblyNodeByMakeMethod.get(op.makeMethodId)) ||
      root;
    const level = parent.level + 1;
    const isError = !!op.hasConflict;

    const opEvent: GanttEvent = {
      id: op.id,
      parentId: parent.id,
      children: [],
      hasChildren: false,
      level,
      data: {
        duration: Math.max(span.end - span.start, 0),
        offset: span.start - windowStart,
        message: op.description ?? op.id,
        isRoot: false,
        isError,
        isPartial: span.approximate,
        isCancelled: false,
        level: (isError ? "ERROR" : "TRACE") as GanttEvent["data"]["level"],
        style: {
          icon: "operation",
          variant: "primary",
          ...(op.assigneeName
            ? {
                accessory: {
                  style: "person" as const,
                  items: [{ text: op.assigneeName }]
                }
              }
            : {})
        }
      }
    };
    parent.children.push(op.id);
    parent.hasChildren = true;
    events.push(opEvent);
    detailsById[op.id] = {
      kind: "operation",
      title: op.description ?? op.id,
      start: new Date(span.start).toISOString(),
      end: new Date(span.end).toISOString(),
      durationMs: Math.max(span.end - span.start, 0),
      approximate: span.approximate,
      status: op.status,
      workCenterName: op.workCenterName,
      assigneeName: op.assigneeName,
      conflictReason: op.hasConflict ? op.conflictReason : null
    };

    // Grow the assembly node to cover its operations
    if (parent !== root) {
      parent.data.offset = Math.min(
        parent.data.offset,
        span.start - windowStart
      );
      parent.data.duration = Math.max(
        parent.data.duration,
        span.end - windowStart - parent.data.offset
      );
      if (isError) {
        parent.data.isError = true;
        parent.data.level = "ERROR" as GanttEvent["data"]["level"];
      }
    }

    // Child rows: reservations (machine + operator pool)
    for (const r of reservationsByOperation.get(op.id) ?? []) {
      const rStart = Date.parse(r.startAt);
      const rEnd = Date.parse(r.endAt);
      const child: GanttEvent = {
        id: r.id,
        parentId: op.id,
        children: [],
        hasChildren: false,
        level: level + 1,
        data: {
          duration: Math.max(rEnd - rStart, 0),
          offset: rStart - windowStart,
          message: r.resourceName,
          isRoot: false,
          isError: false,
          isPartial: false,
          isCancelled: false,
          level: "TRACE" as GanttEvent["data"]["level"],
          style: {
            icon: r.resourceKind === "WorkCenter" ? "operation" : "wait",
            variant: "primary"
          }
        }
      };
      opEvent.children.push(child.id);
      opEvent.hasChildren = true;
      events.push(child);
      detailsById[r.id] = {
        kind: "reservation",
        title: r.resourceName,
        start: new Date(rStart).toISOString(),
        end: new Date(rEnd).toISOString(),
        durationMs: Math.max(rEnd - rStart, 0),
        approximate: false,
        resourceKind: r.resourceKind
      };
    }

    // Child rows: actual production events (timecards)
    for (const e of eventsByOperation.get(op.id) ?? []) {
      const eStart = Date.parse(e.startTime);
      const eEnd = e.endTime ? Date.parse(e.endTime) : now;
      const child: GanttEvent = {
        id: e.id,
        parentId: op.id,
        children: [],
        hasChildren: false,
        level: level + 1,
        data: {
          duration: Math.max(eEnd - eStart, 0),
          offset: eStart - windowStart,
          message: e.type ?? "Timecard",
          isRoot: false,
          isError: false,
          isPartial: !e.endTime,
          isCancelled: false,
          level: "TRACE" as GanttEvent["data"]["level"],
          style: {
            icon: "timecard",
            variant: "primary",
            ...(e.employeeName
              ? {
                  accessory: {
                    style: "person" as const,
                    items: [{ text: e.employeeName }]
                  }
                }
              : {})
          }
        }
      };
      opEvent.children.push(child.id);
      opEvent.hasChildren = true;
      events.push(child);
      detailsById[e.id] = {
        kind: "productionEvent",
        title: e.type ?? "Timecard",
        start: new Date(eStart).toISOString(),
        end: e.endTime ? new Date(eEnd).toISOString() : null,
        durationMs: Math.max(eEnd - eStart, 0),
        approximate: !e.endTime,
        employeeName: e.employeeName
      };
    }
  }

  return {
    events,
    totalDuration,
    windowStart: new Date(windowStart),
    detailsById
  };
}
