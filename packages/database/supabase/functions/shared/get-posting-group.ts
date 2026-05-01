import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../lib/types.ts";

export async function getDefaultPostingGroup(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return await client
    .from("accountDefault")
    .select("*")
    .eq("companyId", companyId)
    .single();
}
