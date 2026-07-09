/**
 * Normalize a Postgres DATE column value to "YYYY-MM-DD".
 *
 * The `pg` driver returns DATE columns as JS Date objects (constructed at
 * LOCAL midnight). `String(date)` yields "Tue Jul 07 2026 ..." which compares
 * lexicographically GREATER than any "YYYY-MM-DD" string — silently breaking
 * every date comparison downstream (operator-pool expiry, capacity-override
 * effectivity). Local getters are used for Date inputs to match the driver's
 * local-midnight construction; string inputs are passed through.
 */
export function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = value as Date;
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}
