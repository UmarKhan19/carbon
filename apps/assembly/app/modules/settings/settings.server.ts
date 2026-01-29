import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getCompanies(
  client: SupabaseClient<Database>,
  userId: string
) {
  return client
    .from("userToCompany")
    .select(
      `
      id,
      userId,
      companyId,
      company(id, name, logo)
    `
    )
    .eq("userId", userId);
}
