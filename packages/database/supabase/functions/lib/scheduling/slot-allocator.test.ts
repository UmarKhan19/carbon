import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { expandCalendar } from "./calendar-utils.ts";
import {
  type AllocationResult,
  allocateOperation,
  isConflict,
  type ResourceCapacityData,
} from "./slot-allocator.ts";

const utc = (iso: string) => new Date(iso);

// Mon-Fri 08:00-16:00 UTC over two weeks starting Mon 2026-01-05
const weekdayShifts = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: "08:00",
  endTime: "16:00",
}));

function makeCapacity(
  overrides: Partial<ResourceCapacityData["workCenter"]> = {},
  extra: Partial<Omit<ResourceCapacityData, "workCenter">> = {}
): ResourceCapacityData {
  return {
    workCenter: {
      id: "wc1",
      parallelCapacity: 1,
      efficiencyFactor: 1,
      schedulingMode: "Finite",
      ...overrides,
    },
    windows:
      extra.windows ??
      expandCalendar(
        weekdayShifts,
        [],
        utc("2026-01-05T00:00:00Z"),
        utc("2026-01-17T00:00:00Z")
      ),
    capacityOverrides: extra.capacityOverrides ?? [],
    reservations: extra.reservations ?? [],
  };
}

const HORIZON = utc("2026-01-17T00:00:00Z");

function expectSlot(r: AllocationResult): { start: Date; end: Date } {
  assert(!isConflict(r), `expected slot, got conflict: ${JSON.stringify(r)}`);
  return r;
}

Deno.test("fills a 1-capacity work center sequentially", () => {
  const capacity = makeCapacity();
  const placed: { start: Date; end: Date }[] = [];

  for (let i = 0; i < 3; i++) {
    const slot = expectSlot(
      allocateOperation({
        durationHours: 4,
        earliestStart: utc("2026-01-05T08:00:00Z"),
        horizonEnd: HORIZON,
        capacity,
      })
    );
    placed.push(slot);
    capacity.reservations.push({ startAt: slot.start, endAt: slot.end });
  }

  assertEquals(placed[0].start.toISOString(), "2026-01-05T08:00:00.000Z");
  assertEquals(placed[0].end.toISOString(), "2026-01-05T12:00:00.000Z");
  assertEquals(placed[1].start.toISOString(), "2026-01-05T12:00:00.000Z");
  assertEquals(placed[2].start.toISOString(), "2026-01-06T08:00:00.000Z");
});

Deno.test("parallel ops overlap when parallelCapacity = 2", () => {
  const capacity = makeCapacity({ parallelCapacity: 2 });

  const first = expectSlot(
    allocateOperation({
      durationHours: 4,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity,
    })
  );
  capacity.reservations.push({ startAt: first.start, endAt: first.end });

  const second = expectSlot(
    allocateOperation({
      durationHours: 4,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity,
    })
  );

  // both fit simultaneously
  assertEquals(second.start.toISOString(), first.start.toISOString());
});

Deno.test("never overbooks across many placements (boundary sweep)", () => {
  const capacity = makeCapacity({ parallelCapacity: 2 });
  const durations = [2, 5, 1, 3, 7, 2, 4, 6, 1, 3]; // varied fixture

  for (const durationHours of durations) {
    const slot = expectSlot(
      allocateOperation({
        durationHours,
        earliestStart: utc("2026-01-05T08:00:00Z"),
        horizonEnd: HORIZON,
        capacity,
      })
    );
    capacity.reservations.push({ startAt: slot.start, endAt: slot.end });
  }

  // sweep all reservation boundaries: concurrency must never exceed 2
  const boundaries = capacity.reservations
    .flatMap((r) => [r.startAt.getTime(), r.endAt.getTime()])
    .sort((a, b) => a - b);
  for (const b of boundaries) {
    const concurrent = capacity.reservations.filter(
      (r) => r.startAt.getTime() <= b && r.endAt.getTime() > b
    ).length;
    assert(
      concurrent <= 2,
      `overbooked: ${concurrent} concurrent at ${new Date(b).toISOString()}`
    );
  }
});

Deno.test("capacity override window lowers capacity mid-horizon", () => {
  const capacity = makeCapacity(
    { parallelCapacity: 2 },
    {
      capacityOverrides: [
        {
          effectiveFrom: "2026-01-05",
          effectiveTo: "2026-01-05",
          parallelCapacity: 1,
        },
      ],
      reservations: [
        {
          startAt: utc("2026-01-05T08:00:00Z"),
          endAt: utc("2026-01-05T16:00:00Z"),
        },
      ],
    }
  );

  // Monday is overridden to capacity 1 and fully reserved -> lands Tuesday
  const slot = expectSlot(
    allocateOperation({
      durationHours: 4,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity,
    })
  );
  assertEquals(slot.start.toISOString(), "2026-01-06T08:00:00.000Z");
});

Deno.test("Closed exception pushes a slot to the next day", () => {
  const windows = expandCalendar(
    weekdayShifts,
    [
      {
        startAt: utc("2026-01-05T00:00:00Z"),
        endAt: utc("2026-01-06T00:00:00Z"),
        type: "Closed",
        capacityOverride: null,
      },
    ],
    utc("2026-01-05T00:00:00Z"),
    utc("2026-01-17T00:00:00Z")
  );
  const capacity = makeCapacity({}, { windows });

  const slot = expectSlot(
    allocateOperation({
      durationHours: 4,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity,
    })
  );
  assertEquals(slot.start.toISOString(), "2026-01-06T08:00:00.000Z");
});

Deno.test("Infinite mode is rejected (caller must bypass)", () => {
  const capacity = makeCapacity({ schedulingMode: "Infinite" });
  const result = allocateOperation({
    durationHours: 4,
    earliestStart: utc("2026-01-05T08:00:00Z"),
    horizonEnd: HORIZON,
    capacity,
  });
  assert(isConflict(result));
});

Deno.test("horizon exhaustion returns a machine-capacity conflict", () => {
  const capacity = makeCapacity(
    {},
    {
      // every working hour reserved for the whole horizon
      reservations: [
        {
          startAt: utc("2026-01-01T00:00:00Z"),
          endAt: utc("2026-02-01T00:00:00Z"),
        },
      ],
    }
  );
  const result = allocateOperation({
    durationHours: 4,
    earliestStart: utc("2026-01-05T08:00:00Z"),
    horizonEnd: HORIZON,
    capacity,
  });
  assert(isConflict(result));
  assert(result.conflict.includes("No machine capacity"));
});

// ============================================================================
// DRC (operator pool) cases
// ============================================================================

Deno.test("DRC core: poolSize 1 serializes ops even with parallelCapacity 2", () => {
  const capacity = makeCapacity({ parallelCapacity: 2 });
  const poolReservations: { startAt: Date; endAt: Date }[] = [];
  const pools = () => [
    {
      abilityId: "weld",
      abilityName: "Welding",
      poolSize: 1,
      reservations: poolReservations,
    },
  ];

  const first = expectSlot(
    allocateOperation({
      durationHours: 4,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity,
      operatorPools: pools(),
    })
  );
  capacity.reservations.push({ startAt: first.start, endAt: first.end });
  poolReservations.push({ startAt: first.start, endAt: first.end });

  const second = expectSlot(
    allocateOperation({
      durationHours: 4,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity,
      operatorPools: pools(),
    })
  );

  // machine had room for both, but the single welder forces serialization
  assertEquals(first.start.toISOString(), "2026-01-05T08:00:00.000Z");
  assertEquals(second.start.toISOString(), "2026-01-05T12:00:00.000Z");
});

Deno.test("poolSize 0 returns an immediate skill conflict naming the ability", () => {
  const capacity = makeCapacity();
  const result = allocateOperation({
    durationHours: 4,
    earliestStart: utc("2026-01-05T08:00:00Z"),
    horizonEnd: HORIZON,
    capacity,
    operatorPools: [
      { abilityId: "cnc", abilityName: "CNC", poolSize: 0, reservations: [] },
    ],
  });
  assert(isConflict(result));
  assertEquals(result.conflict, "No qualified operator for CNC");
});

Deno.test("ungated operation ignores operator pools entirely", () => {
  const capacity = makeCapacity();
  const slot = expectSlot(
    allocateOperation({
      durationHours: 4,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity,
      operatorPools: [],
    })
  );
  assertEquals(slot.start.toISOString(), "2026-01-05T08:00:00.000Z");
});
