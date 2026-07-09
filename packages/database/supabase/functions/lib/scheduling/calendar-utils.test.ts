import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  type CalendarExceptionRow,
  type CalendarShiftRow,
  countOverlaps,
  expandCalendar,
  findSlot,
} from "./calendar-utils.ts";

const HOUR_MS = 3_600_000;

const utc = (iso: string) => new Date(iso);

// Mon-Fri 08:00-16:00 in UTC
const weekdayShifts: CalendarShiftRow[] = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: "08:00",
  endTime: "16:00",
}));

Deno.test("expandCalendar: weekly pattern across a week boundary", () => {
  // Fri 2026-01-02 .. Tue 2026-01-06 (Sat/Sun excluded)
  const windows = expandCalendar(
    weekdayShifts,
    [],
    utc("2026-01-02T00:00:00Z"),
    utc("2026-01-07T00:00:00Z")
  );
  assertEquals(windows.length, 3); // Fri, Mon, Tue
  assertEquals(windows[0].start.toISOString(), "2026-01-02T08:00:00.000Z");
  assertEquals(windows[0].end.toISOString(), "2026-01-02T16:00:00.000Z");
  assertEquals(windows[1].start.toISOString(), "2026-01-05T08:00:00.000Z");
  assertEquals(windows[2].start.toISOString(), "2026-01-06T08:00:00.000Z");
});

Deno.test("expandCalendar: split shifts (two rows same day)", () => {
  const shifts: CalendarShiftRow[] = [
    { dayOfWeek: 1, startTime: "06:00", endTime: "10:00" },
    { dayOfWeek: 1, startTime: "12:00", endTime: "18:00" },
  ];
  // Mon 2026-01-05
  const windows = expandCalendar(
    shifts,
    [],
    utc("2026-01-05T00:00:00Z"),
    utc("2026-01-06T00:00:00Z")
  );
  assertEquals(windows.length, 2);
  assertEquals(windows[0].start.toISOString(), "2026-01-05T06:00:00.000Z");
  assertEquals(windows[0].end.toISOString(), "2026-01-05T10:00:00.000Z");
  assertEquals(windows[1].start.toISOString(), "2026-01-05T12:00:00.000Z");
  assertEquals(windows[1].end.toISOString(), "2026-01-05T18:00:00.000Z");
});

Deno.test("expandCalendar: Closed exception removes a full day", () => {
  const exceptions: CalendarExceptionRow[] = [
    {
      startAt: utc("2026-01-05T00:00:00Z"),
      endAt: utc("2026-01-06T00:00:00Z"),
      type: "Closed",
      capacityOverride: null,
    },
  ];
  // Mon 2026-01-05 .. Tue 2026-01-06
  const windows = expandCalendar(
    weekdayShifts,
    exceptions,
    utc("2026-01-05T00:00:00Z"),
    utc("2026-01-07T00:00:00Z")
  );
  assertEquals(windows.length, 1); // only Tuesday survives
  assertEquals(windows[0].start.toISOString(), "2026-01-06T08:00:00.000Z");
});

Deno.test("expandCalendar: Open exception adds weekend time", () => {
  const exceptions: CalendarExceptionRow[] = [
    {
      startAt: utc("2026-01-03T09:00:00Z"), // Saturday
      endAt: utc("2026-01-03T13:00:00Z"),
      type: "Open",
      capacityOverride: null,
    },
  ];
  const windows = expandCalendar(
    weekdayShifts,
    exceptions,
    utc("2026-01-03T00:00:00Z"),
    utc("2026-01-04T00:00:00Z")
  );
  assertEquals(windows.length, 1);
  assertEquals(windows[0].start.toISOString(), "2026-01-03T09:00:00.000Z");
  assertEquals(windows[0].end.toISOString(), "2026-01-03T13:00:00.000Z");
  assertEquals(windows[0].capacityFactor, 1);
});

Deno.test("expandCalendar: ReducedCapacity splits a window", () => {
  const exceptions: CalendarExceptionRow[] = [
    {
      startAt: utc("2026-01-05T10:00:00Z"),
      endAt: utc("2026-01-05T12:00:00Z"),
      type: "ReducedCapacity",
      capacityOverride: 0.5,
    },
  ];
  const windows = expandCalendar(
    weekdayShifts,
    exceptions,
    utc("2026-01-05T00:00:00Z"),
    utc("2026-01-06T00:00:00Z")
  );
  assertEquals(windows.length, 3);
  assertEquals(windows[0].capacityFactor, 1);
  assertEquals(windows[1].start.toISOString(), "2026-01-05T10:00:00.000Z");
  assertEquals(windows[1].end.toISOString(), "2026-01-05T12:00:00.000Z");
  assertEquals(windows[1].capacityFactor, 0.5);
  assertEquals(windows[2].capacityFactor, 1);
});

Deno.test("expandCalendar: empty shifts => 24x7 window", () => {
  const windows = expandCalendar(
    [],
    [],
    utc("2026-01-05T00:00:00Z"),
    utc("2026-01-08T00:00:00Z")
  );
  assertEquals(windows.length, 1);
  assertEquals(windows[0].start.toISOString(), "2026-01-05T00:00:00.000Z");
  assertEquals(windows[0].end.toISOString(), "2026-01-08T00:00:00.000Z");
});

Deno.test("expandCalendar: DST transition day keeps local window length", () => {
  // US DST spring-forward: Sunday 2026-03-08 in America/Chicago.
  const shifts: CalendarShiftRow[] = [
    { dayOfWeek: 0, startTime: "08:00", endTime: "16:00" },
  ];
  const windows = expandCalendar(
    shifts,
    [],
    utc("2026-03-08T00:00:00Z"),
    utc("2026-03-09T12:00:00Z"),
    "America/Chicago"
  );
  assertEquals(windows.length, 1);
  // local 08:00-16:00 is still 8 wall-clock hours after the spring-forward
  assertEquals(
    (windows[0].end.getTime() - windows[0].start.getTime()) / HOUR_MS,
    8
  );
  // 08:00 CDT (UTC-5) = 13:00Z
  assertEquals(windows[0].start.toISOString(), "2026-03-08T13:00:00.000Z");
});

Deno.test("findSlot: spans two windows", () => {
  const windows = expandCalendar(
    weekdayShifts,
    [],
    utc("2026-01-05T00:00:00Z"),
    utc("2026-01-09T00:00:00Z")
  );
  // 10h duration: 6h left on Monday (starting 10:00) + 4h on Tuesday
  const slot = findSlot({
    windows,
    durationHours: 10,
    earliestStart: utc("2026-01-05T10:00:00Z"),
    isFree: () => ({ free: true }),
  });
  assert(slot);
  assertEquals(slot.start.toISOString(), "2026-01-05T10:00:00.000Z");
  assertEquals(slot.end.toISOString(), "2026-01-06T12:00:00.000Z");
});

Deno.test("findSlot: returns null when nothing fits before horizon end", () => {
  const windows = expandCalendar(
    weekdayShifts,
    [],
    utc("2026-01-05T00:00:00Z"),
    utc("2026-01-06T00:00:00Z") // one 8h day
  );
  const slot = findSlot({
    windows,
    durationHours: 9,
    earliestStart: utc("2026-01-05T00:00:00Z"),
    isFree: () => ({ free: true }),
  });
  assertEquals(slot, null);
});

Deno.test("findSlot: busy interval pushes the slot via nextTryAfter", () => {
  const windows = expandCalendar(
    weekdayShifts,
    [],
    utc("2026-01-05T00:00:00Z"),
    utc("2026-01-06T00:00:00Z")
  );
  const busyUntil = utc("2026-01-05T11:00:00Z");
  const slot = findSlot({
    windows,
    durationHours: 2,
    earliestStart: utc("2026-01-05T08:00:00Z"),
    isFree: (start) =>
      start.getTime() < busyUntil.getTime()
        ? { free: false, nextTryAfter: busyUntil }
        : { free: true },
  });
  assert(slot);
  assertEquals(slot.start.toISOString(), "2026-01-05T11:00:00.000Z");
  assertEquals(slot.end.toISOString(), "2026-01-05T13:00:00.000Z");
});

Deno.test("findSlot: rejection without hint advances to the next window", () => {
  const windows = expandCalendar(
    weekdayShifts,
    [],
    utc("2026-01-05T00:00:00Z"),
    utc("2026-01-07T00:00:00Z")
  );
  // everything on Monday is rejected; Tuesday is free
  const slot = findSlot({
    windows,
    durationHours: 4,
    earliestStart: utc("2026-01-05T08:00:00Z"),
    isFree: (start) =>
      start.getTime() < utc("2026-01-06T00:00:00Z").getTime()
        ? { free: false }
        : { free: true },
  });
  assert(slot);
  assertEquals(slot.start.toISOString(), "2026-01-06T08:00:00.000Z");
});

Deno.test("countOverlaps counts half-open interval intersections", () => {
  const reservations = [
    { startAt: utc("2026-01-05T08:00:00Z"), endAt: utc("2026-01-05T10:00:00Z") },
    { startAt: utc("2026-01-05T09:00:00Z"), endAt: utc("2026-01-05T11:00:00Z") },
    { startAt: utc("2026-01-05T10:00:00Z"), endAt: utc("2026-01-05T12:00:00Z") },
  ];
  assertEquals(
    countOverlaps(
      reservations,
      utc("2026-01-05T09:30:00Z"),
      utc("2026-01-05T10:00:00Z")
    ),
    2
  );
  // touching endpoints do not overlap (half-open)
  assertEquals(
    countOverlaps(
      reservations,
      utc("2026-01-05T12:00:00Z"),
      utc("2026-01-05T13:00:00Z")
    ),
    0
  );
});
