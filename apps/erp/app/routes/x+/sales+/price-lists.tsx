import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getOverlapIdsForPriceLists, getPriceLists } from "~/modules/pricing";
import { PriceListsTable } from "~/modules/pricing/ui/PriceLists";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Price Lists",
  to: path.to.salesPriceLists
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  // Extract customerId from filters (it's on priceListAssignment, not priceList)
  const customerIdFilter = filters?.find((f) => f.column === "customerId");
  const customerId = customerIdFilter?.value ?? undefined;

  const [priceLists, overlapIds] = await Promise.all([
    getPriceLists(client, companyId, {
      search: search ?? undefined,
      customerId,
      limit,
      offset,
      sorts,
      filters
    }),
    getOverlapIdsForPriceLists(client, companyId)
  ]);

  return {
    count: priceLists.count ?? 0,
    priceLists: priceLists.data ?? [],
    overlapIds: Array.from(overlapIds)
  };
}

export default function SalesPriceListsRoute() {
  const { count, priceLists, overlapIds } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PriceListsTable
        data={priceLists}
        count={count}
        overlapIds={overlapIds}
      />
      <Outlet />
    </VStack>
  );
}
