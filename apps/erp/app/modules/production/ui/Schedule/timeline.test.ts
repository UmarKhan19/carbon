import { describe, expect, it } from "vitest";
import type {
  TimelineOperation,
  TimelineProductionEvent,
  TimelineReservation
} from "./timeline";
import { buildJobTimeline } from "./timeline";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const job = { id: "job-1", readableId: "J000008", status: "Ready" };

function op(overrides: Partial<TimelineOperation>): TimelineOperation {
  return {
    id: "op-1",
    description: "Weld Frame",
    order: 1,
    status: "Todo",
    startDate: null,
    dueDate: null,
    hasConflict: false,
    conflictReason: null,
    assigneeName: null,
    workCenterName: "Weld Cell 1",
    makeMethodId: "jmm-1",
    makeMethodParentMaterialId: null,
    makeMethodItemReadableId: "WELD-FRAME-01",
    ...overrides
  };
}

function reservation(
  overrides: Partial<TimelineReservation>
): TimelineReservation {
  return {
    id: "res-1",
    operationId: "op-1",
    resourceKind: "WorkCenter",
    resourceName: "Weld Cell 1",
    startAt: "2026-07-10T08:00:00.000Z",
    endAt: "2026-07-13T10:30:00.000Z",
    ...overrides
  };
}

describe("buildJobTimeline", () => {
  it("computes offsets and durations from reservations", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({})],
      reservations: [reservation({})],
      productionEvents: []
    });

    const root = result.events.find((e) => e.id === "job-1")!;
    const operation = result.events.find((e) => e.id === "op-1")!;

    expect(result.windowStart?.toISOString()).toBe("2026-07-10T08:00:00.000Z");
    expect(root.data.offset).toBe(0);
    expect(root.data.duration).toBe(result.totalDuration);
    expect(operation.data.offset).toBe(0);
    expect(operation.data.duration).toBe(3 * DAY + 2.5 * HOUR);
    expect(operation.data.isPartial).toBe(false);
    expect(operation.parentId).toBe("job-1"); // single make method → no assembly node
  });

  it("falls back to date-only spans with inclusive dueDate, marked approximate", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({ startDate: "2026-07-10", dueDate: "2026-07-13" })],
      reservations: [],
      productionEvents: []
    });

    const operation = result.events.find((e) => e.id === "op-1")!;
    expect(operation.data.isPartial).toBe(true);
    // inclusive dueDate → ends at start of 07-14
    expect(operation.data.duration).toBe(4 * DAY);
  });

  it("marks conflicted operations as errors and bubbles to job + assembly", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        op({
          hasConflict: true,
          conflictReason: "No qualified operator for Welding",
          startDate: "2026-07-10"
        }),
        op({
          id: "op-2",
          makeMethodId: "jmm-2",
          makeMethodItemReadableId: "SUB-01",
          startDate: "2026-07-11"
        })
      ],
      reservations: [],
      productionEvents: []
    });

    const operation = result.events.find((e) => e.id === "op-1")!;
    const assembly = result.events.find((e) => e.id === "jmm-1")!;
    const root = result.events.find((e) => e.id === "job-1")!;

    expect(operation.data.isError).toBe(true);
    expect(operation.data.level).toBe("ERROR");
    expect(assembly.data.isError).toBe(true);
    expect(root.data.isError).toBe(true);
    expect(result.detailsById["op-1"].conflictReason).toBe(
      "No qualified operator for Welding"
    );
  });

  it("groups operations under assembly nodes when there are multiple make methods", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        op({ startDate: "2026-07-10", dueDate: "2026-07-10" }),
        op({
          id: "op-2",
          makeMethodId: "jmm-2",
          makeMethodItemReadableId: "SUB-01",
          startDate: "2026-07-11",
          dueDate: "2026-07-12"
        })
      ],
      reservations: [],
      productionEvents: []
    });

    const assembly1 = result.events.find((e) => e.id === "jmm-1")!;
    const assembly2 = result.events.find((e) => e.id === "jmm-2")!;
    const op2 = result.events.find((e) => e.id === "op-2")!;

    expect(assembly1.parentId).toBe("job-1");
    expect(op2.parentId).toBe("jmm-2");
    // assembly span covers its operation
    expect(assembly2.data.offset).toBe(1 * DAY);
    expect(assembly2.data.duration).toBe(2 * DAY);
    expect(assembly1.data.style.icon).toBe("assembly");
  });

  it("adds machine + operator-pool reservation child rows", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({})],
      reservations: [
        reservation({}),
        reservation({
          id: "res-2",
          resourceKind: "OperatorPool",
          resourceName: "Welding"
        })
      ],
      productionEvents: []
    });

    const operation = result.events.find((e) => e.id === "op-1")!;
    const pool = result.events.find((e) => e.id === "res-2")!;

    expect(operation.children).toEqual(["res-1", "res-2"]);
    expect(pool.data.message).toBe("Welding");
    expect(result.detailsById["res-2"].resourceKind).toBe("OperatorPool");
  });

  it("renders open production events up to now as partial, with person accessory", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    const events: TimelineProductionEvent[] = [
      {
        id: "pe-1",
        operationId: "op-1",
        type: "Labor",
        employeeName: "Anne Barbin",
        startTime: "2026-07-10T09:00:00.000Z",
        endTime: null
      }
    ];

    const result = buildJobTimeline({
      job,
      operations: [op({})],
      reservations: [reservation({})],
      productionEvents: events,
      now
    });

    const timecard = result.events.find((e) => e.id === "pe-1")!;
    expect(timecard.data.isPartial).toBe(true);
    expect(timecard.data.duration).toBe(3 * HOUR);
    expect(timecard.data.style.accessory?.items[0]?.text).toBe("Anne Barbin");
    expect(result.detailsById["pe-1"].end).toBeNull();
  });

  it("returns an empty-window timeline when nothing is scheduled", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({ workCenterName: null })],
      reservations: [],
      productionEvents: []
    });

    expect(result.windowStart).toBeUndefined();
    expect(result.totalDuration).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].data.isRoot).toBe(true);
  });
});
