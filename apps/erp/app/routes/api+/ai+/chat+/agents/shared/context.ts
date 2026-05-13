import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ChatContext {
  client: SupabaseClient<Database>;
  userId: string;
  companyId: string;
  companyGroupId: string;
  fullName: string;
  companyName: string;
  baseCurrency: string;
  locale: string;
  currentDateTime: string;
  country?: string;
  city?: string;
  timezone: string;
  chatId: string;
  // Allow additional properties to satisfy Record<string, unknown> constraint
  [key: string]: unknown;
}

export function createChatContext(params: {
  userId: string;
  companyId: string;
  companyGroupId: string;
  client: SupabaseClient<Database>;
  fullName: string;
  companyName: string;
  country?: string;
  city?: string;
  chatId: string;
  baseCurrency?: string;
  locale?: string;
  timezone?: string;
}) {
  return {
    baseCurrency: params.baseCurrency || "USD",
    chatId: params.chatId,
    city: params.city,
    client: params.client,
    companyGroupId: params.companyGroupId,
    companyId: params.companyId,
    companyName: params.companyName,
    country: params.country,
    currentDateTime: new Date().toISOString(),
    fullName: params.fullName,
    locale: params.locale || "en-US",
    timezone:
      params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    userId: params.userId
  };
}
