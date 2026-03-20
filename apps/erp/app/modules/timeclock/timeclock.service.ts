import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitize } from "~/utils/supabase";

export async function getOpenClockEntry(
  client: SupabaseClient<Database>,
  employeeId: string,
  companyId: string
) {
  return client
    .from("timeClockEntry")
    .select("*")
    .eq("employeeId", employeeId)
    .eq("companyId", companyId)
    .is("clockOut", null)
    .maybeSingle();
}

export async function clockIn(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
    createdBy: string;
  }
) {
  // Check for existing open entry
  const existing = await getOpenClockEntry(
    client,
    args.employeeId,
    args.companyId
  );
  if (existing.data) {
    return { data: null, error: { message: "Already clocked in" } };
  }

  return client.from("timeClockEntry").insert({
    employeeId: args.employeeId,
    companyId: args.companyId,
    createdBy: args.createdBy
  });
}

export async function clockOut(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
    updatedBy: string;
    clockOut?: string;
    note?: string;
    type?: "shift_end" | "break";
  }
) {
  const open = await getOpenClockEntry(client, args.employeeId, args.companyId);
  if (!open.data) {
    return { data: null, error: { message: "Not currently clocked in" } };
  }

  return client
    .from("timeClockEntry")
    .update(
      sanitize({
        clockOut: args.clockOut ?? new Date().toISOString(),
        note: args.note,
        type: args.type ?? "shift_end",
        updatedBy: args.updatedBy,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", open.data.id);
}

export async function getTimeClockEntries(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
    from?: string;
    to?: string;
  }
) {
  let query = client
    .from("timeClockEntry")
    .select("*")
    .eq("employeeId", args.employeeId)
    .eq("companyId", args.companyId)
    .order("clockIn", { ascending: false });

  if (args.from) {
    query = query.gte("clockIn", args.from);
  }
  if (args.to) {
    query = query.lte("clockIn", args.to);
  }

  return query;
}

export async function getTimeClockDashboard(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("timeClockDashboard")
    .select("*")
    .eq("companyId", companyId)
    .order("clockIn", { ascending: false });
}

export async function getClockedInEmployees(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("timeClockDashboard")
    .select("*")
    .eq("companyId", companyId)
    .is("clockOut", null)
    .order("clockIn", { ascending: true });
}

export async function updateTimeClockEntry(
  client: SupabaseClient<Database>,
  args: {
    entryId: string;
    clockIn?: string;
    clockOut?: string | null;
    note?: string | null;
    updatedBy: string;
  }
) {
  return client
    .from("timeClockEntry")
    .update(
      sanitize({
        clockIn: args.clockIn,
        clockOut: args.clockOut,
        note: args.note,
        updatedBy: args.updatedBy,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", args.entryId);
}

export async function deleteTimeClockEntry(
  client: SupabaseClient<Database>,
  entryId: string
) {
  return client.from("timeClockEntry").delete().eq("id", entryId);
}

export async function isOnBreak(
  client: SupabaseClient<Database>,
  employeeId: string,
  companyId: string
): Promise<{ onBreak: boolean; breakClockOut?: string }> {
  const open = await getOpenClockEntry(client, employeeId, companyId);
  if (open.data) return { onBreak: false };

  const { data: lastEntry } = await client
    .from("timeClockEntry")
    .select("type, clockOut")
    .eq("employeeId", employeeId)
    .eq("companyId", companyId)
    .not("clockOut", "is", null)
    .order("clockOut", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastEntry?.type === "break" && lastEntry.clockOut) {
    return { onBreak: true, breakClockOut: lastEntry.clockOut };
  }
  return { onBreak: false };
}

export async function getOnBreakEmployees(
  client: SupabaseClient<Database>,
  companyId: string
) {
  // Get all employees whose most recent entry is a break (no open entry)
  // We fetch recent break entries and cross-reference with who's NOT clocked in
  const { data: recentBreaks } = await client
    .from("timeClockDashboard")
    .select("*")
    .eq("companyId", companyId)
    .eq("type", "break")
    .not("clockOut", "is", null)
    .order("clockOut", { ascending: false });

  if (!recentBreaks) return [];

  // Get currently clocked in employee IDs
  const { data: clockedIn } = await client
    .from("timeClockEntry")
    .select("employeeId")
    .eq("companyId", companyId)
    .is("clockOut", null);

  const clockedInIds = new Set((clockedIn ?? []).map((e) => e.employeeId));

  // Filter to employees who are on break (not clocked back in)
  const seen = new Set<string>();
  return recentBreaks.filter((entry) => {
    if (!entry.employeeId || clockedInIds.has(entry.employeeId)) return false;
    if (seen.has(entry.employeeId)) return false;
    seen.add(entry.employeeId);
    return true;
  });
}

export async function getWeeklyHoursForEmployees(
  client: SupabaseClient<Database>,
  companyId: string,
  employeeIds: string[]
): Promise<Record<string, number>> {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const { data: entries } = await client
    .from("timeClockEntry")
    .select("employeeId, clockIn, clockOut")
    .eq("companyId", companyId)
    .in("employeeId", employeeIds)
    .gte("clockIn", monday.toISOString());

  const weeklyMs: Record<string, number> = {};
  for (const entry of entries ?? []) {
    const end = entry.clockOut
      ? new Date(entry.clockOut).getTime()
      : Date.now();
    const ms = end - new Date(entry.clockIn).getTime();
    weeklyMs[entry.employeeId] = (weeklyMs[entry.employeeId] ?? 0) + ms;
  }

  return weeklyMs;
}

export async function getScheduledEmployeesToday(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const { data } = await client
    .from("employeeJob")
    .select(
      "id, shiftId, shift:shift(id, name, startTime, endTime, sunday, monday, tuesday, wednesday, thursday, friday, saturday)"
    )
    .eq("companyId", companyId)
    .not("shiftId", "is", null);

  if (!data) return [];

  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"
  ] as const;
  const today = dayNames[new Date().getDay()];

  return data.filter((ej) => {
    const shift = ej.shift as Record<string, unknown> | null;
    return shift && shift[today] === true;
  });
}
