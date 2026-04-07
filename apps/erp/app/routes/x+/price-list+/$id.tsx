import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  Await,
  Outlet,
  redirect,
  useLoaderData,
  useParams
} from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getCustomersByDefaultPriceList,
  getPriceList,
  getPriceListAssignments,
  getPriceListItems,
  getPriceListRules,
  getPriceListVersions,
  getPurchaseOrdersByPriceList,
  getSalesOrdersByPriceList,
  getSuppliersByDefaultPriceList
} from "~/modules/pricing";
import { PriceListDescription } from "~/modules/pricing/ui/PriceListDescription";
import {
  PriceListExplorer,
  PriceListExplorerSkeleton
} from "~/modules/pricing/ui/PriceListExplorer";
import PriceListHeader from "~/modules/pricing/ui/PriceListHeader";
import { PriceListItemsTable } from "~/modules/pricing/ui/PriceListItems";
import PriceListProperties from "~/modules/pricing/ui/PriceListProperties";
import { PriceListRulesTable } from "~/modules/pricing/ui/PriceListRules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Price List",
  to: path.to.salesPriceLists
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    role: "employee"
  });

  const { id } = params;
  if (!id) throw new Error("Price list ID not found");

  const priceList = await getPriceList(client, id);
  if (priceList.error) {
    throw redirect(
      path.to.salesPriceLists,
      await flash(request, error(priceList.error, "Failed to load price list"))
    );
  }

  // Await table data (needed for content rendering)
  const [items, rules, assignments] = await Promise.all([
    getPriceListItems(client, id),
    getPriceListRules(client, id),
    getPriceListAssignments(client, id)
  ]);

  // Defer explorer-only data (versions, orders, defaults)
  const explorerData = Promise.all([
    getPriceListVersions(client, id),
    getSalesOrdersByPriceList(client, id),
    getPurchaseOrdersByPriceList(client, id),
    getCustomersByDefaultPriceList(client, id),
    getSuppliersByDefaultPriceList(client, id)
  ]).then(
    ([
      versions,
      salesOrders,
      purchaseOrders,
      defaultCustomers,
      defaultSuppliers
    ]) => ({
      versions: versions.data ?? [],
      salesOrders: salesOrders.data ?? [],
      purchaseOrders: purchaseOrders.data ?? [],
      defaultCustomers: defaultCustomers.data ?? [],
      defaultSuppliers: defaultSuppliers.data ?? []
    })
  );

  return {
    priceList: priceList.data,
    items: items.data ?? [],
    rules: rules.data ?? [],
    assignments: assignments.data ?? [],
    explorerData
  };
}

export default function PriceListRoute() {
  const { priceList, items, rules, assignments, explorerData } =
    useLoaderData<typeof loader>();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const isLocked = priceList?.status === "Active";

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <PriceListHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={
                <Suspense fallback={<PriceListExplorerSkeleton />}>
                  <Await resolve={explorerData}>
                    {(deferred) => (
                      <PriceListExplorer
                        items={items}
                        assignments={assignments}
                        versions={deferred.versions}
                        salesOrders={deferred.salesOrders}
                        purchaseOrders={deferred.purchaseOrders}
                        defaultCustomers={deferred.defaultCustomers}
                        defaultSuppliers={deferred.defaultSuppliers}
                        priceListId={id}
                      />
                    )}
                  </Await>
                </Suspense>
              }
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    <PriceListDescription />
                    {isLocked && (
                      <div className="w-full rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                        This price list is <strong>Active</strong> and locked
                        from edits. Use <strong>Create New Version</strong> from
                        the header to make changes — the new version will carry
                        over all items, rules, and assignments.
                      </div>
                    )}
                    <PriceListItemsTable data={items} />
                    <PriceListRulesTable data={rules} />
                  </VStack>
                </div>
              }
              properties={<PriceListProperties />}
            />
          </div>
        </div>
      </div>
      {/* Tab routes pass through modals via nested Outlets */}
      <Outlet />
    </PanelProvider>
  );
}
