import { CarbonEdition, error, STRIPE_BYPASS_COMPANY_IDS } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { Edition, Plan } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "react-router";

export const BUSINESS_PLAN_REQUIRED_MESSAGE =
  "API keys, webhooks, and integrations are available on the Business plan. Upgrade your plan to enable this feature." as const;

function isBypassCompany(companyId: string): boolean {
  if (!STRIPE_BYPASS_COMPANY_IDS) return false;
  return STRIPE_BYPASS_COMPANY_IDS.split(",")
    .map((id) => id.trim())
    .includes(companyId);
}

/**
 * Guard for action handlers on Business-tier-only routes (API keys, webhooks,
 * integrations). If the company is on Starter, throws a redirect with a flash
 * error so the user is sent back with the upgrade message. Self-hosted
 * Community/Enterprise installs and bypass-listed companies are never gated.
 */
export async function requireBusinessPlan({
  request,
  client,
  companyId,
  redirectTo
}: {
  request: Request;
  client: SupabaseClient<Database>;
  companyId: string;
  redirectTo: string;
}): Promise<void> {
  if (CarbonEdition !== Edition.Cloud) return;
  if (isBypassCompany(companyId)) return;

  const { data } = await client
    .from("companyPlan")
    .select("planId")
    .eq("id", companyId)
    .single();

  if (data?.planId === Plan.Starter) {
    throw redirect(
      redirectTo,
      await flash(request, error(null, BUSINESS_PLAN_REQUIRED_MESSAGE))
    );
  }
}
