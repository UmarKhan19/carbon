import { emailHealthcheck } from "./email/hooks.server";
import { jiraHealthcheck } from "./jira/hooks.server";
import { linearHealthcheck } from "./linear/hooks.server";
import type { IntegrationServerHooks } from "./types";
import {
  xeroHealthcheck,
  xeroOnInstall,
  xeroOnUninstall
} from "./xero/hooks.server";

/**
 * Server-side hooks registry for integrations.
 *
 * Hooks that depend on server-only modules (like getCarbonServiceRole)
 * cannot live in the integration config files because those are bundled
 * for both client and server. This registry maps integration IDs to
 * their server-only lifecycle hooks.
 */
const serverHooks: Record<string, IntegrationServerHooks> = {
  email: {
    onHealthcheck: emailHealthcheck
  },
  jira: {
    onHealthcheck: jiraHealthcheck
  },
  linear: {
    onHealthcheck: linearHealthcheck
  },
  xero: {
    onHealthcheck: xeroHealthcheck,
    onInstall: xeroOnInstall,
    onUninstall: xeroOnUninstall
  }
};

export function getIntegrationServerHooks(
  integrationId: string
): IntegrationServerHooks | undefined {
  return serverHooks[integrationId];
}
