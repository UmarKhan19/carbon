import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getCustomerItemPriceOverridesList } from "~/modules/sales";
import PriceOverridesTable from "~/modules/sales/ui/Pricing/PriceOverridesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Price List",
  to: path.to.salesPriceList
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

  const result = await getCustomerItemPriceOverridesList(client, companyId, {
    search: search ?? undefined,
    limit,
    offset,
    sorts,
    filters
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return {
    data: result.data ?? [],
    count: result.count ?? 0
  };
}

export default function PriceListRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PriceOverridesTable data={data} count={count} />
      <Outlet />
    </VStack>
  );
}
