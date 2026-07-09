import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { toIsoDate } from "./date-utils.ts";
import {
  isEligibleOperator,
  type QualifiedEmployee,
} from "./operator-eligibility.ts";

const opStart = new Date("2026-07-17T08:00:00.000Z");

function employee(
  overrides: Partial<QualifiedEmployee> = {}
): QualifiedEmployee {
  return {
    employeeId: "emp-1",
    active: true,
    trainingCompleted: true,
    // trained long ago → derived proficiency clamps to the curve's top (1)
    lastTrainingDate: "2026-01-01",
    expiresAt: null,
    proficiencyOverride: null,
    curve: {
      data: [
        { week: 0, value: 50 },
        { week: 1, value: 80 },
        { week: 2, value: 90 },
        { week: 3, value: 100 },
      ],
    },
    shadowWeeks: 0,
    ...overrides,
  };
}

Deno.test("expired-as-of-op-start is excluded from the pool", () => {
  const expired = employee({ expiresAt: "2026-07-07" });
  assertEquals(isEligibleOperator(expired, null, opStart), false);
});

Deno.test("expiring after the op start still counts", () => {
  const stillValid = employee({ expiresAt: "2026-07-20" });
  assertEquals(isEligibleOperator(stillValid, null, opStart), true);
});

Deno.test("expiring exactly on the op start date is excluded (strict >)", () => {
  const expiresToday = employee({ expiresAt: "2026-07-17" });
  assertEquals(isEligibleOperator(expiresToday, null, opStart), false);
});

Deno.test("null expiry never expires", () => {
  assertEquals(isEligibleOperator(employee(), null, opStart), true);
});

Deno.test("inactive or not-training-completed are excluded regardless of expiry", () => {
  assertEquals(
    isEligibleOperator(employee({ active: false }), null, opStart),
    false
  );
  assertEquals(
    isEligibleOperator(employee({ trainingCompleted: false }), null, opStart),
    false
  );
});

Deno.test("minimumProficiency gates on override; null minimum means any qualified operator", () => {
  const belowMinimum = employee({ proficiencyOverride: 0.5 });
  assertEquals(isEligibleOperator(belowMinimum, 0.8, opStart), false);
  assertEquals(isEligibleOperator(belowMinimum, null, opStart), true);
});

Deno.test("still inside shadow weeks → proficiency 0 → fails a positive minimum", () => {
  const shadowing = employee({
    lastTrainingDate: "2026-07-10",
    shadowWeeks: 4,
  });
  assertEquals(isEligibleOperator(shadowing, 0.1, opStart), false);
  // but a null minimum (threshold 0) still admits them
  assertEquals(isEligibleOperator(shadowing, null, opStart), true);
});

Deno.test("regression: pg DATE object stringified via String() defeated the expiry check; toIsoDate restores it", () => {
  const pgDateExpired = new Date(2026, 6, 7); // DATE '2026-07-07' as returned by pg

  // Pre-fix behavior: String(...) made the expired welder eligible
  const broken = employee({ expiresAt: String(pgDateExpired) });
  assertEquals(isEligibleOperator(broken, null, opStart), true);

  // Post-fix behavior: normalized date excludes them
  const normalized = employee({ expiresAt: toIsoDate(pgDateExpired) });
  assertEquals(isEligibleOperator(normalized, null, opStart), false);
  assert(toIsoDate(pgDateExpired) === "2026-07-07");
});
