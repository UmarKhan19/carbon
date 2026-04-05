import { resolveLanguage, type SupportedLanguage } from "@carbon/locale";
import type { Messages } from "@lingui/core";

const catalogLoaders = import.meta.glob("../locales/*/*.mjs", {
  import: "messages"
}) as Record<string, () => Promise<Messages>>;

type LinguiNamespace =
  | "account"
  | "accounting"
  | "documents"
  | "inventory"
  | "invoicing"
  | "items"
  | "people"
  | "production"
  | "purchasing"
  | "quality"
  | "resources"
  | "sales"
  | "settings"
  | "shared"
  | "users";

const routeNamespaceMap: Array<{
  namespace: LinguiNamespace;
  prefix: string;
}> = [
  { namespace: "invoicing", prefix: "/x/sales-invoice" },
  { namespace: "sales", prefix: "/x/sales-order" },
  { namespace: "sales", prefix: "/x/sales-rfq" },
  { namespace: "sales", prefix: "/x/sales" },
  { namespace: "sales", prefix: "/x/customer" },
  { namespace: "sales", prefix: "/x/quote" },
  { namespace: "purchasing", prefix: "/x/purchase-order" },
  { namespace: "purchasing", prefix: "/x/purchasing-rfq" },
  { namespace: "purchasing", prefix: "/x/supplier-quote" },
  { namespace: "purchasing", prefix: "/x/supplier" },
  { namespace: "purchasing", prefix: "/x/receipt" },
  { namespace: "inventory", prefix: "/x/inventory" },
  { namespace: "inventory", prefix: "/x/shipment" },
  { namespace: "inventory", prefix: "/x/stock-transfer" },
  { namespace: "inventory", prefix: "/x/warehouse-transfer" },
  { namespace: "resources", prefix: "/x/resources" },
  { namespace: "resources", prefix: "/x/training" },
  { namespace: "production", prefix: "/x/production" },
  { namespace: "production", prefix: "/x/schedule" },
  { namespace: "production", prefix: "/x/scheduling" },
  { namespace: "quality", prefix: "/x/quality" },
  { namespace: "quality", prefix: "/x/issue" },
  { namespace: "items", prefix: "/x/consumable" },
  { namespace: "items", prefix: "/x/material" },
  { namespace: "items", prefix: "/x/part" },
  { namespace: "items", prefix: "/x/tool" },
  { namespace: "accounting", prefix: "/x/accounting" },
  { namespace: "account", prefix: "/x/account" },
  { namespace: "documents", prefix: "/x/documents" },
  { namespace: "people", prefix: "/x/people" },
  { namespace: "settings", prefix: "/x/settings" },
  { namespace: "users", prefix: "/x/users" }
];

function resolveNamespaces(pathname: string): LinguiNamespace[] {
  const namespaces = new Set<LinguiNamespace>(["shared"]);

  for (const mapping of routeNamespaceMap) {
    if (pathname.startsWith(mapping.prefix)) {
      namespaces.add(mapping.namespace);
    }
  }

  return [...namespaces];
}

async function loadCatalog(
  language: SupportedLanguage,
  namespace: LinguiNamespace
) {
  const catalogPath = `../locales/${language}/${namespace}.mjs`;
  const load = catalogLoaders[catalogPath];
  if (!load) {
    return {};
  }

  return load();
}

export async function loadLinguiCatalogForRequest(
  request: Request,
  locale: string | null | undefined
) {
  const language = resolveLanguage(locale);
  const pathname = new URL(request.url).pathname;
  const namespaces = resolveNamespaces(pathname);
  const catalogs = await Promise.all(
    namespaces.map((namespace) => loadCatalog(language, namespace))
  );

  return Object.assign({}, ...catalogs);
}
