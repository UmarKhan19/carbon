import { deriveProficiency } from "./proficiency.ts";

export type QualifiedEmployee = {
  employeeId: string;
  active: boolean;
  trainingCompleted: boolean | null;
  lastTrainingDate: string | null;
  expiresAt: string | null;
  proficiencyOverride: number | null;
  curve: unknown;
  shadowWeeks: number;
};

/**
 * Whether an employee counts toward an ability's operator pool for an
 * operation starting at `earliestStart`. Expiry is compared against the
 * operation's start DATE ("YYYY-MM-DD" strings — `expiresAt` must be
 * normalized, see date-utils.ts): expired-as-of-start is excluded, expiring
 * after the start still counts.
 */
export function isEligibleOperator(
  employee: QualifiedEmployee,
  minimumProficiency: number | null,
  earliestStart: Date
): boolean {
  const startDateStr = earliestStart.toISOString().slice(0, 10);
  return (
    employee.active &&
    !!employee.trainingCompleted &&
    (employee.expiresAt === null || employee.expiresAt > startDateStr) &&
    deriveProficiency({
      curve: employee.curve,
      shadowWeeks: employee.shadowWeeks,
      lastTrainingDate: employee.lastTrainingDate,
      proficiencyOverride: employee.proficiencyOverride,
      asOf: earliestStart,
    }) >= (minimumProficiency ?? 0)
  );
}
