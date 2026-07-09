import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { inngest } from "../../client";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEKS_TO_ROLL_UP = 5; // current ISO week + next 4

type ShiftRow = {
  resourceCalendarId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

type ExceptionRow = {
  resourceCalendarId: string;
  startAt: string;
  endAt: string;
  type: "Closed" | "Open" | "ReducedCapacity";
};

/** Monday 00:00 UTC of the ISO week containing `date`. */
function isoWeekStart(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

function shiftHours(shift: { startTime: string; endTime: string }): number {
  const [sh, sm] = shift.startTime.split(":").map(Number);
  const [eh, em] = shift.endTime.split(":").map(Number);
  const start = (sh ?? 0) * 60 + (sm ?? 0);
  let end = (eh ?? 0) * 60 + (em ?? 0);
  if (end <= start) end += 24 * 60; // overnight shift
  return (end - start) / 60;
}

/**
 * Working hours in [weekStart, weekEnd) for a calendar set: recurring shift
 * hours per weekday, minus the shift hours of days fully covered by a Closed
 * exception. Approximation: computed in UTC and partial-day closures are
 * ignored — good enough for a weekly utilization rollup.
 */
function weeklyAvailableHours(
  shifts: ShiftRow[],
  exceptions: ExceptionRow[],
  weekStart: Date,
  weekEnd: Date
): number {
  if (shifts.length === 0) {
    // No calendar => always open (matches scheduler back-compat)
    return (weekEnd.getTime() - weekStart.getTime()) / HOUR_MS;
  }

  let hours = 0;
  for (let t = weekStart.getTime(); t < weekEnd.getTime(); t += DAY_MS) {
    const day = new Date(t);
    const dow = day.getUTCDay();
    const dayShifts = shifts.filter((s) => s.dayOfWeek === dow);
    if (dayShifts.length === 0) continue;

    const dayClosed = exceptions.some(
      (e) =>
        e.type === "Closed" &&
        new Date(e.startAt).getTime() <= t &&
        new Date(e.endAt).getTime() >= t + DAY_MS
    );
    if (dayClosed) continue;

    for (const s of dayShifts) {
      hours += shiftHours(s);
    }
  }
  return hours;
}

/** Overlap of [aStart, aEnd) and [bStart, bEnd) in hours. */
function overlapHours(
  aStart: string,
  aEnd: string,
  bStart: Date,
  bEnd: Date
): number {
  const start = Math.max(new Date(aStart).getTime(), bStart.getTime());
  const end = Math.min(new Date(aEnd).getTime(), bEnd.getTime());
  return end > start ? (end - start) / HOUR_MS : 0;
}

export const capacityRollupFunction = inngest.createFunction(
  { id: "capacity-rollup", retries: 2 },
  { cron: "0 2 * * *" },
  async ({ step }) => {
    const serviceRole = getCarbonServiceRole();

    const companies = await step.run("get-companies", async () => {
      const result = await serviceRole.from("companyPlan").select("id");
      if (result.error) {
        console.error(`Failed to get companies: ${String(result.error)}`);
        return [];
      }
      return result.data.map((c) => c.id);
    });

    for (const companyId of companies) {
      await step.run(`rollup-${companyId}`, async () => {
        const now = new Date();
        const firstWeekStart = isoWeekStart(now);
        const horizonEnd = new Date(
          firstWeekStart.getTime() + WEEKS_TO_ROLL_UP * 7 * DAY_MS
        );
        const trailing90 = new Date(now.getTime() - 90 * DAY_MS);

        // Batched reads (one per table per company)
        const [
          workCenters,
          calendars,
          shifts,
          exceptions,
          reservations,
          events,
          queueTimes
        ] = await Promise.all([
          serviceRole
            .from("workCenter")
            .select(
              "id, parallelCapacity, resourceCalendarId, locationId, active"
            )
            .eq("companyId", companyId)
            .eq("active", true),
          serviceRole
            .from("resourceCalendar")
            .select("id, locationId, active")
            .eq("companyId", companyId)
            .eq("active", true),
          serviceRole
            .from("resourceCalendarShift")
            .select("resourceCalendarId, dayOfWeek, startTime, endTime")
            .eq("companyId", companyId),
          serviceRole
            .from("resourceCalendarException")
            .select("resourceCalendarId, startAt, endAt, type")
            .eq("companyId", companyId)
            .gte("endAt", firstWeekStart.toISOString()),
          serviceRole
            .from("capacityReservation")
            .select("resourceId, startAt, endAt")
            .eq("companyId", companyId)
            .eq("resourceKind", "WorkCenter")
            .is("scenarioId", null)
            .gte("endAt", firstWeekStart.toISOString())
            .lte("startAt", horizonEnd.toISOString()),
          serviceRole
            .from("productionEvent")
            .select("workCenterId, duration")
            .eq("companyId", companyId)
            .not("endTime", "is", null)
            .not("workCenterId", "is", null)
            .gte("startTime", trailing90.toISOString()),
          serviceRole
            .from("jobOperationQueueTime")
            .select("workCenterId, queueHours, readyAt")
            .eq("companyId", companyId)
            .not("queueHours", "is", null)
            .gte("readyAt", trailing90.toISOString())
        ]);

        const firstError = [
          workCenters,
          calendars,
          shifts,
          exceptions,
          reservations,
          events,
          queueTimes
        ].find((r) => r.error);
        if (firstError?.error) {
          console.error(
            `capacity-rollup reads failed for ${companyId}: ${String(
              firstError.error.message ?? firstError.error
            )}`
          );
          return;
        }

        const calendarsByLocation = new Map<string, string[]>();
        for (const c of calendars.data ?? []) {
          if (!c.locationId) continue;
          const list = calendarsByLocation.get(c.locationId) ?? [];
          list.push(c.id);
          calendarsByLocation.set(c.locationId, list);
        }
        const shiftsByCalendar = new Map<string, ShiftRow[]>();
        for (const s of (shifts.data ?? []) as ShiftRow[]) {
          const list = shiftsByCalendar.get(s.resourceCalendarId) ?? [];
          list.push(s);
          shiftsByCalendar.set(s.resourceCalendarId, list);
        }
        const exceptionsByCalendar = new Map<string, ExceptionRow[]>();
        for (const e of (exceptions.data ?? []) as ExceptionRow[]) {
          const list = exceptionsByCalendar.get(e.resourceCalendarId) ?? [];
          list.push(e);
          exceptionsByCalendar.set(e.resourceCalendarId, list);
        }

        // Trailing-90d actuals per work center
        const actualsByWorkCenter = new Map<string, number[]>();
        for (const e of events.data ?? []) {
          if (!e.workCenterId || !e.duration) continue;
          const list = actualsByWorkCenter.get(e.workCenterId) ?? [];
          list.push(e.duration / 3600); // seconds -> hours
          actualsByWorkCenter.set(e.workCenterId, list);
        }
        const queueByWorkCenter = new Map<string, number[]>();
        for (const q of queueTimes.data ?? []) {
          if (!q.workCenterId || q.queueHours === null) continue;
          const list = queueByWorkCenter.get(q.workCenterId) ?? [];
          list.push(Number(q.queueHours));
          queueByWorkCenter.set(q.workCenterId, list);
        }

        const upserts: Database["public"]["Tables"]["workCenterUtilization"]["Insert"][] =
          [];

        for (const wc of workCenters.data ?? []) {
          const calendarIds = wc.resourceCalendarId
            ? [wc.resourceCalendarId]
            : wc.locationId
              ? (calendarsByLocation.get(wc.locationId) ?? [])
              : [];
          const wcShifts = calendarIds.flatMap(
            (id) => shiftsByCalendar.get(id) ?? []
          );
          const wcExceptions = calendarIds.flatMap(
            (id) => exceptionsByCalendar.get(id) ?? []
          );
          const wcReservations = (reservations.data ?? []).filter(
            (r) => r.resourceId === wc.id
          );

          const durations = actualsByWorkCenter.get(wc.id) ?? [];
          const actualHours = durations.reduce((a, b) => a + b, 0);
          const mean =
            durations.length > 0 ? actualHours / durations.length : null;
          let cv: number | null = null;
          if (mean !== null && mean > 0 && durations.length > 1) {
            const variance =
              durations.reduce((sum, d) => sum + (d - mean) ** 2, 0) /
              (durations.length - 1);
            cv = Math.sqrt(variance) / mean;
          }
          const queues = queueByWorkCenter.get(wc.id) ?? [];
          const avgQueueHours =
            queues.length > 0
              ? queues.reduce((a, b) => a + b, 0) / queues.length
              : null;

          for (let w = 0; w < WEEKS_TO_ROLL_UP; w++) {
            const weekStart = new Date(
              firstWeekStart.getTime() + w * 7 * DAY_MS
            );
            const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);

            const availableHours =
              weeklyAvailableHours(wcShifts, wcExceptions, weekStart, weekEnd) *
              (wc.parallelCapacity ?? 1);

            const reservedHours = wcReservations.reduce(
              (sum, r) =>
                sum + overlapHours(r.startAt, r.endAt, weekStart, weekEnd),
              0
            );

            upserts.push({
              companyId,
              workCenterId: wc.id,
              periodStart: weekStart.toISOString().slice(0, 10),
              periodEnd: new Date(weekEnd.getTime() - DAY_MS)
                .toISOString()
                .slice(0, 10),
              availableHours,
              reservedHours,
              actualHours,
              utilization:
                availableHours > 0 ? reservedHours / availableHours : 0,
              meanServiceHours: mean,
              cvServiceTime: cv,
              avgQueueHours,
              createdBy: "system",
              updatedBy: "system",
              updatedAt: new Date().toISOString()
            });
          }
        }

        if (upserts.length > 0) {
          const result = await serviceRole
            .from("workCenterUtilization")
            .upsert(upserts, {
              onConflict: "workCenterId,periodStart,companyId"
            });
          if (result.error) {
            console.error(
              `capacity-rollup upsert failed for ${companyId}: ${result.error.message}`
            );
          }
        }

        console.log(
          `capacity-rollup: ${companyId} wrote ${upserts.length} rows`
        );
      });
    }
  }
);
