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
