import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import z from "zod";
import type { AccountingProvider } from "../providers";
import { QbdProvider } from "../providers/quickbooks-desktop";
import { QboProvider } from "../providers/quickbooks-online";
import { XeroProvider } from "../providers/xero";
import type { ProviderID } from "./models";
import {
  DEFAULT_SYNC_CONFIG,
  ProviderIntegrationMetadataSchema,
  parseStoredCredentials,
  SyncDirectionSchema
} from "./models";
import type {
  AccountingEntityType,
  GlobalSyncConfig,
  ProviderCredentials,
  ProviderIntegrationMetadata
} from "./types";

/**
 * Stored per-entity sync-config fragment. Deliberately has no defaults —
 * only the keys a company actually stored may override the defaults.
 */
const storedEntityConfigSchema = z.object({
  enabled: z.boolean().optional(),
  direction: SyncDirectionSchema.optional(),
  owner: z.enum(["carbon", "accounting"]).optional(),
  syncFromDate: z.string().datetime().optional()
});

/**
 * Resolve the effective sync config for a company by deep-merging the
 * per-entity fragments stored on `companyIntegration.metadata.syncConfig`
 * over `DEFAULT_SYNC_CONFIG`. Only `enabled`, `direction`, `owner` and
 * `syncFromDate` can be overridden; invalid fragments are ignored with a
 * warning — a bad stored config must never break sync.
 */
export function resolveSyncConfig(metadata: unknown): GlobalSyncConfig {
  const resolved: GlobalSyncConfig = {
    entities: Object.fromEntries(
      Object.entries(DEFAULT_SYNC_CONFIG.entities).map(
        ([entityType, entityConfig]) => [entityType, { ...entityConfig }]
      )
    ) as GlobalSyncConfig["entities"]
  };

  const storedEntities =
    metadata && typeof metadata === "object"
      ? (metadata as { syncConfig?: { entities?: unknown } }).syncConfig
          ?.entities
      : undefined;

  if (!storedEntities || typeof storedEntities !== "object") {
    return resolved;
  }

  for (const entityType of Object.keys(
    resolved.entities
  ) as AccountingEntityType[]) {
    const fragment = (storedEntities as Record<string, unknown>)[entityType];
    if (fragment === undefined) continue;

    const parsed = storedEntityConfigSchema.safeParse(fragment);
    if (!parsed.success) {
      console.warn(
        `Ignoring invalid stored sync config for entity "${entityType}":`,
        parsed.error.issues
      );
      continue;
    }

    resolved.entities[entityType] = {
      ...resolved.entities[entityType],
      ...parsed.data
    };
  }

  return resolved;
}

export const getAccountingIntegration = async <T extends ProviderID>(
  client: SupabaseClient<Database>,
  companyOrTenantId: string,
  provider: T
) => {
  const integration = await client
    .from("companyIntegration")
    .select("*")
    .eq("id", provider)
    .or(
      // Credentials written before the providerMetadata shape kept tenantId
      // at the top level — match both paths so legacy rows stay resolvable
      `companyId.eq.${companyOrTenantId},metadata->credentials->>tenantId.eq.${companyOrTenantId},metadata->credentials->providerMetadata->>tenantId.eq.${companyOrTenantId}`
    )
    .single();

  console.log(
    "Fetched integration for",
    provider,
    "and ID",
    companyOrTenantId,
    integration
  );

  if (integration.error || !integration.data) {
    throw new Error(
      `No ${provider} integration found for company or tenant ${companyOrTenantId}`
    );
  }

  const config = ProviderIntegrationMetadataSchema.safeParse(
    integration.data.metadata
  );

  if (!config.success) {
    console.dir(config.error, { depth: null });
    throw new Error("Invalid provider config");
  }

  return {
    ...integration.data,
    id: provider as T,
    metadata: config.data
  } as const;
};

export function getProviderIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID.XERO,
  config?: ProviderIntegrationMetadata
): XeroProvider;
export function getProviderIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID.QUICKBOOKS,
  config?: ProviderIntegrationMetadata
): QboProvider;
export function getProviderIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID.QUICKBOOKS_DESKTOP,
  config?: ProviderIntegrationMetadata
): QbdProvider;
export function getProviderIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID,
  config?: ProviderIntegrationMetadata
): AccountingProvider;
export function getProviderIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID,
  config?: ProviderIntegrationMetadata
): AccountingProvider {
  // Reads go through the stored-credentials shim so legacy flat oauth2 rows
  // (top-level tenantId/tenantName) resolve the same as the new shape
  let credentials: ProviderCredentials | undefined;
  if (config?.credentials) {
    try {
      credentials = parseStoredCredentials(config.credentials);
    } catch (error) {
      console.error(`Invalid stored ${provider} credentials:`, error);
    }
  }

  const oauthCredentials =
    credentials?.type === "oauth2" ? credentials : undefined;
  const { accessToken, refreshToken } = oauthCredentials ?? {};
  const tenantId =
    typeof oauthCredentials?.providerMetadata?.tenantId === "string"
      ? oauthCredentials.providerMetadata.tenantId
      : undefined;
  const realmId =
    typeof oauthCredentials?.providerMetadata?.realmId === "string"
      ? oauthCredentials.providerMetadata.realmId
      : undefined;

  const syncConfig = resolveSyncConfig(config);

  // Create a callback function to update the integration metadata when tokens are refreshed
  const onTokenRefresh = async (auth: ProviderCredentials) => {
    try {
      if (auth.type !== "oauth2") {
        console.error(
          `Unexpected ${auth.type} credentials in ${provider} token refresh`
        );
        return;
      }

      console.log("Refreshing tokens for", provider, "integration");
      // Writes always use the new shape: provider-specific fields live under
      // providerMetadata (carried over from the stored credentials)
      const update: ProviderCredentials = {
        ...auth,
        expiresAt:
          auth.expiresAt || new Date(Date.now() + 3600000).toISOString(), // Default to 1 hour if not provided
        providerMetadata: {
          ...oauthCredentials?.providerMetadata,
          ...auth.providerMetadata
        }
      };

      await client
        .from("companyIntegration")
        .update({ metadata: { ...config, credentials: update } as any })
        .eq("companyId", companyId)
        .eq("id", provider);
    } catch (error) {
      console.error(
        `Failed to update ${provider} integration metadata:`,
        error
      );
    }
  };

  switch (provider) {
    case "quickbooks-desktop": {
      // No OAuth client: the Web Connector credentials variant is the
      // whole connection (the QBWC SOAP handshake performs the real auth)
      return new QbdProvider({
        companyId,
        credentials,
        syncConfig
      });
    }
    case "quickbooks": {
      // Hosts default to production; sandbox is an explicit opt-in
      const environment =
        process.env.QUICKBOOKS_ENVIRONMENT === "sandbox"
          ? "sandbox"
          : "production";
      return new QboProvider({
        companyId,
        realmId,
        environment,
        accessToken,
        refreshToken,
        clientId: process.env.QUICKBOOKS_CLIENT_ID!,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
        redirectUri: process.env.QUICKBOOKS_REDIRECT_URI,
        syncConfig,
        onTokenRefresh
      });
    }
    case "xero": {
      const settings = {
        defaultSalesAccountCode: config?.defaultSalesAccountCode,
        defaultPurchaseAccountCode: config?.defaultPurchaseAccountCode
      };
      console.log(
        "[getProviderIntegration] Creating XeroProvider with settings:",
        settings
      );
      console.log("[getProviderIntegration] Full config received:", config);
      return new XeroProvider({
        companyId,
        tenantId,
        accessToken,
        refreshToken,
        clientId: process.env.XERO_CLIENT_ID!,
        clientSecret: process.env.XERO_CLIENT_SECRET!,
        redirectUri: process.env.XERO_REDIRECT_URI,
        syncConfig,
        onTokenRefresh,
        settings
      });
    }
    // Add other providers as needed
    // case "sage":
    //   return new SageProvider(config);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
