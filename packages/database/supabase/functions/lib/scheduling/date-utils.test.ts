import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { toIsoDate } from "./date-utils.ts";

Deno.test("toIsoDate converts a pg DATE (local-midnight Date object) to YYYY-MM-DD", () => {
  // node-postgres constructs DATE columns as new Date(y, m, d) — LOCAL midnight
  const localMidnight = new Date(2026, 6, 7);
  assertEquals(toIsoDate(localMidnight), "2026-07-07");
});

Deno.test("toIsoDate is stable across month/day padding", () => {
  assertEquals(toIsoDate(new Date(2026, 0, 3)), "2026-01-03");
  assertEquals(toIsoDate(new Date(2026, 11, 31)), "2026-12-31");
});

Deno.test("toIsoDate passes date strings through", () => {
  assertEquals(toIsoDate("2026-07-07"), "2026-07-07");
  // timestamps are truncated to the date part
  assertEquals(toIsoDate("2026-07-07T00:00:00.000Z"), "2026-07-07");
});

Deno.test("toIsoDate maps null/undefined to null", () => {
  assertEquals(toIsoDate(null), null);
  assertEquals(toIsoDate(undefined), null);
});

Deno.test("regression: String(Date) breaks lexicographic date comparison; toIsoDate fixes it", () => {
  const expiredDate = new Date(2026, 6, 7); // expired 2026-07-07
  const opStart = "2026-07-17";

  // The bug: "Tue Jul 07 2026 ..." > "2026-07-17" (letters sort after digits),
  // so an EXPIRED qualification passed an `expiresAt > startDate` check.
  assert(String(expiredDate) > opStart);

  // Normalized, the comparison is correct: expired-as-of-start fails the check.
  assert(!(toIsoDate(expiredDate)! > opStart));
});
