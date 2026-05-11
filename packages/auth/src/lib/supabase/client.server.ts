import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_SERVICE_ROLE_KEY } from "../../config/env";
import { getCarbonClient } from "./client";

// Cached on globalThis so HMR in development doesn't accumulate clients across
// module reloads. In production this is a plain module-level singleton.
declare global {
  var __carbonServiceRole: SupabaseClient<Database> | undefined;
}

export const getCarbonServiceRole = (): SupabaseClient<Database> => {
  if (!globalThis.__carbonServiceRole) {
    globalThis.__carbonServiceRole = getCarbonClient(
      SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return globalThis.__carbonServiceRole;
};
