/**
 * Derived operator proficiency (0..1) from an ability's learning curve.
 *
 * `ability.curve` JSONB shape: { data: [{ week: number, value: number }] }
 * where value is percent efficiency (0-100), e.g. the default curve is
 * week 0 → 50, week 1 → 80, week 2 → 90, week 3 → 100.
 *
 * Semantics:
 * - `proficiencyOverride` wins when non-null (already 0..1).
 * - No `lastTrainingDate` → 0 (never trained).
 * - Still inside `shadowWeeks` → 0 (shadowing, not productive).
 * - Otherwise linear interpolation of the curve at
 *   (weeks since training − shadowWeeks), clamped to the curve's ends.
 * - A missing/unparsable curve → 1 (no ramp modeling for this ability).
 *
 * Duplicated (small + pure) in apps/mes/app/services/proficiency.ts and
 * packages/database/supabase/functions/lib/scheduling/proficiency.ts —
 * keep the three copies in sync.
 */

const WEEK_MS = 7 * 24 * 3_600_000;

type CurvePoint = { week: number; value: number };

function parseCurve(curve: unknown): CurvePoint[] | null {
  if (!curve || typeof curve !== "object") return null;
  const data = (curve as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const points = data
    .filter(
      (p): p is CurvePoint =>
        !!p &&
        typeof p === "object" &&
        typeof (p as CurvePoint).week === "number" &&
        typeof (p as CurvePoint).value === "number"
    )
    .sort((a, b) => a.week - b.week);
  return points.length > 0 ? points : null;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function deriveProficiency(args: {
  curve: unknown; // ability.curve JSONB
  shadowWeeks: number;
  lastTrainingDate: string | null;
  proficiencyOverride: number | null;
  asOf?: Date;
}): number {
  if (
    args.proficiencyOverride !== null &&
    args.proficiencyOverride !== undefined
  ) {
    return clamp01(args.proficiencyOverride);
  }

  if (!args.lastTrainingDate) {
    return 0;
  }

  const asOf = args.asOf ?? new Date();
  const trained = new Date(args.lastTrainingDate);
  const weeksSince = (asOf.getTime() - trained.getTime()) / WEEK_MS;

  if (weeksSince < 0) {
    return 0;
  }

  const shadowWeeks = args.shadowWeeks ?? 0;
  if (weeksSince < shadowWeeks) {
    return 0;
  }

  const points = parseCurve(args.curve);
  if (!points) {
    return 1;
  }

  const effectiveWeeks = weeksSince - shadowWeeks;
  if (effectiveWeeks <= points[0].week) {
    return clamp01(points[0].value / 100);
  }
  const last = points[points.length - 1];
  if (effectiveWeeks >= last.week) {
    return clamp01(last.value / 100);
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (effectiveWeeks >= a.week && effectiveWeeks <= b.week) {
      const t = (effectiveWeeks - a.week) / (b.week - a.week);
      return clamp01((a.value + t * (b.value - a.value)) / 100);
    }
  }

  return clamp01(last.value / 100);
}
