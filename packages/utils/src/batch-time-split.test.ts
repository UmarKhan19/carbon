import { describe, expect, it } from "vitest";
import { sliceEventByWeight, splitSecondsByWeight } from "./batch-time-split";

describe("splitSecondsByWeight", () => {
  it("splits a 70-minute event across qty 5/20/10 into 10/40/20 minutes", () => {
    const shares = splitSecondsByWeight(70 * 60, [
      { id: "a", weight: 5 },
      { id: "b", weight: 20 },
      { id: "c", weight: 10 }
    ]);
    expect(shares).toEqual([
      { id: "a", durationSeconds: 10 * 60 },
      { id: "b", durationSeconds: 40 * 60 },
      { id: "c", durationSeconds: 20 * 60 }
    ]);
  });

  it("uses largest-remainder so shares sum EXACTLY to the total", () => {
    const total = 100;
    const shares = splitSecondsByWeight(total, [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
      { id: "c", weight: 1 }
    ]);
    expect(shares.reduce((s, x) => s + x.durationSeconds, 0)).toBe(total);
    // 33.33 each; leftover second goes to the first (tie broken by order).
    expect(shares.map((s) => s.durationSeconds)).toEqual([34, 33, 33]);
  });

  it("falls back to an even split when all weights are zero", () => {
    const shares = splitSecondsByWeight(90, [
      { id: "a", weight: 0 },
      { id: "b", weight: 0 },
      { id: "c", weight: 0 }
    ]);
    expect(shares.map((s) => s.durationSeconds)).toEqual([30, 30, 30]);
  });

  it("returns zero durations when the event has no duration", () => {
    expect(
      splitSecondsByWeight(0, [{ id: "a", weight: 5 }]).map(
        (s) => s.durationSeconds
      )
    ).toEqual([0]);
  });
});

describe("sliceEventByWeight", () => {
  it("produces contiguous windows that tile the recorded span", () => {
    const windows = sliceEventByWeight(
      {
        startTime: "2026-07-14T00:00:00.000Z",
        endTime: "2026-07-14T01:10:00.000Z"
      },
      [
        { id: "a", weight: 5 },
        { id: "b", weight: 20 },
        { id: "c", weight: 10 }
      ]
    );
    const [a, b, c] = windows;
    // Durations follow the proportional split.
    expect(windows.map((w) => w.durationSeconds)).toEqual([600, 2400, 1200]);
    // Windows are contiguous: each starts where the previous ended.
    expect(a!.startTime).toBe("2026-07-14T00:00:00.000Z");
    expect(a!.endTime).toBe(b!.startTime);
    expect(b!.endTime).toBe(c!.startTime);
    // Last window closes out the parent span exactly.
    expect(c!.endTime).toBe("2026-07-14T01:10:00.000Z");
  });
});
