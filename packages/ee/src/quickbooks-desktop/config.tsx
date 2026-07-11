import { z } from "zod";
import { defineIntegration } from "../fns";
import { Logo } from "../quickbooks/config";

/**
 * QuickBooks Desktop (Enterprise) — settings-based connection, NO oauth
 * block: the QuickBooks Web Connector polls Carbon's SOAP endpoint using
 * credentials generated on the integration's Connection tab, so there is
 * no OAuth handshake. `settings: []` + an empty schema means installing is
 * a plain empty POST (IntegrationCard's non-OAuth fallback) and the drawer
 * shows only the accounting tabs (Connection, Account Mapping, Posting,
 * Sync Activity).
 *
 * Provider code lives at accounting/providers/quickbooks-desktop/
 * (ProviderID.QUICKBOOKS_DESKTOP = "quickbooks-desktop").
 */
export const QuickBooksDesktop = defineIntegration({
  name: "QuickBooks Desktop",
  id: "quickbooks-desktop",
  active: true,
  category: "Accounting",
  logo: Logo,
  description:
    "Integrating Carbon with QuickBooks Desktop Enterprise keeps your company file in sync without a cloud account: customers, vendors, items, invoices, bills and purchase orders are pushed into QuickBooks, and Carbon's inventory and production postings arrive as journal entries — all delivered through the QuickBooks Web Connector polling securely from your desktop.",
  shortDescription:
    "Push documents and journal entries to QuickBooks Desktop via the Web Connector.",
  images: [],
  settings: [],
  schema: z.object({})
});
