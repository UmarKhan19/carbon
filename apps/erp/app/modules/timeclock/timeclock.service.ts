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
