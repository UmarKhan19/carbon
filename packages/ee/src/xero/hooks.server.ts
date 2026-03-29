import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { CreateSubscriptionParams } from "@carbon/database/event";
import {
  createEventSystemSubscription,
  deleteEventSystemSubscriptionsByName
} from "@carbon/database/event";
import {
  getProviderIntegration,
  ProviderID,
  type ProviderIntegrationMetadata
} from "@carbon/ee/accounting";

export async function xeroHealthcheck(
  companyId: string,
  metadata: Record<string, unknown>
) {
  const provider = getProviderIntegration(
    getCarbonServiceRole(),
    companyId,
    ProviderID.XERO,
    metadata as ProviderIntegrationMetadata
  );

  return await provider.validate();
}

export async function xeroOnInstall(companyId: string) {
  const client = getCarbonServiceRole();

  const tables: CreateSubscriptionParams["table"][] = [
    "address",
    "customer",
    "supplier",
    "item",
    "salesInvoice",
    "purchaseInvoice",
    "purchaseOrder",
    "salesOrder"
  ];

  for (const table of tables) {
    await createEventSystemSubscription(client, {
      table,
      companyId,
      name: "xero-sync",
      operations: ["INSERT", "UPDATE", "DELETE"],
      type: "SYNC",
      config: {
        provider: ProviderID.XERO
      }
    });
  }
}

export async function xeroOnUninstall(companyId: string) {
  const client = getCarbonServiceRole();
  await deleteEventSystemSubscriptionsByName(client, companyId, "xero-sync");
}
