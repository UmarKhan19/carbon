import { ProviderID } from "../../core/models";
import type {
  AccountingEntityType,
  AuthProvider,
  GlobalSyncConfig,
  ProviderCapabilities,
  ProviderConfig,
  ProviderCredentials
} from "../../core/types";
import { BaseProvider } from "../../core/types";

/**
 * QbdProvider — QuickBooks Desktop (Enterprise) via the self-hosted
 * QuickBooks Web Connector endpoint.
 *
 * There are NO HTTP methods here: the transport is the Web Connector POLL
 * (`capabilities.transport = "polled"`). QuickBooks' QBWC agent calls
 * Carbon's SOAP endpoint on a schedule, authenticates with the
 * `webConnector` credentials stored on `companyIntegration.metadata`, and
 * drains queued sync operations through each syncer's two polled halves
 * (`buildRequest` / `processResponse` — see entities/shared.ts for the
 * contract). The provider object carries credentials + the resolved sync
 * config, plus small helpers the syncers and the QBWC handler need.
 *
 * The jobs drain (`drainSyncOperations`) skips polled providers entirely —
 * operations must accumulate as Pending for the poll.
 */

/** The Web Connector credentials variant, narrowed from the stored union. */
export type QbdWebConnectorCredentials = Extract<
  ProviderCredentials,
  { type: "webConnector" }
>;

/**
 * Entities QuickBooks Desktop syncs in v1 — every one of them PUSH-ONLY
 * (Carbon → QuickBooks). Pulling from a desktop file adds iterator-driven
 * reads the QBWC loop does not implement yet.
 */
export const QBD_PUSH_ONLY_ENTITIES = [
  "customer",
  "vendor",
  "item",
  "invoice",
  "bill",
  "purchaseOrder",
  "journalEntry"
] as const satisfies readonly AccountingEntityType[];

/** Entities QuickBooks Desktop does not sync in v1 (force-disabled). */
export const QBD_DISABLED_ENTITIES = [
  "salesOrder",
  "inventoryAdjustment",
  "payment",
  "employee"
] as const satisfies readonly AccountingEntityType[];

/**
 * Constrain a resolved sync config to what QuickBooks Desktop supports:
 * every supported entity is forced to direction "push-to-accounting" with
 * owner "carbon" (push-only is a transport capability limit, not a
 * preference — stored two-way/pull overrides are ignored), and the
 * unsupported entities are force-disabled. The per-company `enabled` flag
 * survives for supported entities, so journalEntry posting sync stays
 * opt-in and a company can still turn an entity off.
 */
export function buildQbdSyncConfig(
  resolved: GlobalSyncConfig
): GlobalSyncConfig {
  const entities = Object.fromEntries(
    Object.entries(resolved.entities).map(([entityType, entityConfig]) => [
      entityType,
      { ...entityConfig }
    ])
  ) as GlobalSyncConfig["entities"];

  for (const entityType of QBD_PUSH_ONLY_ENTITIES) {
    entities[entityType] = {
      ...entities[entityType],
      direction: "push-to-accounting",
      owner: "carbon"
    };
  }

  for (const entityType of QBD_DISABLED_ENTITIES) {
    entities[entityType] = { ...entities[entityType], enabled: false };
  }

  return { entities };
}

type QbdProviderConfig = ProviderConfig<{
  /**
   * Credentials parsed from `companyIntegration.metadata.credentials`
   * (parseStoredCredentials). Expected to be the `webConnector` variant;
   * absent until the connection card issues them (D5/D11).
   */
  credentials?: ProviderCredentials;
}> & { id: ProviderID.QUICKBOOKS_DESKTOP };

const NO_OAUTH_MESSAGE =
  "QuickBooks Desktop connects via Web Connector credentials generated on the integration settings page — there is no OAuth flow";

export class QbdProvider extends BaseProvider {
  static id = ProviderID.QUICKBOOKS_DESKTOP;

  readonly capabilities: ProviderCapabilities = {
    transport: "polled",
    supportsWebhooks: false,
    supportsJournalPush: true
  };

  private readonly syncConfig: GlobalSyncConfig;

  constructor(public config: Omit<QbdProviderConfig, "id">) {
    super();
    this.creds = config.credentials;
    this.syncConfig = buildQbdSyncConfig(config.syncConfig);

    // No OAuth client: the QBWC handshake (authenticate over SOAP with the
    // scrypt-hashed password) is the real auth path. getCredentials still
    // works so generic code can read the stored credentials.
    const auth: AuthProvider = {
      getCredentials: () => {
        if (!this.creds) {
          throw new Error(
            "QuickBooks Desktop integration has no stored credentials — generate Web Connector credentials on the integration settings page"
          );
        }
        return this.creds;
      },
      getAuthUrl: () => {
        throw new Error(NO_OAUTH_MESSAGE);
      },
      exchangeCode: () => {
        throw new Error(NO_OAUTH_MESSAGE);
      },
      refresh: () => {
        throw new Error(NO_OAUTH_MESSAGE);
      }
    };
    this.auth = auth;
  }

  get id(): ProviderID.QUICKBOOKS_DESKTOP {
    return ProviderID.QUICKBOOKS_DESKTOP;
  }

  getSyncConfig(entity: AccountingEntityType) {
    return this.syncConfig.entities[entity];
  }

  /** Stored webConnector credentials, or null when absent/wrong variant. */
  getWebConnectorCredentials(): QbdWebConnectorCredentials | null {
    return this.creds?.type === "webConnector" ? this.creds : null;
  }

  /**
   * qbXML version captured from the QBWC session handshake (stored on the
   * credentials by the session lifecycle), or null before the first poll.
   * The QBWC handler passes the live handshake version to buildMessageSet;
   * this accessor is for health/display surfaces.
   */
  get qbxmlVersion(): string | null {
    return this.getWebConnectorCredentials()?.qbxmlVersion ?? null;
  }

  /**
   * Credentials-only validation: the stored credentials parse as the
   * webConnector variant with the fields the QBWC authenticate handshake
   * needs. DEVIATION from the spec's "session seen within 7 days": there is
   * no synchronous ping to a polled desktop, so poll staleness is surfaced
   * by the D11 connection-card health check (qbwcSession.lastSeenAt), not
   * by validate().
   */
  async validate(): Promise<boolean> {
    const creds = this.getWebConnectorCredentials();
    return (
      creds !== null &&
      creds.username.length > 0 &&
      creds.passwordHash.length > 0 &&
      creds.ownerId.length > 0
    );
  }

  async authenticate(): Promise<ProviderCredentials> {
    throw new Error(NO_OAUTH_MESSAGE);
  }
}
