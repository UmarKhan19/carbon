import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Alert, AlertDescription, AlertTitle, VStack } from "@carbon/react";
import { Suspense } from "react";
import { LuLock, LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  Await,
  Link,
  Outlet,
  redirect,
  useLoaderData,
  useParams
} from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getCustomersByDefaultPriceList,
  getOverlappingPriceLists,
  getPriceList,
  getPriceListAssignments,
  getPriceListItems,
  getPriceListRules,
  getPriceListVersions,
  getSalesOrdersByPriceList
} from "~/modules/pricing";
import {
  PriceListExplorer,
  PriceListExplorerSkeleton
} from "~/modules/pricing/ui/PriceListExplorer";
import PriceListHeader from "~/modules/pricing/ui/PriceListHeader";
import { PriceListItemsTable } from "~/modules/pricing/ui/PriceListItems";
import { PriceListNotes } from "~/modules/pricing/ui/PriceListNotes";
import PriceListProperties from "~/modules/pricing/ui/PriceListProperties";
import { PriceListRulesTable } from "~/modules/pricing/ui/PriceListRules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Price Lists",
  to: path.to.salesPriceLists
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
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

  const [items, rules, assignments, overlaps] = await Promise.all([
    getPriceListItems(client, id),
    getPriceListRules(client, id),
    getPriceListAssignments(client, id),
    getOverlappingPriceLists(client, companyId, id)
  ]);

  // Defer explorer-only data (versions, orders, defaults)
  const explorerData = Promise.all([
    getPriceListVersions(client, id),
    getSalesOrdersByPriceList(client, id),
    getCustomersByDefaultPriceList(client, id)
  ]).then(([versions, salesOrders, defaultCustomers]) => ({
    versions: versions.data ?? [],
    salesOrders: salesOrders.data ?? [],
    defaultCustomers: defaultCustomers.data ?? []
  }));

  return {
    priceList: priceList.data,
    items: items.data ?? [],
    rules: rules.data ?? [],
    assignments: assignments.data ?? [],
    overlaps,
    explorerData
  };
}

export default function PriceListRoute() {
  const { priceList, items, rules, assignments, overlaps, explorerData } =
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
                        defaultCustomers={deferred.defaultCustomers}
                        priceListId={id}
                      />
                    )}
                  </Await>
                </Suspense>
              }
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    {isLocked && (
                      <Alert variant="warning">
                        <LuLock className="size-4" />
                        <AlertTitle>Price list is Active and locked</AlertTitle>
                        <AlertDescription>
                          Use <strong>Create New Version</strong> from the
                          header to make changes — the new version will carry
                          over all items, rules, and assignments.
                        </AlertDescription>
                      </Alert>
                    )}
                    {overlaps.length > 0 && (
                      <Alert variant="warning">
                        <LuTriangleAlert className="size-4" />
                        <AlertTitle>
                          Overlaps with {overlaps.length} other price list
                          {overlaps.length === 1 ? "" : "s"}
                        </AlertTitle>
                        <AlertDescription>
                          <p>
                            Another active price list with the same type,
                            currency, dates, and assignments exists — the
                            resolver may pick either one for some customers.
                          </p>
                          <ul className="mt-1 list-disc pl-4">
                            {overlaps.map((o) => (
                              <li key={o.id}>
                                <Link
                                  className="underline hover:text-foreground"
                                  to={path.to.priceList(o.id)}
                                >
                                  {o.name} (v{o.version})
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                    <PriceListNotes />
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
